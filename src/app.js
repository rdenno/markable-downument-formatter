import { createEditor, setEditorDoc, editorYForLine } from './editor.js';
import { buildDocument, PAGE_SIZE_NAMES } from './document.js';
import { measurePreviewBlocks, buildAnchors, mapY, referenceY, scrollTopForReference } from './sync.js';
import { platform } from './platform.js';
import WELCOME from './welcome.md';

const $ = (sel) => document.querySelector(sel);
const APP_ROOT = new URL('./', location.href).href;

// ---------- persisted settings ----------
const settings = Object.assign(
  { pageSize: 'A4', editorFontSize: 14, previewZoom: 1, previewFit: true, split: 0.5, sync: true },
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
  onGeometry: () => { if (!rendering) onScroll(activePane, true); },
});
const editorScroller = editor.scrollDOM;

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
// Two iframes: one visible, one rendering in the background. When the
// background one finishes paginating we swap them, so typing never flickers.
const frames = [$('#frame-a'), $('#frame-b')];
let front = 0;
let rendering = false;
let pending = false;
let renderTimer = null;
let preview = { blocks: [], scrollHeight: 0, pageWidth: 0 };

function scheduleRender() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(renderNow, 250);
}

function baseHref() {
  return filePath ? platform.dirUrl(filePath) : APP_ROOT;
}

function renderNow() {
  clearTimeout(renderTimer);
  if (rendering) { pending = true; return; }
  rendering = true;
  pending = false;
  setStatus('Rendering…');
  const started = performance.now();
  const back = frames[1 - front];
  const html = buildDocument(currentText(), {
    assetBase: APP_ROOT, baseHref: baseHref(), pageSize: settings.pageSize, title: fileName,
  });

  const onMessage = (e) => {
    if (e.source !== back.contentWindow || e.data?.type !== 'paged-done') return;
    window.removeEventListener('message', onMessage);
    clearTimeout(watchdog);
    finish();
  };
  // A broken document should never wedge the preview.
  const watchdog = setTimeout(() => { window.removeEventListener('message', onMessage); finish(); }, 20000);
  window.addEventListener('message', onMessage);

  const finish = () => {
    // Re-render in progress may have been superseded; still swap what we have.
    const oldFront = frames[front];
    const prevScroll = previewScroller(oldFront);
    const keepPreviewPosition = activePane === 'preview' && prevScroll;
    const oldTop = prevScroll ? prevScroll.scrollTop : 0;

    back.style.visibility = 'visible';
    back.style.zIndex = '1';
    applyPreviewZoom(back);
    attachPreviewListeners(back);
    remeasurePreview(back);

    const sc = previewScroller(back);
    if (sc) {
      if (keepPreviewPosition) sc.scrollTop = oldTop;
      else syncFrom('editor', back);
    }
    oldFront.style.visibility = 'hidden';
    oldFront.style.zIndex = '0';
    front = 1 - front;

    const pages = back.contentDocument?.querySelectorAll('.pagedjs_page').length || 0;
    setStatus(`${pages} page${pages === 1 ? '' : 's'} · ${Math.round(performance.now() - started)} ms`);
    rendering = false;
    if (pending) renderNow();
  };

  back.srcdoc = html;
}

function previewScroller(frame) {
  const d = frame.contentDocument;
  return d && (d.scrollingElement || d.documentElement);
}

function remeasurePreview(frame = frames[front]) {
  const d = frame.contentDocument;
  if (!d) return;
  const m = measurePreviewBlocks(d);
  const page = d.querySelector('.pagedjs_page');
  preview = { ...m, pageWidth: page ? page.offsetWidth : 0 };
}

// ---------- zoom ----------
function applyPreviewZoom(frame = frames[front]) {
  const d = frame.contentDocument;
  if (!d || !d.documentElement) return;
  let zoom = settings.previewZoom;
  if (settings.previewFit) {
    const page = d.querySelector('.pagedjs_page');
    if (page) {
      d.documentElement.style.zoom = '1';
      const avail = frame.clientWidth - 32;
      zoom = Math.max(0.1, avail / page.offsetWidth);
    }
  }
  d.documentElement.style.zoom = String(zoom);
  $('#preview-zoom-label').textContent = Math.round(zoom * 100) + '%';
  $('#preview-fit').classList.toggle('active', settings.previewFit);
}

function setPreviewZoom(z, { fit = false } = {}) {
  const frame = frames[front];
  const sc = previewScroller(frame);
  const ref = sc ? referenceY(sc.scrollTop, sc.clientHeight, sc.scrollHeight) / Math.max(1, sc.scrollHeight) : 0;
  settings.previewFit = fit;
  if (!fit) settings.previewZoom = Math.min(4, Math.max(0.2, z));
  saveSettings();
  applyPreviewZoom(frame);
  remeasurePreview(frame);
  // Keep roughly the same spot in view, then realign with the editor.
  if (sc) sc.scrollTop = scrollTopForReference(ref * sc.scrollHeight, sc.clientHeight, sc.scrollHeight);
  if (settings.sync) syncFrom('editor');
}

function currentPreviewZoom() {
  const d = frames[front].contentDocument;
  return d ? parseFloat(d.documentElement.style.zoom) || 1 : settings.previewZoom;
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
  if (source === 'editor') {
    const y = referenceY(editorScroller.scrollTop, editorScroller.clientHeight, editorScroller.scrollHeight);
    const py = mapY(a, y, 0, 1);
    psc.scrollTop = scrollTopForReference(py, psc.clientHeight, psc.scrollHeight);
  } else {
    const y = referenceY(psc.scrollTop, psc.clientHeight, psc.scrollHeight);
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
    if (settings.previewFit) applyPreviewZoom();
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

function setStatus(s) { $('#status').textContent = s; }

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
  const html = buildDocument(currentText(), {
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
setEditorFontSize(settings.editorFontSize);
const scratch = localStorageGet('mdpdf.scratch');
loadDocument(scratch != null && scratch !== '' ? scratch : WELCOME, null, 'Untitled.md');
if (scratch) savedText = ''; // unsaved scratch text counts as dirty
updateTitle();

// Exposed for debugging / tests.
window.__mdpdf = { editor, frames: () => frames[front], anchors, syncFrom, settings, get preview() { return preview; } };
