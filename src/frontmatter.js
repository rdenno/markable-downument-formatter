// Optional document settings in a YAML block at the very top of the file:
//
//   ---
//   page-size: letter
//   margin: 1in
//   font: Arial
//   font-size: 12pt
//   page-numbers: false
//   ---
//
// Names follow Pandoc where Pandoc has one (papersize, fontsize, mainfont,
// linestretch, geometry: margin=...), so files written for Pandoc mostly work.
import yaml from 'js-yaml';

const FENCE = /^---[ \t]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/;

const ALIASES = {
  'page-size': 'pageSize', papersize: 'pageSize', 'paper-size': 'pageSize', size: 'pageSize',
  orientation: 'orientation',
  margin: 'margin', margins: 'margin', geometry: 'geometry',
  font: 'font', mainfont: 'font', 'font-family': 'font',
  'font-size': 'fontSize', fontsize: 'fontSize',
  'line-height': 'lineHeight', linestretch: 'lineHeight',
  'text-align': 'textAlign',
  'page-numbers': 'pageNumbers', 'page-number': 'pageNumbers',
  title: 'title', author: 'author', date: 'date', lang: 'lang',
};

const PAGE_NUMBER_SPOTS = ['bottom-center', 'bottom-right', 'bottom-left', 'top-center', 'top-right', 'top-left'];

// Values go into CSS: reject anything that could break out of a declaration.
const SAFE = /^[^;{}<>\\]*$/;

/**
 * Split front matter from the markdown. The front matter lines are replaced by
 * blank lines so source line numbers (used by scroll sync) stay the same.
 * @returns {{ body: string, settings: object, css: string, warnings: string[] }}
 */
export function parseFrontMatter(text) {
  const result = { body: text, settings: {}, css: '', warnings: [] };
  const m = FENCE.exec(text);
  if (!m) return result;
  const blankLines = m[0].split('\n').length - 1;
  result.body = '\n'.repeat(blankLines) + text.slice(m[0].length);

  let data;
  try {
    data = yaml.load(m[1]);
  } catch (err) {
    result.warnings.push('Front matter: ' + (err.reason || err.message) + (err.mark ? ` (line ${err.mark.line + 2})` : ''));
    return result;
  }
  if (data == null) return result;
  if (typeof data !== 'object' || Array.isArray(data)) {
    result.warnings.push('Front matter should be a list of "key: value" lines');
    return result;
  }

  const s = {};
  for (const [rawKey, value] of Object.entries(data)) {
    const key = ALIASES[rawKey.toLowerCase()];
    if (!key) { result.warnings.push(`Front matter: unknown setting "${rawKey}"`); continue; }
    if (value != null && typeof value === 'object' && !(value instanceof Date)) {
      if (key !== 'author') { result.warnings.push(`Front matter: "${rawKey}" should be a single value`); continue; }
    }
    if (typeof value === 'string' && !SAFE.test(value) && !['title', 'author'].includes(key)) {
      result.warnings.push(`Front matter: "${rawKey}" has characters that aren't allowed`);
      continue;
    }
    s[key] = value;
  }
  if (s.geometry != null) {
    const gm = /margin\s*=\s*([^,]+)/.exec(String(s.geometry));
    if (gm && s.margin == null) s.margin = gm[1].trim();
    delete s.geometry;
  }
  result.settings = s;
  result.css = settingsToCss(s, result.warnings);
  return result;
}

const unit = (v, def) => (typeof v === 'number' ? v + def : String(v).trim());

function settingsToCss(s, warnings) {
  const page = [];
  const body = [];
  if (s.pageSize != null || s.orientation != null) {
    // Paged.js knows page names in a fixed case: A4, B5, letter, legal, ledger.
    let size = s.pageSize != null ? String(s.pageSize).trim().replace(/\b([ab])(\d)\b/gi, (_, l, d) => l.toUpperCase() + d)
      .replace(/\b(letter|legal|ledger|landscape|portrait)\b/gi, (w) => w.toLowerCase()) : '';
    if (/^(a\d|b\d|letter|legal|ledger|executive)$/i.test(size) || size === '') {
      if (s.orientation != null) {
        const o = String(s.orientation).toLowerCase();
        if (o === 'landscape' || o === 'portrait') size = (size || 'A4') + ' ' + o;
        else warnings.push('Front matter: orientation should be "portrait" or "landscape"');
      }
    }
    if (size) page.push(`size: ${size};`);
  }
  if (s.margin != null) page.push(`margin: ${unit(s.margin, 'mm')};`);
  if (s.pageNumbers != null) {
    const v = s.pageNumbers;
    const off = PAGE_NUMBER_SPOTS.map((spot) => `@${spot} { content: none; }`).join(' ');
    if (v === false || v === 'none' || v === 'false') page.push(off);
    else if (v === true || v === 'true') { /* default: bottom-center */ }
    else if (PAGE_NUMBER_SPOTS.includes(String(v))) {
      page.push(off, `@${v} { content: counter(page); font: 9pt/1 -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; color: #888; }`);
    } else warnings.push(`Front matter: page-numbers should be true, false, or one of ${PAGE_NUMBER_SPOTS.join(', ')}`);
  }
  if (s.font != null) {
    const fonts = String(s.font).split(',').map((f) => f.trim()).filter(Boolean)
      .map((f) => (/^(serif|sans-serif|monospace|system-ui|cursive)$/.test(f) || /^["']/.test(f) ? f : `"${f.replace(/"/g, '')}"`));
    body.push(`font-family: ${fonts.join(', ')};`);
  }
  if (s.fontSize != null) body.push(`font-size: ${unit(s.fontSize, 'pt')};`);
  if (s.lineHeight != null) body.push(`line-height: ${String(s.lineHeight).trim()};`);
  if (s.textAlign != null) body.push(`text-align: ${String(s.textAlign).trim()};`);

  let css = '';
  if (page.length) css += `@page { ${page.join(' ')} }\n`;
  if (body.length) css += `body { ${body.join(' ')} }\n`;
  return css;
}
