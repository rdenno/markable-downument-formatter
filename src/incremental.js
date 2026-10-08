// Incremental preview rendering.
//
// Paged.js lays pages out strictly in order, so a page that ends before the
// first edited line comes out exactly the same in the next render. Rather than
// re-laying-out a 90-page document for a typo on page 80, we copy the
// unchanged pages from the previous render and only lay out from there on.
//
// This is only an optimisation for the on-screen preview. PDF export always
// does a full render. Anything that could make earlier pages depend on later
// content means a full render instead (see `planIncremental`).

// CSS features where a page's layout or content depends on other pages.
const RISKY_CSS = /:first|:left|:right|:blank|:nth\(|string-set|running\(|footnote|counter-(reset|increment)|target-counter|target-text|@page\s+[a-z_-]+\s*[{:]|\bpage\s*:/i;
// Link reference definitions ([id]: url) can change links anywhere in the document.
const REF_DEFINITION = /^ {0,3}\[[^\]]+\]:/m;

/** Every <style>/<link> in the source. These apply to the whole document, so any change means a full render. */
export function styleSignature(text) {
  return (text.match(/<style\b[\s\S]*?<\/style\s*>|<link\b[^>]*>/gi) || []).join('\n');
}

function firstChangedLine(a, b) {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a.charCodeAt(i) === b.charCodeAt(i)) i++;
  if (i === a.length && i === b.length) return -1;
  let line = 0;
  for (let k = 0; k < i; k++) if (a.charCodeAt(k) === 10) line++;
  return line;
}

/**
 * @param {object} prev   what the previous (complete) render was made from: { text, key, doc }
 * @param {string} text   new markdown
 * @param {string} key    everything else that affects layout (page size, base URL, ...)
 * @returns {{ skipPages: number, startLine: number } | null}
 */
export function planIncremental(prev, text, key) {
  if (!prev || !prev.doc || prev.key !== key) return null;
  const styles = styleSignature(text);
  if (styles !== styleSignature(prev.text) || RISKY_CSS.test(styles)) return null;
  if (REF_DEFINITION.test(text) || REF_DEFINITION.test(prev.text)) return null;
  const changed = firstChangedLine(prev.text, text);
  if (changed < 0) return null;

  const pages = prev.doc.querySelectorAll('.pagedjs_page');
  let best = null;
  // Restart only on odd page numbers (index 2, 4, ...) so left/right page parity is unchanged.
  for (let k = 2; k < pages.length; k += 2) {
    const first = firstBlock(pages[k]);
    if (!first) continue;
    const start = +first.getAttribute('data-line');
    const end = +first.getAttribute('data-line-end');
    // The block that starts this page (and everything before it) must be untouched by the edit.
    if (end > changed) break;
    best = { skipPages: k, startLine: start };
  }
  return best;
}

// The first top-level block on a page, if the page starts cleanly with one
// (not the continuation of something split across the previous page).
function firstBlock(page) {
  const wrapper = page.querySelector('.pagedjs_page_content > div');
  const el = wrapper && wrapper.firstElementChild;
  if (!el || !el.hasAttribute('data-line') || !el.hasAttribute('data-line-end')) return null;
  if (el.hasAttribute('data-split-from')) return null;
  return el;
}
