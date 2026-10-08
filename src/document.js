// Builds the complete, self-contained HTML document that Paged.js paginates.
// The exact same document is used for the live preview and for PDF export,
// so what you see in the preview is what ends up in the PDF.
import { renderMarkdown } from './markdown.js';
import { parseFrontMatter } from './frontmatter.js';
import pageCss from './page.css';
import highlightCss from 'highlight.js/styles/github.css';

const PAGE_SIZES = {
  A4: 'A4',
  Letter: 'letter',
  Legal: 'legal',
  A5: 'A5',
};

// Shown on screen only (ignored by Paged.js and by print): grey desk + page shadows.
const SCREEN_CSS = `
html { background: #d9dbdf; }
body { margin: 0; }
/* Pages sit at a fixed left offset (not centred by width): Paged.js measures page
   positions while laying out, so they must not move if the frame is resized mid-render.
   The app re-centres them via --pages-left once a render is finished. */
.pagedjs_pages { display: flex; flex-direction: column; padding: 24px 24px 24px var(--pages-left, 24px); gap: 24px; width: max-content; }
.pagedjs_page { background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.25), 0 4px 16px rgba(0,0,0,.08); flex: none; }
`;

function escapeAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/**
 * @param {string} markdown
 * @param {object} opts
 * @param {string} opts.assetBase  absolute URL of the app root (for KaTeX + Paged.js)
 * @param {string} opts.baseHref   absolute URL that relative links/images resolve against
 * @param {string} opts.pageSize   key of PAGE_SIZES
 * @param {string} opts.title
 * @param {number} opts.pagesLeft  on-screen left offset of the pages (px), to centre them in the preview
 * @returns {{ html: string, warnings: string[], settings: object }}
 * @param {number|null} opts.startLine  preview only: lay out from the top-level block at this source
 *   line, after pages the app copies in from the previous render (see app.js, incremental rendering)
 */
export function buildDocument(markdown, { assetBase, baseHref, pageSize = 'A4', title = 'Document', pagesLeft = 24, startLine = null }) {
  const fm = parseFrontMatter(markdown);
  // <style> blocks written in the markdown are moved to <head> (in order):
  // Paged.js only applies @page rules (size, margins, page numbers) from there.
  const userStyles = [];
  const body = renderMarkdown(fm.body).replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, (m) => { userStyles.push(m); return ''; });
  const docTitle = fm.settings.title != null ? String(fm.settings.title) : title;
  const lang = fm.settings.lang != null ? String(fm.settings.lang) : 'en';
  // Paged.js sizes pages from the first `size` it finds, so the toolbar's page size is
  // only emitted when the document doesn't set one itself (front matter or a <style>).
  const docSetsSize = /\bsize\s*:/.test(fm.css) || /@page[^{]*\{[^}]*\bsize\s*:/i.test(userStyles.join('\n'));
  const size = PAGE_SIZES[pageSize] || 'A4';
  const asset = (p) => new URL(p, assetBase).href;
  const html = `<!doctype html>
<html lang="${escapeAttr(lang)}">
<head>
<meta charset="utf-8">
<base href="${escapeAttr(baseHref)}">
<title>${escapeAttr(docTitle)}</title>
<link rel="stylesheet" href="${asset('node_modules/katex/dist/katex.min.css')}" data-pagedjs-ignore>
<style media="screen">${SCREEN_CSS} :root { --pages-left: ${Math.round(pagesLeft)}px; }</style>
${docSetsSize ? '' : `<style>@page { size: ${size}; }</style>`}
<style>${highlightCss}</style>
<style>${pageCss.replace(/<\/style/gi, '<\\/style')}</style>
<style>/* front matter */ ${fm.css}</style>
${userStyles.join('\n')}
<script>
  // Paged.js lays out one page per animation frame (~16ms each). Yield to the
  // event loop instead so long documents paginate several times faster.
  (function () {
    var raf = window.requestAnimationFrame;
    var ch = new MessageChannel(), queue = [];
    ch.port1.onmessage = function () { var q = queue; queue = []; q.forEach(function (cb) { cb(performance.now()); }); };
    window.requestAnimationFrame = function (cb) { queue.push(cb); if (queue.length === 1) ch.port2.postMessage(0); return 0; };
    window.__restoreRaf = function () { window.requestAnimationFrame = raf; };
  })();
  window.__mdpdfStartLine = ${startLine == null ? 'null' : Number(startLine)};
  window.PagedConfig = {
    auto: true,
    before: function () {
      // Incremental preview: drop the blocks that the reused pages already show.
      window.__mdpdfCut = false;
      var L = window.__mdpdfStartLine;
      if (L == null) return;
      var start = document.querySelector('body > [data-line="' + L + '"]');
      if (!start) return;
      for (var n = start.previousSibling; n; ) {
        var prev = n.previousSibling;
        // Keep styles (they apply to the whole document): move them to <head>, in order.
        if (n.nodeType === 1 && (n.tagName === 'STYLE' || n.tagName === 'LINK')) document.head.appendChild(n);
        else n.parentNode.removeChild(n);
        n = prev;
      }
      window.__mdpdfCut = true;
    },
    after: function () {
      window.__restoreRaf();
      window.__pagedDone = true;
      try { window.parent.postMessage({ type: 'paged-done' }, '*'); } catch (e) {}
    }
  };
</script>
<script src="${asset('node_modules/pagedjs/dist/paged.polyfill.min.js')}"></script>
<script>
  // Progress: lets the app show the first pages before the whole document is done.
  (function () {
    var n = 0;
    PagedPolyfill.on('rendering', function (chunker) {
      // Insert the reused pages before any new page is laid out, so nothing moves mid-layout.
      window.__mdpdfPrefixCount = 0;
      if (!window.__mdpdfCut) return;
      var pages = null;
      try { pages = window.parent.__mdpdfPrefixPages(document); } catch (e) {}
      if (!pages) return;
      for (var i = 0; i < pages.length; i++) chunker.pagesArea.appendChild(pages[i]);
      window.__mdpdfPrefixCount = pages.length;
    });
    PagedPolyfill.on('page', function () {
      n++;
      try { window.parent.postMessage({ type: 'paged-page', count: n }, '*'); } catch (e) {}
    });
  })();
</script>
</head>
<body>
${body}
</body>
</html>`;
  return { html, warnings: fm.warnings, settings: fm.settings, docSetsSize };
}

export const PAGE_SIZE_NAMES = Object.keys(PAGE_SIZES);
