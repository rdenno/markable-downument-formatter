import { createEditor, setEditorDoc, editorYForLine, setEditorDark } from './editor.js';
import { buildDocument, PAGE_SIZE_NAMES } from './document.js';
import { measurePreviewBlocks, buildAnchors, mapY, referenceY, scrollTopForReference } from './sync.js';
import { platform } from './platform.js';
import { planIncremental } from './incremental.js';
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
  onCursor: (line) => { cursorLine = line; scheduleHighlight(); },
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
  job = { frame, text, key, target: pagesInView(), swapped: false, done: false, started: performance.now(), pages: 0,
    prevHeight: preview.scrollHeight, skip: plan ? plan.skipPages : 0, prefixFrom: plan ? frames[front] : null };
  setStatus('Rendering…');
  setBusy(true);
  armWatchdog(job);
  const built = buildDocument(text, {
    assetBase: APP_ROOT, baseHref: baseHref(), pageSize: settings.pageSize, title: fileName,
    pagesLeft: centeredLeft(), startLine: plan ? plan.startLine : null, darkPages: pagesAreDark(),
  });
  job.warnings = built.warnings;
  showDocSettings(built.docSetsSize);
  frame.srcdoc = built.html;
}

// Called from inside the rendering frame: copies of the pages it can reuse.
window.__mdpdfPrefixPages = (doc) => {
  const j = job;
  if (!j || !j.prefixFrom || doc !== j.frame.contentDocument) return null;
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
  if (!j || j.done || e.source !== j.frame.contentWindow) return;
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
  for (const f of frames) f.contentDocument?.documentElement?.classList.toggle('mdpdf-dark', pagesAreDark());
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
  if (settings.previewFit && preview.pageWidth) z = W / (preview.pageWidth + 48); // room for padding + scrollbar
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
