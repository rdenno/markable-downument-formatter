// Scroll sync between the editor and the paginated preview.
//
// Every block in the preview carries the source lines it came from
// (data-line / data-line-end). Each block becomes a "box" with a top and
// bottom edge on both sides: [editorTop, editorBottom] <-> [previewTop, previewBottom].
// Positions inside a box are interpolated linearly, so a tall image or a big
// table occupies the same *fraction* of scrolling on both sides, and gaps
// between blocks (margins, page breaks, page gaps) are interpolated too.

/** Collect block boxes from a rendered preview document, in preview scroll coordinates. */
export function measurePreviewBlocks(doc) {
  const scroller = doc.scrollingElement || doc.documentElement;
  const originY = doc.documentElement.getBoundingClientRect().top;
  const byLine = new Map();
  const areaCache = new Map();
  const pageArea = (el) => {
    const content = el.closest('.pagedjs_page_content');
    if (!content) return null;
    if (!areaCache.has(content)) areaCache.set(content, content.getBoundingClientRect());
    return areaCache.get(content);
  };
  for (const el of doc.querySelectorAll('[data-line]')) {
    // Paged.js lays each page out with CSS columns; content that overflows onto
    // the next page sits in a hidden column to the right. getClientRects()
    // returns one rect per column fragment, so keep only the visible one(s).
    const area = pageArea(el);
    let top = Infinity, bottom = -Infinity, seen = false;
    for (const r of el.getClientRects()) {
      if (area && (r.left >= area.right - 1 || r.right <= area.left)) continue;
      top = Math.min(top, r.top);
      bottom = Math.max(bottom, r.bottom);
      seen = true;
    }
    if (!seen || (bottom - top === 0 && !el.classList.contains('page-break'))) continue;
    const start = +el.getAttribute('data-line');
    const end = +el.getAttribute('data-line-end') || start + 1;
    top -= originY;
    bottom -= originY;
    // Paged.js splits blocks across pages and copies attributes to each piece:
    // merge pieces into one box spanning first top -> last bottom.
    const key = start + ':' + end;
    const prev = byLine.get(key);
    if (prev) {
      prev.top = Math.min(prev.top, top);
      prev.bottom = Math.max(prev.bottom, bottom);
    } else {
      byLine.set(key, { start, end, top, bottom });
    }
  }
  return { blocks: [...byLine.values()], scrollHeight: scroller.scrollHeight };
}

/** Build a monotonic list of [editorY, previewY] anchor pairs. */
export function buildAnchors(blocks, editorYForLine, editorHeight, previewHeight) {
  const raw = [[0, 0]];
  for (const b of blocks) {
    const eTop = editorYForLine(b.start, false);
    const eBot = editorYForLine(b.end - 1, true);
    raw.push([eTop, b.top]);
    if (eBot > eTop && b.bottom > b.top) raw.push([eBot, b.bottom]);
  }
  raw.push([editorHeight, previewHeight]);
  raw.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  // Keep it strictly increasing on both axes so the map is invertible.
  const anchors = [];
  for (const p of raw) {
    const last = anchors[anchors.length - 1];
    if (!last || (p[0] > last[0] && p[1] > last[1])) anchors.push(p);
  }
  // Always end exactly at the end of both documents.
  const last = anchors[anchors.length - 1];
  if (last[0] < editorHeight || last[1] < previewHeight) {
    if (last[0] < editorHeight && last[1] < previewHeight) anchors.push([editorHeight, previewHeight]);
    else { last[0] = Math.max(last[0], editorHeight); last[1] = Math.max(last[1], previewHeight); }
  }
  return anchors;
}

/** Piecewise-linear interpolation. from/to are indexes into the anchor pairs (0 = editor, 1 = preview). */
export function mapY(anchors, y, from, to) {
  if (anchors.length < 2) return 0;
  let lo = 0, hi = anchors.length - 1;
  if (y <= anchors[0][from]) return anchors[0][to];
  if (y >= anchors[hi][from]) return anchors[hi][to];
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (anchors[mid][from] <= y) lo = mid; else hi = mid;
  }
  const a = anchors[lo], b = anchors[hi];
  const t = (y - a[from]) / (b[from] - a[from]);
  return a[to] + t * (b[to] - a[to]);
}

// The "reference line" slides from the top of the viewport (when scrolled to
// the top) to the bottom (when scrolled to the end). Aligning the reference
// lines keeps the panes aligned everywhere AND makes both reach their start
// and end at the same time.
export function referenceY(scrollTop, clientHeight, scrollHeight) {
  const max = Math.max(0, scrollHeight - clientHeight);
  return max > 0 ? scrollTop + clientHeight * (scrollTop / max) : 0;
}

export function scrollTopForReference(y, clientHeight, scrollHeight) {
  const max = Math.max(0, scrollHeight - clientHeight);
  if (max <= 0) return 0;
  return Math.min(max, Math.max(0, y / (1 + clientHeight / max)));
}
