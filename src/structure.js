// Editing helpers that understand document structure: expanding a selection to
// whole blocks, wrapping blocks, and adding/removing table rows/columns and
// layout columns. All functions work on plain text + 0-based line numbers and
// return a change description; the app applies it to the editor.
import { topLevelBlocks } from './markdown.js';
import { parseFrontMatter } from './frontmatter.js';

const lines = (text) => text.split('\n');

/** Expand [fromLine, toLine] (inclusive) to cover every top-level block it touches. */
export function expandToBlocks(text, fromLine, toLine) {
  const fm = parseFrontMatter(text);
  const fmLines = fm.body === text ? 0 : fm.body.length - fm.body.replace(/^\n+/, '').length;
  let a = Math.max(fromLine, fmLines), b = Math.max(toLine, a);
  // Repeat until stable: a block pulled in can overlap another one.
  for (let changed = true; changed; ) {
    changed = false;
    for (const blk of topLevelBlocks(fm.body)) {
      if (blk.start <= b && blk.end - 1 >= a) {
        if (blk.start < a) { a = blk.start; changed = true; }
        if (blk.end - 1 > b) { b = blk.end - 1; changed = true; }
      }
    }
  }
  // Trim blank lines at the edges.
  const ls = lines(text);
  while (a < b && !ls[a].trim()) a++;
  while (b > a && !ls[b].trim()) b--;
  return { from: a, to: b };
}

/** The top-level block containing a line, if any. */
export function blockAt(text, line) {
  const fm = parseFrontMatter(text);
  return topLevelBlocks(fm.body).find((b) => b.start <= line && line < b.end) || null;
}

// ---------- pipe tables ----------

// Split a table row into cells on unescaped pipes (the same rule Markdown uses).
function splitRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && s[i + 1] === '|') { cur += '\\|'; i++; continue; }
    if (s[i] === '|') { cells.push(cur.trim()); cur = ''; continue; }
    cur += s[i];
  }
  cells.push(cur.trim());
  return cells;
}

/** Which cell (0-based) a column offset on a row line falls in. */
function cellIndexAt(line, ch) {
  const lead = line.length - line.trimStart().length;
  let s = line.slice(0, ch);
  let idx = 0, i = 0;
  if (line.trimStart().startsWith('|')) i = lead + 1;
  for (; i < s.length; i++) {
    if (s[i] === '\\' && s[i + 1] === '|') { i++; continue; }
    if (s[i] === '|') idx++;
  }
  return idx;
}

const alignOf = (cell) => {
  const l = cell.startsWith(':'), r = cell.endsWith(':');
  return l && r ? 'center' : r ? 'right' : l ? 'left' : null;
};

function formatTable(rows, aligns) {
  const n = Math.max(...rows.map((r) => r.length), aligns.length);
  const widths = Array.from({ length: n }, (_, c) => Math.max(3, ...rows.map((r) => (r[c] || '').length)));
  const fmtRow = (r) => '| ' + widths.map((w, c) => (r[c] || '').padEnd(w)).join(' | ') + ' |';
  const delim = '|' + widths.map((w, c) => {
    const a = aligns[c];
    const dashes = '-'.repeat(w);
    if (a === 'center') return ':' + dashes.slice(2) + ':';
    if (a === 'right') return dashes.slice(1) + ':';
    if (a === 'left') return ':' + dashes.slice(1);
    return dashes;
  }).map((d) => ' ' + d + ' ').join('|') + '|';
  return [fmtRow(rows[0]), delim, ...rows.slice(1).map(fmtRow)];
}

/** Table under the cursor: { start, end, row, col, cols } (row: 0 = header, -1 = delimiter line). */
export function tableAt(text, line, ch) {
  const blk = blockAt(text, line);
  if (!blk || blk.type !== 'table') return null;
  const ls = lines(text);
  const row = line === blk.start ? 0 : line === blk.start + 1 ? -1 : line - blk.start - 1;
  return { start: blk.start, end: blk.end, row, col: cellIndexAt(ls[line], ch), cols: splitRow(ls[blk.start]).length };
}

/**
 * Edit the table under the cursor. op: 'rowAbove' | 'rowBelow' | 'colLeft' | 'colRight' | 'delRow' | 'delCol'.
 * Returns { from, to, text, cursor: { line, cell } } with lines [from, to) replaced by text, or null.
 */
export function editTable(text, t, op) {
  const ls = lines(text).slice(t.start, t.end);
  while (ls.length && !ls[ls.length - 1].trim()) ls.pop();
  const delim = splitRow(ls[1]);
  const aligns = delim.map(alignOf);
  const rows = [splitRow(ls[0]), ...ls.slice(2).map(splitRow)];
  const n = Math.max(...rows.map((r) => r.length));
  for (const r of rows) while (r.length < n) r.push('');
  let bodyIndex = t.row <= 0 ? 0 : t.row; // index into rows (0 = header)
  let col = Math.min(Math.max(t.col, 0), n - 1);
  let cursor = { row: bodyIndex, col };
  switch (op) {
    case 'rowBelow': {
      const at = Math.max(bodyIndex, 0) + 1;
      rows.splice(at, 0, Array(n).fill(''));
      cursor = { row: at, col };
      break;
    }
    case 'rowAbove': {
      if (bodyIndex < 1) return null; // nothing goes above the header
      rows.splice(bodyIndex, 0, Array(n).fill(''));
      cursor = { row: bodyIndex, col };
      break;
    }
    case 'delRow': {
      if (bodyIndex < 1 || rows.length <= 2) return null; // keep the header and one row
      rows.splice(bodyIndex, 1);
      cursor = { row: Math.min(bodyIndex, rows.length - 1), col };
      break;
    }
    case 'colLeft':
    case 'colRight': {
      const at = op === 'colLeft' ? col : col + 1;
      rows.forEach((r, i) => r.splice(at, 0, i === 0 ? 'Header' : ''));
      aligns.splice(at, 0, null);
      cursor = { row: 0, col: at };
      break;
    }
    case 'delCol': {
      if (n <= 1) return null;
      rows.forEach((r) => r.splice(col, 1));
      aligns.splice(col, 1);
      cursor = { row: bodyIndex, col: Math.min(col, n - 2) };
      break;
    }
    default: return null;
  }
  const out = formatTable(rows, aligns);
  const cursorLine = cursor.row === 0 ? 0 : cursor.row + 1;
  return { from: t.start, to: t.start + ls.length, text: out.join('\n'), cursor: { line: t.start + cursorLine, cell: cursor.col } };
}

/** Character offset of the start of a cell's content in a formatted row. */
export function cellOffset(rowText, cell) {
  let idx = -1;
  for (let i = 0; i < rowText.length; i++) {
    if (rowText[i] === '\\' && rowText[i + 1] === '|') { i++; continue; }
    if (rowText[i] === '|') {
      idx++;
      if (idx === cell) return i + 2;
    }
  }
  return 0;
}

// ---------- layout columns (<div class="columns">) ----------

const OPEN_DIV = /<div\b/gi;
const CLOSE_DIV = /<\/div\s*>/gi;
const count = (s, re) => (s.match(re) || []).length;
const COLUMNS_OPEN = /^\s*<div\b[^>]*\bclass\s*=\s*["'][^"']*\bcolumns\b[^"']*["'][^>]*>/i;

/**
 * The columns block around a line: { start, end, children: [{ start, end }] }
 * (inclusive line numbers) and `col`, the child the line is in (or the nearest).
 */
export function columnsAt(text, line) {
  const ls = lines(text);
  for (let s = line; s >= 0; s--) {
    if (!COLUMNS_OPEN.test(ls[s])) continue;
    // Walk forward counting <div> depth to find the children and the end.
    let depth = 0, end = -1, child = null;
    const children = [];
    let inFence = false;
    for (let i = s; i < ls.length; i++) {
      if (/^\s*(```|~~~)/.test(ls[i])) inFence = !inFence;
      if (inFence) continue;
      const opens = count(ls[i], OPEN_DIV), closes = count(ls[i], CLOSE_DIV);
      for (let k = 0; k < opens; k++) {
        depth++;
        if (depth === 2 && !child) child = { start: i };
      }
      for (let k = 0; k < closes; k++) {
        if (depth === 2 && child) { child.end = i; children.push(child); child = null; }
        depth--;
      }
      if (depth <= 0) { end = i; break; }
    }
    if (end < 0) return null; // never closed
    if (line > end) return null; // the cursor is after this block
    let col = children.findIndex((c) => c.start <= line && line <= c.end);
    if (col < 0) {
      col = children.findIndex((c) => c.start > line);
      col = col < 0 ? children.length - 1 : Math.max(0, col - 1);
    }
    return { start: s, end, children, col };
  }
  return null;
}

const NEW_COLUMN = ['<div data-width="1" data-align="left">', '', 'New column', '', '</div>'];

/** op: 'colLeft' | 'colRight' | 'delCol'. Returns { from, to, text, select } (lines [from, to) replaced). */
export function editColumns(text, c, op) {
  const ls = lines(text);
  const child = c.children[c.col];
  if (!child) return null;
  if (op === 'delCol') {
    if (c.children.length <= 1) return null;
    return { from: child.start, to: child.end + 1, text: null, select: null };
  }
  const at = op === 'colLeft' ? child.start : child.end + 1;
  return { from: at, to: at, text: NEW_COLUMN.join('\n'), select: 'New column', insertLines: true };
}
