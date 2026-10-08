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
/* Dark pages (screen only): invert each page, then invert images back so they
   keep their real colours. Filters don't affect layout, so pagination is unchanged. */
/* Dark UI: dark scrollbars and desk, even when the pages themselves stay light. */
html.mdpdf-ui-dark { color-scheme: dark; background: #34363c; }
html.mdpdf-dark { background: #34363c; }
html.mdpdf-dark .pagedjs_page { filter: invert(0.92) hue-rotate(180deg); box-shadow: none; }
html.mdpdf-dark .pagedjs_page img, html.mdpdf-dark .pagedjs_page video, html.mdpdf-dark .pagedjs_page picture,
html.mdpdf-dark .pagedjs_page canvas, html.mdpdf-dark .pagedjs_page svg image { filter: invert(1) hue-rotate(180deg); }
/* Block under the editor cursor (preview only; this stylesheet is never printed). */
.mdpdf-cursor-block { background-color: rgba(37, 99, 235, .07); box-shadow: 0 0 0 3px rgba(37, 99, 235, .07); border-radius: 2px; }
.mdpdf-cursor-block > td, .mdpdf-cursor-block > th { background-color: rgba(37, 99, 235, .09); }
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
 * @param {boolean} opts.darkPages  preview only: show pages in dark colours (screen-only CSS)
 * @param {number|null} opts.startLine  preview only: lay out from the top-level block at this source
 *   line, after pages the app copies in from the previous render (see app.js, incremental rendering)
 */
export function buildDocument(markdown, { assetBase, baseHref, pageSize = 'A4', title = 'Document', pagesLeft = 24, startLine = null, darkPages = false, uiDark = false, renderId = 0 }) {
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
<html lang="${escapeAttr(lang)}" class="${uiDark ? 'mdpdf-ui-dark' : ''}${darkPages ? ' mdpdf-dark' : ''}">
<head>
<meta charset="utf-8">
<base href="${escapeAttr(baseHref)}">
<title>${escapeAttr(docTitle)}</title>
<link rel="stylesheet" href="${asset('dist/vendor/katex/katex.min.css')}" data-pagedjs-ignore>
<style media="screen">${SCREEN_CSS} :root { --pages-left: ${Math.round(pagesLeft)}px; }</style>
${docSetsSize ? '' : `<style>@page { size: ${size}; }</style>`}
<style>${highlightCss}</style>
<style>${pageCss.replace(/<\/style/gi, '<\\/style')}</style>
<style>/* front matter */ ${fm.css}</style>
${userStyles.join('\n')}
<script>
  // Report any crash in the layout engine straight away rather than stalling.
  (function () {
    function report(msg) {
      if (window.__pagedError || window.__pagedDone) return;
      window.__pagedError = String(msg || 'unknown error');
      try { window.parent.postMessage({ type: 'paged-error', message: window.__pagedError, renderId: window.__mdpdfRenderId }, '*'); } catch (e) {}
    }
    window.addEventListener('error', function (e) {
      if (e.filename && !/paged\.polyfill/.test(e.filename)) return; // the document's own scripts
      report(e.message);
    });
    window.addEventListener('unhandledrejection', function (e) { report(e.reason && (e.reason.message || e.reason)); });
  })();
  // Paged.js lays out one page per animation frame (~16ms each). Yield to the
  // event loop instead so long documents paginate several times faster.
  (function () {
    var raf = window.requestAnimationFrame;
    var ch = new MessageChannel(), queue = [];
    ch.port1.onmessage = function () { var q = queue; queue = []; q.forEach(function (cb) { cb(performance.now()); }); };
    window.requestAnimationFrame = function (cb) { queue.push(cb); if (queue.length === 1) ch.port2.postMessage(0); return 0; };
    window.__restoreRaf = function () { window.requestAnimationFrame = raf; };
  })();
  window.__mdpdfRenderId = ${Number(renderId)};
  window.__mdpdfStartLine = ${startLine == null ? 'null' : Number(startLine)};
  window.PagedConfig = {
    auto: true,
    before: function () {
      // Page breaks written as inline styles (<div style="page-break-after: always">)
      // are invisible to Paged.js, which only reads stylesheets, and the browser
      // applying them natively mid-layout can crash it. Move them into a stylesheet.
      var rules = [], count = 0;
      var withStyle = document.body.querySelectorAll('[style]');
      for (var i = 0; i < withStyle.length; i++) {
        var el = withStyle[i], decls = [];
        ['break-before', 'break-after', 'break-inside'].forEach(function (prop) {
          var value = el.style.getPropertyValue(prop); // page-break-* map onto these
          if (!value) return;
          decls.push(prop + ': ' + value + ';');
          el.style.removeProperty(prop);
          el.style.removeProperty('page-' + prop);
        });
        if (!decls.length) continue;
        var cls = 'mdpdf-inline-break-' + (++count);
        el.classList.add(cls);
        rules.push('.' + cls + ' { ' + decls.join(' ') + ' }');
      }
      if (rules.length) {
        var st = document.createElement('style');
        st.textContent = rules.join(' ');
        document.head.appendChild(st);
      }

      // Column widths: data-width="2" is a share of the row, "40%" / "6cm" a fixed width.
      var cols = document.querySelectorAll('.columns > [data-width]');
      for (var c = 0; c < cols.length; c++) {
        var w = cols[c].getAttribute('data-width').trim();
        if (/^[0-9]+([.][0-9]+)?$/.test(w)) cols[c].style.flex = w + ' 1 0';
        else if (/^[0-9]+([.][0-9]+)?(%|cm|mm|in|pt|px|em)$/.test(w)) cols[c].style.flex = '0 0 ' + w;
      }

      // Loose text next to block elements (e.g. text right after a raw-HTML <div>)
      // is laid out by browsers as an invisible "anonymous" block. Paged.js can't
      // break pages around bare text: it ignores the break or crashes. Give each
      // such run of text a real (unstyled) <div>, which renders identically.
      var parents = [], seen = new Set(), walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT), t;
      while ((t = walker.nextNode())) {
        if (t.data.trim() && !seen.has(t.parentNode)) { seen.add(t.parentNode); parents.push(t.parentNode); }
      }
      var isInline = function (n) {
        if (n.nodeType !== 1) return true; // text, comments
        var d = getComputedStyle(n).display;
        return d.indexOf('inline') === 0 || d === 'none' || d === 'contents';
      };
      parents.forEach(function (parent) {
        if (parent.closest('.katex, pre, svg, math, script, style, textarea, select')) return;
        var kids = Array.prototype.slice.call(parent.childNodes);
        if (kids.every(isInline)) return; // ordinary inline content: nothing to do
        var run = [];
        var flush = function () {
          var hasText = run.some(function (n) { return n.nodeType === 3 && n.data.trim(); });
          if (hasText) {
            var box = document.createElement('div');
            box.className = 'mdpdf-anonymous-block';
            parent.insertBefore(box, run[0]);
            run.forEach(function (n) { box.appendChild(n); });
          }
          run = [];
        };
        kids.forEach(function (n) { if (isInline(n)) run.push(n); else flush(); });
        flush();
      });

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
      try { window.parent.postMessage({ type: 'paged-done', renderId: window.__mdpdfRenderId }, '*'); } catch (e) {}
    }
  };
</script>
<script src="${asset('dist/vendor/paged.polyfill.min.js')}"></script>
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
      try { window.parent.postMessage({ type: 'paged-page', count: n, renderId: window.__mdpdfRenderId }, '*'); } catch (e) {}
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
