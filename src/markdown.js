// Markdown -> HTML. Standard CommonMark + GFM tables/strikethrough via
// markdown-it, raw HTML passthrough, KaTeX math, and source-line
// annotations (data-line / data-line-end) used for scroll sync.
import MarkdownIt from 'markdown-it';
import katexPlugin from '@vscode/markdown-it-katex';
import katex from 'katex';
import hljs from 'highlight.js/lib/common';

const md = new MarkdownIt({
  html: true,        // any HTML/CSS works as-is: <div style="...">, <style>, <img width=...>
  linkify: true,
  typographer: false, // don't rewrite quotes/dashes behind the user's back
  // Syntax highlighting only when the fence names a known language (```python).
  // No guessing: an unlabelled block stays plain.
  highlight(code, lang) {
    const language = lang && hljs.getLanguage(lang) ? lang : null;
    if (!language) return '';
    try {
      return hljs.highlight(code, { language, ignoreIllegals: true }).value;
    } catch {
      return '';
    }
  },
});

// markdown-it rejects some URLs by default (e.g. SVG data: images). This is a
// local editor for your own documents, so accept anything a browser would,
// except script URLs.
md.validateLink = (url) => !/^\s*(javascript|vbscript):/i.test(url);

md.use(katexPlugin.default || katexPlugin, { throwOnError: false, enableFencedBlocks: true });

// LaTeX-style math delimiters, in addition to $...$ and $$...$$:
//   \( inline \)   and   \[ display \]  (inline in a paragraph, or as its own block)
function renderTex(tex, displayMode) {
  try {
    return katex.renderToString(tex, { displayMode, throwOnError: false });
  } catch (err) {
    return `<span class="katex-error">${md.utils.escapeHtml(String(err.message || err))}</span>`;
  }
}

md.inline.ruler.before('escape', 'math_tex_delims', (state, silent) => {
  const src = state.src, pos = state.pos;
  if (src.charCodeAt(pos) !== 0x5c /* \ */) return false;
  const open = src[pos + 1];
  if (open !== '(' && open !== '[') return false;
  const close = open === '(' ? '\\)' : '\\]';
  const end = src.indexOf(close, pos + 2);
  if (end < 0) return false;
  if (!silent) {
    const token = state.push(open === '(' ? 'math_tex_inline' : 'math_tex_display', 'math', 0);
    token.content = src.slice(pos + 2, end);
  }
  state.pos = end + 2;
  return true;
});
md.renderer.rules.math_tex_inline = (tokens, idx) => renderTex(tokens[idx].content, false);
md.renderer.rules.math_tex_display = (tokens, idx) => renderTex(tokens[idx].content, true);

// A block starting with \[ on its own line, ending at the line with \].
md.block.ruler.before('paragraph', 'math_tex_block', (state, startLine, endLine, silent) => {
  const lineText = (n) => state.src.slice(state.bMarks[n] + state.tShift[n], state.eMarks[n]);
  if (state.sCount[startLine] - state.blkIndent >= 4) return false;
  const first = lineText(startLine);
  if (!first.startsWith('\\[')) return false;
  let content, last = startLine;
  const sameLine = first.indexOf('\\]', 2);
  if (sameLine >= 0) {
    if (first.slice(sameLine + 2).trim()) return false; // text after \] -> leave it to the inline rule
    content = first.slice(2, sameLine);
  } else {
    const lines = [first.slice(2)];
    for (last = startLine + 1; last < endLine; last++) {
      const t = lineText(last);
      const at = t.indexOf('\\]');
      if (at >= 0) {
        if (t.slice(at + 2).trim()) return false;
        lines.push(t.slice(0, at));
        break;
      }
      lines.push(t);
    }
    if (last >= endLine) return false; // never closed
    content = lines.join('\n');
  }
  if (silent) return true;
  const token = state.push('math_block', 'math', 0);
  token.content = content;
  token.map = [startLine, last + 1];
  state.line = last + 1;
  return true;
}, { alt: ['paragraph', 'reference', 'blockquote', 'list'] });

// `\newpage` or `\pagebreak` alone on a line -> page break (same as Pandoc/LaTeX).
md.block.ruler.before('paragraph', 'page_break', (state, startLine, endLine, silent) => {
  const start = state.bMarks[startLine] + state.tShift[startLine];
  const line = state.src.slice(start, state.eMarks[startLine]).trim();
  if (line !== '\\newpage' && line !== '\\pagebreak') return false;
  if (silent) return true;
  const token = state.push('page_break', 'div', 0);
  token.map = [startLine, startLine + 1];
  state.line = startLine + 1;
  return true;
});
md.renderer.rules.page_break = (tokens, idx) =>
  `<div class="page-break" data-line="${tokens[idx].map[0]}" data-line-end="${tokens[idx].map[1]}"></div>\n`;

// Tag every block-level element with the source lines it came from.
md.core.ruler.push('source_lines', (state) => {
  for (const token of state.tokens) {
    if (token.map && token.nesting >= 0 && token.type !== 'page_break') {
      token.attrSet('data-line', String(token.map[0]));
      token.attrSet('data-line-end', String(token.map[1]));
    }
  }
});

// Renderers that ignore token attrs: wrap them so they get line info too.
function wrapWithLines(name, tag = 'div') {
  const orig = md.renderer.rules[name];
  md.renderer.rules[name] = (tokens, idx, options, env, self) => {
    const t = tokens[idx];
    const inner = orig ? orig(tokens, idx, options, env, self) : self.renderToken(tokens, idx, options);
    if (!t.map) return inner;
    return `<${tag} class="src-block" data-line="${t.map[0]}" data-line-end="${t.map[1]}">${inner}</${tag}>\n`;
  };
}
wrapWithLines('math_block');
wrapWithLines('fence'); // fenced code (and ```math) — the <pre> is measured, not just <code>

// Fence renderer puts attrs on <code>; strip them so line info lives only on the wrapper.
const origFence = md.renderer.rules.fence;
md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const t = tokens[idx];
  const saved = t.attrs;
  t.attrs = saved && saved.filter(([k]) => !k.startsWith('data-line'));
  const out = origFence(tokens, idx, options, env, self);
  t.attrs = saved;
  return out;
};

// $$...$$ written inside a paragraph comes through as a math_block token with
// no source map. Render it display-style but without the plugin's <p> wrapper
// (a <p> inside a <p> makes the browser split the paragraph).
const blockMath = md.renderer.rules.math_block;
md.renderer.rules.math_block = (tokens, idx, options, env, self) =>
  tokens[idx].map ? blockMath(tokens, idx, options, env, self) : renderTex(tokens[idx].content, true);

export function renderMarkdown(src) {
  return md.render(src);
}

/**
 * Top-level blocks of a document as source line ranges [start, end) (0-based),
 * with their type: what the editor uses to expand a selection to whole blocks.
 */
let blocksCache = { src: null, blocks: [] };
export function topLevelBlocks(src) {
  if (blocksCache.src === src) return blocksCache.blocks;
  const blocks = [];
  for (const t of md.parse(src, {})) {
    if (t.level !== 0 || !t.map || t.nesting === -1) continue;
    blocks.push({ start: t.map[0], end: t.map[1], type: t.type.replace(/_open$/, '') });
  }
  blocksCache = { src, blocks };
  return blocks;
}
