import { createEditor, setEditorDoc, editorYForLine, setEditorDark } from './editor.js';
import { buildDocument, PAGE_SIZE_NAMES } from './document.js';
import { measurePreviewBlocks, buildAnchors, mapY, referenceY, scrollTopForReference } from './sync.js';
import { platform } from './platform.js';
import { planIncremental } from './incremental.js';
import { TEMPLATES } from './templates.js';
import { expandToBlocks, blockAt, tableAt, editTable, cellOffset, columnsAt, editColumns } from './structure.js';
import WELCOME from './welcome.md';

const $ = (sel) => document.querySelector(sel);
const APP_ROOT = new URL('./', location.href).href;

// ---------- persisted settings ----------
const settings = Object.assign(
  { pageSize: 'A4', editorFontSize: 14, previewZoom: 1, previewFit: true, split: 0.5, sync: true, highlight: true, theme: 'system', darkPages: true },
  safeJson(localStorageGet('mdpdf.settings')),
);
function saveSettings() { localStorageSet('mdpdf.settings', JSON.stringify(settings)); }
function localStorageGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function localStorageSet(k, v) { try { localStorage.setItem(k, v); } catch {} }
function safeJson(s) { try { return JSON.parse(s) || {}; } catch { return {}; } }

// ---------- file state ----------
let filePath = null;   // absolute path when running in the desktop app
let fileName = 'Untitled.md';
let savedText = '';

// ---------- editor ----------
const editorHost = $('#editor');
const editor = createEditor(editorHost, {
  doc: '',
  onChange: () => { updateTitle(); scheduleRender(); },
  onGeometry: () => { if (!job || job.done) onScroll(activePane, true); },
  onCursor: (line) => { cursorLine = line; scheduleHighlight(); scheduleTools?.(); },
});
const editorScroller = editor.scrollDOM;
let cursorLine = 0;

function currentText() { return editor.state.doc.toString(); }
function isDirty() { return currentText() !== savedText; }

function loadDocument(text, path, name) {
  filePath = path || null;
  fileName = name || (path ? path.split(/[\\/]/).pop() : 'Untitled.md');
  savedText = text;
  setEditorDoc(editor, text);
  updateTitle();
  renderNow();
}

function updateTitle() {
  const dirty = isDirty();
  $('#file-name').textContent = fileName + (dirty ? ' •' : '');
  document.title = `${dirty ? '• ' : ''}${fileName} — Markable`;
  platform.setDirty?.(dirty);
  if (!filePath) localStorageSet('mdpdf.scratch', currentText());
}

// ---------- preview (double-buffered iframes) ----------
// Two iframes: one visible, one rendering in the background. As soon as the
// background one has laid out the pages currently in view, it is swapped to
// the front; later pages keep appearing below. Pages have a fixed size, so
// nothing on screen moves while the rest of the document fills in.
const frames = [$('#frame-a'), $('#frame-b')];
let front = 0;
let job = null;        // the render in progress: { frame, target, swapped, started, done }
let renderTimer = null;
let preview = { blocks: [], scrollHeight: 0, pageWidth: 0 };

function scheduleRender() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(renderNow, 250);
}

function baseHref() {
  return filePath ? platform.dirUrl(filePath) : APP_ROOT;
}

// Stop a Paged.js run where it is (its pages so far stay on screen).
function haltPaged(frame) {
  try {
    const q = frame.contentWindow.PagedPolyfill.chunker.q;
    q.tick = () => {};
    q._q.length = 0;
  } catch {}
}

/** Number of pages needed to cover the visible area of the current preview. */
function pagesInView() {
  const d = frames[front].contentDocument;
  const sc = previewScroller(frames[front]);
  const pages = d ? d.querySelectorAll('.pagedjs_page') : [];
  if (!sc || !pages.length) return 2;
  const bottom = sc.scrollTop + sc.clientHeight;
  const originY = d.documentElement.getBoundingClientRect().top;
  let n = 0;
  for (const pg of pages) {
    if (pg.getBoundingClientRect().top - originY > bottom) break;
    n++;
  }
  return n + 2; // a little slack in case content above grew
}

// What the front frame's (complete) render was made from, for incremental renders.
let frontSource = null;
let renderSeq = 0;

function layoutKey() {
  return [settings.pageSize, baseHref()].join('|');
}

function renderNow({ full = false } = {}) {
  clearTimeout(renderTimer);
  // A newer edit supersedes whatever is still rendering.
  // (Loading a new document into the hidden frame cancels its old render.)
  if (job && !job.done && job.swapped) { haltPaged(job.frame); frontSource = null; }
  const frame = frames[1 - front];
  const text = currentText();
  const key = layoutKey();
  const plan = full ? null : planIncremental(frontSource, text, key);
  renderSeq++;
  job = { id: renderSeq, frame, text, key, target: pagesInView(), swapped: false, done: false, started: performance.now(), pages: 0,
    prevHeight: preview.scrollHeight, skip: plan ? plan.skipPages : 0, prefixFrom: plan ? frames[front] : null };
  setStatus('Rendering…');
  setBusy(true);
  armWatchdog(job);
  const built = buildDocument(text, {
    assetBase: APP_ROOT, baseHref: baseHref(), pageSize: settings.pageSize, title: fileName,
    pagesLeft: centeredLeft(), startLine: plan ? plan.startLine : null, darkPages: pagesAreDark(), uiDark: isDark(), renderId: job.id,
  });
  job.warnings = built.warnings;
  showDocSettings(built.docSetsSize);
  frame.srcdoc = built.html;
}

// Called from inside the rendering frame: copies of the pages it can reuse.
window.__mdpdfPrefixPages = (doc) => {
  const j = job;
  if (!j || !j.prefixFrom || doc !== j.frame.contentDocument || doc.defaultView.__mdpdfRenderId !== j.id) return null;
  const pages = [...j.prefixFrom.contentDocument.querySelectorAll('.pagedjs_page')].slice(0, j.skip);
  if (pages.length !== j.skip) return null;
  return pages.map((p) => {
    const copy = doc.importNode(p, true);
    for (const el of copy.querySelectorAll('.mdpdf-cursor-block')) el.classList.remove('mdpdf-cursor-block');
    return copy;
  });
};

// If layout stops making progress, stop waiting and say so.
function armWatchdog(j) {
  clearTimeout(j.watchdog);
  j.watchdog = setTimeout(() => {
    if (job !== j || j.done) return;
    j.error = 'layout stopped responding';
    haltPaged(j.frame);
    completeJob(j);
  }, 15000);
}

window.addEventListener('message', (e) => {
  const j = job;
  // The same iframe is reused, so a cancelled render's late messages come from
  // the same window: only accept messages carrying this render's id.
  if (!j || j.done || e.source !== j.frame.contentWindow || e.data?.renderId !== j.id) return;
  if (e.data?.type === 'paged-error') {
    j.error = e.data.message;
    completeJob(j);
  } else if (e.data?.type === 'paged-page') {
    j.pages = e.data.count;
    armWatchdog(j);
    if (j.pages > 1) setStatus(`Rendering… page ${j.skip + j.pages}`);
    // `count` pages exist, so all but the last are fully laid out.
    if (!j.swapped && j.skip + j.pages - 1 >= j.target) swapIn(j);
  } else if (e.data?.type === 'paged-done') {
    completeJob(j);
  }
});

function swapIn(j) {
  const back = j.frame;
  const oldFront = frames[front];
  const oldSc = previewScroller(oldFront);
  const oldTop = oldSc ? oldSc.scrollTop : 0;

  back.style.visibility = 'visible';
  back.style.zIndex = '1';
  attachPreviewListeners(back);
  remeasurePreview(back, j.done ? 0 : j.prevHeight);
  applyPreviewZoom();
  const sc = previewScroller(back);
  if (sc) {
    if (activePane === 'preview') sc.scrollTop = oldTop;
    else syncFrom('editor', back);
  }
  oldFront.style.visibility = 'hidden';
  oldFront.style.zIndex = '0';
  front = frames.indexOf(back);
  j.swapped = true;
  applyHighlight(back);
}

function completeJob(j) {
  j.done = true;
  clearTimeout(j.watchdog);
  const win = j.frame.contentWindow;
  const d = j.frame.contentDocument;
  setBusy(false);
  if (j.skip && win && win.__mdpdfPrefixCount !== j.skip && !j.error) {
    // Reuse didn't happen as planned; fall back to a full render.
    renderNow({ full: true });
    return;
  }
  if (j.skip && d) finishIncremental(d);
  if (!j.swapped) swapIn(j);
  frontSource = win && win.__pagedDone && !j.error ? { text: j.text, key: j.key, doc: d } : null;
  applyPreviewZoom(); // the finished document may now need a scrollbar: refit around it
  recenterPages();
  remeasurePreview(j.frame);
  if (activePane === 'editor') syncFrom('editor', j.frame);
  applyHighlight(j.frame);
  const pages = j.frame.contentDocument?.querySelectorAll('.pagedjs_page').length || 0;
  if (j.error) {
    // Keep whatever was laid out, and say exactly what happened.
    setStatus(`${pages} page${pages === 1 ? '' : 's'} (incomplete)`, [
      `Page layout failed after page ${pages}: ${j.error}. Export may be incomplete too.`,
      ...j.warnings,
    ]);
  } else {
    setStatus(`${pages} page${pages === 1 ? '' : 's'} · ${Math.round(performance.now() - j.started)} ms`, j.warnings);
  }
  window.__mdpdfLastRender = { skip: j.skip, ms: performance.now() - j.started }; // for tests
}

// Tidy up after reusing pages: number pages in order and give Paged.js's
// total-pages counter the full count.
function finishIncremental(d) {
  const pages = d.querySelectorAll('.pagedjs_page');
  pages.forEach((p, i) => {
    p.id = 'page-' + (i + 1);
    p.dataset.pageNumber = String(i + 1);
    if (i > 0) p.classList.remove('pagedjs_first_page');
  });
  d.querySelector('.pagedjs_pages')?.style.setProperty('--pagedjs-page-count', String(pages.length));
}

function previewScroller(frame) {
  const d = frame.contentDocument;
  return d && (d.scrollingElement || d.documentElement);
}

// While a render is still filling in, `minHeight` is the previous document's
// height: a good stand-in for the final height so sync doesn't jump around.
function remeasurePreview(frame = frames[front], minHeight = 0) {
  const d = frame.contentDocument;
  if (!d) return;
  const m = measurePreviewBlocks(d);
  const page = d.querySelector('.pagedjs_page');
  preview = { ...m, scrollHeight: Math.max(m.scrollHeight, minHeight), pageWidth: page ? page.offsetWidth : 0 };
}

// ---------- theme ----------
const systemDark = window.matchMedia('(prefers-color-scheme: dark)');
const THEMES = ['system', 'light', 'dark'];
const THEME_LABEL = { system: 'Auto', light: 'Light', dark: 'Dark' };

function isDark() {
  return settings.theme === 'dark' || (settings.theme === 'system' && systemDark.matches);
}
function pagesAreDark() {
  return isDark() && settings.darkPages;
}

function applyTheme() {
  const dark = isDark();
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  setEditorDark(editor, dark);
  $('#theme').textContent = (dark ? '☾ ' : '☀ ') + THEME_LABEL[settings.theme];
  // Dark pages is a screen-only class, so flipping it never re-lays-out anything.
  for (const f of frames) {
    const root = f.contentDocument?.documentElement;
    root?.classList.toggle('mdpdf-dark', pagesAreDark());
    root?.classList.toggle('mdpdf-ui-dark', dark);
  }
}

// ---------- cursor highlight ----------
// Marks the innermost preview block whose source lines contain the editor
// cursor (every piece of it, if it is split across pages). Screen-only CSS:
// it is never part of an export.
let highlightRaf = 0;
function scheduleHighlight() {
  cancelAnimationFrame(highlightRaf);
  highlightRaf = requestAnimationFrame(() => applyHighlight());
}

function applyHighlight(frame = frames[front]) {
  const d = frame.contentDocument;
  if (!d || !d.body) return;
  for (const el of d.querySelectorAll('.mdpdf-cursor-block')) el.classList.remove('mdpdf-cursor-block');
  if (!settings.highlight) return;
  let best = null;
  for (const el of d.querySelectorAll('[data-line]')) {
    const start = +el.getAttribute('data-line');
    const end = +el.getAttribute('data-line-end') || start + 1;
    if (cursorLine < start || cursorLine >= end) continue;
    if (!best || end - start < best.end - best.start || (end - start === best.end - best.start && start >= best.start)) {
      best = { start, end };
    }
  }
  if (!best) return;
  for (const el of d.querySelectorAll(`[data-line="${best.start}"][data-line-end="${best.end}"]`)) {
    el.classList.add('mdpdf-cursor-block');
  }
}

// ---------- zoom ----------
// The preview iframes are scaled from the outside with a CSS transform, so the
// document inside always lays out at 100%. (Changing CSS `zoom` instead alters
// the frame's pixel ratio, and doing that while Paged.js is mid-layout makes it
// mis-measure and drop content at page breaks.)
let previewZoomValue = 1;

function applyPreviewZoom() {
  const host = $('.frames');
  const W = host.clientWidth, H = host.clientHeight;
  let z = settings.previewZoom;
  if (settings.previewFit && preview.pageWidth) {
    // Fit the page plus its side padding, and the frame's own vertical scrollbar if it takes space.
    const win = frames[front].contentWindow, sc = previewScroller(frames[front]);
    const scrollbar = win && sc ? Math.max(0, win.innerWidth - sc.clientWidth) : 0;
    z = W / (preview.pageWidth + 48 + scrollbar);
  }
  z = Math.min(4, Math.max(0.1, z));
  previewZoomValue = z;
  for (const f of frames) {
    f.style.transform = `scale(${z})`;
    f.style.width = W / z + 'px';
    f.style.height = H / z + 'px';
  }
  $('#preview-zoom-label').textContent = Math.round(z * 100) + '%';
  $('#preview-fit').classList.toggle('active', settings.previewFit);
}

function setPreviewZoom(z, { fit = false } = {}) {
  const sc = previewScroller(frames[front]);
  const center = sc ? sc.scrollTop + sc.clientHeight / 2 : 0;
  settings.previewFit = fit;
  if (!fit) settings.previewZoom = Math.min(4, Math.max(0.2, z));
  saveSettings();
  applyPreviewZoom();
  recenterPages();
  // Keep the same spot centred, then realign the panes.
  if (sc) sc.scrollTop = center - sc.clientHeight / 2;
  remeasurePreview();
  syncFrom(activePane === 'preview' ? 'preview' : 'editor');
}

// Left offset that centres the pages in the preview frame (in the frame's own px).
function centeredLeft() {
  const sc = previewScroller(frames[front]);
  const inner = sc ? sc.clientWidth : $('.frames').clientWidth / previewZoomValue;
  return preview.pageWidth ? Math.max(24, (inner - preview.pageWidth) / 2) : 24;
}

// Only touch a frame whose layout is finished; moving pages mid-render breaks Paged.js.
function recenterPages() {
  if (job && !job.done && frames[front] === job.frame) return;
  const d = frames[front].contentDocument;
  if (d && d.documentElement) d.documentElement.style.setProperty('--pages-left', Math.round(centeredLeft()) + 'px');
}

function currentPreviewZoom() {
  return previewZoomValue;
}

function setEditorFontSize(px) {
  settings.editorFontSize = Math.min(32, Math.max(8, Math.round(px)));
  saveSettings();
  editorHost.style.setProperty('--editor-font-size', settings.editorFontSize + 'px');
  $('#editor-zoom-label').textContent = settings.editorFontSize + 'px';
  editor.requestMeasure();
  requestAnimationFrame(() => syncFrom('preview'));
}

// ---------- scroll sync ----------
// Whichever pane the user last touched (wheel, click, key, scrollbar drag)
// drives the other one. Programmatic scrolls on the follower are ignored,
// so there is no feedback loop.
let activePane = 'editor';
let syncRaf = 0;

function anchors() {
  return buildAnchors(
    preview.blocks,
    (line, bottom) => editorYForLine(editor, line, bottom),
    editorScroller.scrollHeight,
    preview.scrollHeight,
  );
}

function syncFrom(source, frame = frames[front]) {
  if (!settings.sync) return;
  const psc = previewScroller(frame);
  if (!psc) return;
  const a = anchors();
  const pH = preview.scrollHeight || psc.scrollHeight;
  if (source === 'editor') {
    const y = referenceY(editorScroller.scrollTop, editorScroller.clientHeight, editorScroller.scrollHeight);
    const py = mapY(a, y, 0, 1);
    psc.scrollTop = scrollTopForReference(py, psc.clientHeight, pH);
  } else {
    const y = referenceY(psc.scrollTop, psc.clientHeight, pH);
    const ey = mapY(a, y, 1, 0);
    editorScroller.scrollTop = scrollTopForReference(ey, editorScroller.clientHeight, editorScroller.scrollHeight);
  }
}

function onScroll(source, force = false) {
  if (source !== activePane && !force) return;
  cancelAnimationFrame(syncRaf);
  syncRaf = requestAnimationFrame(() => syncFrom(source));
}

for (const ev of ['wheel', 'pointerdown', 'keydown', 'touchstart', 'focusin']) {
  editorHost.addEventListener(ev, () => { activePane = 'editor'; }, { passive: true, capture: true });
}
editorScroller.addEventListener('scroll', () => onScroll('editor'), { passive: true });

function attachPreviewListeners(frame) {
  const win = frame.contentWindow;
  if (!win || win.__mdpdfHooked) return;
  win.__mdpdfHooked = true;
  for (const ev of ['wheel', 'pointerdown', 'keydown', 'touchstart']) {
    win.addEventListener(ev, () => { activePane = 'preview'; }, { passive: true, capture: true });
  }
  win.addEventListener('scroll', () => { if (frame === frames[front]) onScroll('preview'); }, { passive: true });
  // Ctrl/Cmd + wheel zooms the preview.
  win.addEventListener('wheel', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    setPreviewZoom(currentPreviewZoom() * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
  }, { passive: false });
  win.addEventListener('keydown', handleShortcut);
}

editorHost.addEventListener('wheel', (e) => {
  if (!(e.ctrlKey || e.metaKey)) return;
  e.preventDefault();
  setEditorFontSize(settings.editorFontSize + (e.deltaY < 0 ? 1 : -1));
}, { passive: false });

// ---------- split pane ----------
const divider = $('#divider');
function applySplit() {
  $('#editor-pane').style.flexBasis = (settings.split * 100) + '%';
}
divider.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  divider.setPointerCapture(e.pointerId);
  document.body.classList.add('dragging');
  const main = $('#main').getBoundingClientRect();
  const move = (ev) => {
    settings.split = Math.min(0.85, Math.max(0.15, (ev.clientX - main.left) / main.width));
    applySplit();
  };
  const up = () => {
    divider.removeEventListener('pointermove', move);
    divider.removeEventListener('pointerup', up);
    document.body.classList.remove('dragging');
    saveSettings();
    onLayoutChange();
  };
  divider.addEventListener('pointermove', move);
  divider.addEventListener('pointerup', up);
});

let layoutTimer = 0;
function onLayoutChange() {
  clearTimeout(layoutTimer);
  layoutTimer = setTimeout(() => {
    applyPreviewZoom();
    recenterPages();
    remeasurePreview();
    syncFrom(activePane);
  }, 60);
}
new ResizeObserver(onLayoutChange).observe($('#preview-pane'));

// ---------- toolbar ----------
const pageSel = $('#page-size');
for (const name of PAGE_SIZE_NAMES) pageSel.add(new Option(name, name));
pageSel.value = settings.pageSize;
pageSel.addEventListener('change', () => { settings.pageSize = pageSel.value; saveSettings(); renderNow(); });

$('#theme').onclick = () => {
  settings.theme = THEMES[(THEMES.indexOf(settings.theme) + 1) % THEMES.length];
  saveSettings();
  applyTheme();
};
systemDark.addEventListener('change', applyTheme);
const darkPagesBox = $('#dark-pages');
darkPagesBox.checked = settings.darkPages;
darkPagesBox.addEventListener('change', () => { settings.darkPages = darkPagesBox.checked; saveSettings(); applyTheme(); });

const highlightBox = $('#highlight');
highlightBox.checked = settings.highlight;
highlightBox.addEventListener('change', () => { settings.highlight = highlightBox.checked; saveSettings(); applyHighlight(); });

const syncBox = $('#sync');
syncBox.checked = settings.sync;
syncBox.addEventListener('change', () => { settings.sync = syncBox.checked; saveSettings(); if (settings.sync) syncFrom('editor'); });

$('#editor-zoom-in').onclick = () => setEditorFontSize(settings.editorFontSize + 1);
$('#editor-zoom-out').onclick = () => setEditorFontSize(settings.editorFontSize - 1);
$('#preview-zoom-in').onclick = () => setPreviewZoom(currentPreviewZoom() * 1.1);
$('#preview-zoom-out').onclick = () => setPreviewZoom(currentPreviewZoom() / 1.1);
$('#preview-fit').onclick = () => setPreviewZoom(currentPreviewZoom(), { fit: !settings.previewFit });

$('#btn-new').onclick = () => cmdNew();
$('#btn-open').onclick = () => cmdOpen();
$('#btn-save').onclick = () => cmdSave();
$('#btn-export').onclick = () => cmdExport();

function setStatus(s, warnings = []) {
  const el = $('#status');
  el.textContent = s;
  el.classList.toggle('warn', warnings.length > 0);
  if (warnings.length) el.textContent = '⚠ ' + warnings[0] + (warnings.length > 1 ? ` (+${warnings.length - 1} more)` : '') + ' · ' + s;
  el.title = warnings.join('\n');
}

function setBusy(on) {
  $('#preview-pane').classList.toggle('busy', on);
}

// When the document sets its own page size, it wins over the toolbar.
function showDocSettings(fromDoc) {
  pageSel.disabled = fromDoc;
  pageSel.title = fromDoc ? 'Set by the document itself' : '';
}

// ---------- commands ----------
async function confirmDiscard() {
  return !isDirty() || platform.confirmDiscard(fileName);
}
async function cmdNew() {
  if (!(await confirmDiscard())) return;
  loadDocument('', null, 'Untitled.md');
}
async function cmdOpen() {
  if (!(await confirmDiscard())) return;
  const f = await platform.openFile();
  if (f) loadDocument(f.text, f.path, f.name);
}
async function cmdSave(saveAs = false) {
  const text = currentText();
  const r = await platform.saveFile({ path: saveAs ? null : filePath, name: fileName, text });
  if (!r) return;
  filePath = r.path || filePath;
  fileName = r.name || fileName;
  savedText = text;
  updateTitle();
  if (r.path) renderNow(); // base path for images may have changed
}
async function cmdExport() {
  setStatus('Exporting PDF…');
  const { html } = buildDocument(currentText(), {
    assetBase: APP_ROOT, baseHref: baseHref(), pageSize: settings.pageSize, title: fileName,
  });
  try {
    const r = await platform.exportPdf({ html, name: fileName.replace(/\.(md|markdown|txt)$/i, '') + '.pdf', path: filePath, frame: frames[front] });
    setStatus(r ? `Exported ${r}` : 'Export cancelled');
  } catch (err) {
    setStatus('Export failed: ' + err.message);
  }
}

// ---------- table / columns tools (floating over the editor) ----------
const toolsEl = $('#struct-tools');
let toolsRaf = 0;
function scheduleTools() { cancelAnimationFrame(toolsRaf); toolsRaf = requestAnimationFrame(updateTools); }

function toolButton(label, title, fn, enabled = true) {
  const b = document.createElement('button');
  b.textContent = label;
  b.title = title;
  b.disabled = !enabled;
  b.onmousedown = (e) => e.preventDefault(); // keep the editor's focus and cursor
  b.onclick = () => { fn(); editor.focus(); };
  return b;
}

function replaceLines(from, to, text) {
  // Replace whole lines [from, to) (0-based) with `text` (null deletes them).
  const doc = editor.state.doc;
  const start = doc.line(from + 1).from;
  if (text === null) {
    const end = to < doc.lines ? doc.line(to + 1).from : doc.length;
    return { from: start, to: end, insert: '' };
  }
  const end = doc.line(to).to;
  return { from: start, to: end, insert: text };
}

function updateTools() {
  const st = editor.state;
  const head = st.selection.main.head;
  const line = st.doc.lineAt(head);
  const text = st.doc.toString();
  const t = tableAt(text, line.number - 1, head - line.from);
  const c = t ? null : columnsAt(text, line.number - 1);
  toolsEl.replaceChildren();
  if (!t && !(c && c.children.length)) { toolsEl.hidden = true; return; }
  const label = document.createElement('span');
  label.textContent = t ? 'Table' : 'Columns';
  toolsEl.append(label);
  if (t) {
    const run = (op) => {
      const r = editTable(editor.state.doc.toString(), tableAt(editor.state.doc.toString(), line.number - 1, head - line.from), op);
      if (!r) return;
      const ch = replaceLines(r.from, r.from + (r.to - r.from), r.text);
      const lines = r.text.split('\n');
      const rowText = lines[r.cursor.line - r.from];
      let pos = ch.from;
      for (let i = 0; i < r.cursor.line - r.from; i++) pos += lines[i].length + 1;
      editor.dispatch({ changes: ch, selection: { anchor: pos + cellOffset(rowText, r.cursor.cell) } });
    };
    toolsEl.append(
      toolButton('+ Row above', 'Insert a row above this one', () => run('rowAbove'), t.row >= 1),
      toolButton('+ Row below', 'Insert a row below this one', () => run('rowBelow')),
      toolButton('+ Col left', 'Insert a column left of this one', () => run('colLeft')),
      toolButton('+ Col right', 'Insert a column right of this one', () => run('colRight')),
      toolButton('− Row', 'Delete this row', () => run('delRow'), t.row >= 1),
      toolButton('− Col', 'Delete this column', () => run('delCol'), t.cols > 1),
    );
  } else {
    const run = (op) => {
      const cur = columnsAt(editor.state.doc.toString(), line.number - 1);
      const r = cur && editColumns(editor.state.doc.toString(), cur, op);
      if (!r) return;
      const doc = editor.state.doc;
      if (r.insertLines) {
        const pos = doc.line(r.from + 1).from;
        const insert = r.text + '\n';
        const at = insert.indexOf(r.select);
        editor.dispatch({ changes: { from: pos, insert }, selection: { anchor: pos + at, head: pos + at + r.select.length } });
      } else {
        const ch = replaceLines(r.from, r.to, null);
        editor.dispatch({ changes: ch, selection: { anchor: Math.min(ch.from, doc.length - (ch.to - ch.from)) } });
      }
    };
    toolsEl.append(
      toolButton('+ Col left', 'Insert a column left of this one', () => run('colLeft')),
      toolButton('+ Col right', 'Insert a column right of this one', () => run('colRight')),
      toolButton('− Col', 'Delete this column', () => run('delCol'), c.children.length > 1),
    );
  }
  // Float just above the cursor's line, at the right edge of the editor.
  const coords = editor.coordsAtPos(line.from);
  const host = editorHost.getBoundingClientRect();
  if (!coords || coords.bottom < host.top || coords.top > host.bottom) { toolsEl.hidden = true; return; }
  toolsEl.hidden = false;
  const h = toolsEl.offsetHeight;
  let top = coords.top - host.top - h - 4;
  if (top < 4) top = coords.bottom - host.top + 4;
  toolsEl.style.top = top + 'px';
}
editorScroller.addEventListener('scroll', scheduleTools, { passive: true });

// ---------- insert menu & editor context menu ----------
const menuEl = $('#menu');

function showMenu(x, y, items) {
  menuEl.replaceChildren();
  for (const item of items) {
    if (item === '-') { menuEl.append(document.createElement('hr')); continue; }
    if (item.title) {
      const t = document.createElement('div');
      t.className = 'menu-title';
      t.textContent = item.title;
      menuEl.append(t);
      continue;
    }
    const b = document.createElement('button');
    b.textContent = item.label;
    b.onclick = () => { hideMenu(); item.action(); };
    menuEl.append(b);
  }
  menuEl.hidden = false;
  const r = menuEl.getBoundingClientRect();
  menuEl.style.left = Math.max(4, Math.min(x, innerWidth - r.width - 4)) + 'px';
  menuEl.style.top = Math.max(4, Math.min(y, innerHeight - r.height - 4)) + 'px';
  menuEl.querySelector('button')?.focus();
}
function hideMenu() { menuEl.hidden = true; }

menuEl.addEventListener('keydown', (e) => {
  const buttons = [...menuEl.querySelectorAll('button')];
  const i = buttons.indexOf(document.activeElement);
  if (e.key === 'ArrowDown') { e.preventDefault(); buttons[(i + 1) % buttons.length].focus(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); buttons[(i - 1 + buttons.length) % buttons.length].focus(); }
  else if (e.key === 'Escape') { hideMenu(); editor.focus(); }
});
window.addEventListener('pointerdown', (e) => { if (!menuEl.hidden && !menuEl.contains(e.target)) hideMenu(); }, true);
window.addEventListener('blur', hideMenu);

function templateItems() {
  const wrapping = !editor.state.selection.main.empty;
  return TEMPLATES.map((t) => ({
    label: t.label + (t.id === 'image' || t.id === 'figure' ? '…' : '') + (wrapping && t.wrap && wrapApplies(t) ? ' (wrap selection)' : ''),
    action: () => insertTemplate(t),
  }));
}

// Whether a template with a condition (e.g. "only tables") would wrap the current selection.
function wrapApplies(t) {
  if (!t.wrapIf) return true;
  const st = editor.state, sel = st.selection.main, text = st.doc.toString();
  const range = expandToBlocks(text, st.doc.lineAt(sel.from).number - 1, st.doc.lineAt(sel.to).number - 1);
  const blk = blockAt(text, range.from);
  return !!blk && blk.start === range.from && blk.end - 1 >= range.to && t.wrapIf(blk.type);
}

// With text selected, templates that can wrap do so. Selections inside one line
// wrap inline where that exists (math -> $…$, code -> `…`); otherwise the selection
// is expanded to whole Markdown blocks first, so a half-selected formula, table or
// list is always wrapped whole rather than cut in two.
function wrapSelection(t) {
  const st = editor.state;
  const sel = st.selection.main;
  const doc = st.doc;
  const a = doc.lineAt(sel.from), b = doc.lineAt(sel.to === sel.from ? sel.to : sel.to - (doc.lineAt(sel.to).from === sel.to ? 1 : 0));
  const text = doc.toString();
  const selected = st.sliceDoc(sel.from, sel.to);
  const inlineOk = a.number === b.number && selected.trim() && selected.trim() !== a.text.trim() && !selected.includes('\n');
  if (inlineOk && (t.id === 'math' || t.id === 'code')) {
    const w = t.wrap(selected.trim(), true);
    const lead = selected.length - selected.trimStart().length, trail = selected.length - selected.trimEnd().length;
    const from = sel.from + lead, to = sel.to - trail;
    editor.dispatch({ changes: { from, to, insert: w.text }, selection: { anchor: from, head: from + w.text.length }, scrollIntoView: true });
    return true;
  }
  const range = expandToBlocks(text, a.number - 1, b.number - 1);
  const blk = blockAt(text, range.from);
  const sameBlock = blk && blk.start === range.from && blk.end - 1 >= range.to;
  if (t.wrapIf && !(sameBlock && t.wrapIf(blk.type))) return false;
  if (t.already && sameBlock && t.already(blk.type)) {
    setStatus(`That's already a ${t.label.toLowerCase()} block`);
    return true;
  }
  const from = doc.line(range.from + 1).from, to = doc.line(range.to + 1).to;
  const content = st.sliceDoc(from, to);
  const w = t.wrap(content, false);
  const at = w.select ? w.text.lastIndexOf(w.select) : -1;
  editor.dispatch({
    changes: { from, to, insert: w.text },
    selection: at >= 0 ? { anchor: from + at, head: from + at + w.select.length } : { anchor: from, head: from + w.text.length },
    scrollIntoView: true,
  });
  return true;
}

async function insertTemplate(t) {
  if (t.wrap && !editor.state.selection.main.empty && wrapSelection(t)) { editor.focus(); return; }
  let text = t.text;
  let select = t.select;
  if ((t.id === 'image' || t.id === 'figure') && platform.pickImage) {
    const src = await platform.pickImage(filePath);
    if (src === null) return; // cancelled
    if (src) { text = text.replace('image.png', src.replace(/"/g, '&quot;')); select = t.id === 'figure' ? 'Caption' : '60%'; }
  }
  const st = editor.state;
  let from, to, insert;
  if (t.atTop) {
    if (/^---[ \t]*\r?\n/.test(st.doc.toString())) {
      editor.dispatch({ selection: { anchor: 0 }, scrollIntoView: true });
      editor.focus();
      setStatus('This document already has settings at the top');
      return;
    }
    from = to = 0;
    insert = text + '\n\n';
  } else {
    // Always on its own lines, with a blank line before and after.
    const line = st.doc.lineAt(st.selection.main.to);
    const blank = (n) => n < 1 || n > st.doc.lines || st.doc.line(n).text.trim() === '';
    if (line.text.trim() === '') {
      from = line.from; to = line.to;
      insert = (blank(line.number - 1) ? '' : '\n') + text + (blank(line.number + 1) ? '' : '\n');
    } else {
      from = to = line.to;
      insert = '\n\n' + text + (blank(line.number + 1) ? '\n' : '\n\n');
    }
  }
  const at = select ? insert.indexOf(select) : -1;
  const selection = at >= 0
    ? { anchor: from + at, head: from + at + select.length }
    : { anchor: from + insert.trimEnd().length };
  editor.dispatch({ changes: { from, to, insert }, selection, scrollIntoView: true });
  editor.focus();
}

$('#btn-insert').onclick = (e) => {
  const r = e.currentTarget.getBoundingClientRect();
  showMenu(r.left, r.bottom + 4, templateItems());
};

editorHost.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  const hasSelection = !editor.state.selection.main.empty;
  showMenu(e.clientX, e.clientY, [
    ...(hasSelection ? [{ label: 'Cut', action: () => editCommand('cut') }, { label: 'Copy', action: () => editCommand('copy') }] : []),
    { label: 'Paste', action: () => editCommand('paste') },
    { label: 'Select all', action: () => editCommand('selectAll') },
    '-',
    { title: 'Insert' },
    ...templateItems(),
  ]);
});

async function editCommand(cmd) {
  editor.focus();
  if (platform.editCommand) return platform.editCommand(cmd);
  if (cmd === 'paste') {
    try {
      const text = await navigator.clipboard.readText();
      editor.dispatch(editor.state.replaceSelection(text));
    } catch { setStatus('Paste with Ctrl+V'); }
  } else if (cmd === 'selectAll') {
    editor.dispatch({ selection: { anchor: 0, head: editor.state.doc.length } });
  } else {
    document.execCommand(cmd);
  }
}

function handleShortcut(e) {
  const mod = e.ctrlKey || e.metaKey;
  if (!mod) return;
  const k = e.key.toLowerCase();
  if (k === 's') { e.preventDefault(); cmdSave(e.shiftKey); }
  else if (k === 'o') { e.preventDefault(); cmdOpen(); }
  else if (k === 'n') { e.preventDefault(); cmdNew(); }
  else if (k === 'e' || k === 'p') { e.preventDefault(); cmdExport(); }
  else if (k === '=' || k === '+' || k === '-' || k === '0') {
    e.preventDefault();
    const inPreview = activePane === 'preview';
    if (k === '0') inPreview ? setPreviewZoom(1, { fit: true }) : setEditorFontSize(14);
    else {
      const up = k !== '-';
      if (inPreview) setPreviewZoom(currentPreviewZoom() * (up ? 1.1 : 1 / 1.1));
      else setEditorFontSize(settings.editorFontSize + (up ? 1 : -1));
    }
  }
}
window.addEventListener('keydown', handleShortcut);

platform.onMenu?.((cmd) => {
  ({ new: cmdNew, open: cmdOpen, save: () => cmdSave(false), saveAs: () => cmdSave(true), export: cmdExport })[cmd]?.();
});
platform.onOpenPath?.((f) => loadDocument(f.text, f.path, f.name));

// ---------- boot ----------
applySplit();
applyTheme();
setEditorFontSize(settings.editorFontSize);
const scratch = localStorageGet('mdpdf.scratch');
loadDocument(scratch != null && scratch !== '' ? scratch : WELCOME, null, 'Untitled.md');
if (scratch) savedText = ''; // unsaved scratch text counts as dirty
updateTitle();

// Exposed for debugging / tests.
window.__mdpdf = { editor, frames: () => frames[front], anchors, syncFrom, settings, renderFull: () => renderNow({ full: true }), get preview() { return preview; } };
