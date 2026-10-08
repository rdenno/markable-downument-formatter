// Builds the complete, self-contained HTML document that Paged.js paginates.
// The exact same document is used for the live preview and for PDF export,
// so what you see in the preview is what ends up in the PDF.
import { renderMarkdown } from './markdown.js';
import pageCss from './page.css';

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
.pagedjs_pages { display: flex; flex-direction: column; align-items: center; padding: 24px 0; gap: 24px; width: max-content; min-width: 100%; }
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
 */
export function buildDocument(markdown, { assetBase, baseHref, pageSize = 'A4', title = 'Document' }) {
  const body = renderMarkdown(markdown);
  const size = PAGE_SIZES[pageSize] || 'A4';
  const asset = (p) => new URL(p, assetBase).href;
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<base href="${escapeAttr(baseHref)}">
<title>${escapeAttr(title)}</title>
<link rel="stylesheet" href="${asset('node_modules/katex/dist/katex.min.css')}" data-pagedjs-ignore>
<style media="screen">${SCREEN_CSS}</style>
<style>@page { size: ${size}; }</style>
<style>${pageCss.replace(/<\/style/gi, '<\\/style')}</style>
<script>
  window.PagedConfig = {
    auto: true,
    after: function () {
      window.__pagedDone = true;
      try { window.parent.postMessage({ type: 'paged-done' }, '*'); } catch (e) {}
    }
  };
</script>
<script src="${asset('node_modules/pagedjs/dist/paged.polyfill.min.js')}"></script>
</head>
<body>
${body}
</body>
</html>`;
}

export const PAGE_SIZE_NAMES = Object.keys(PAGE_SIZES);
