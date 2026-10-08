// Markdown -> HTML. Standard CommonMark + GFM tables/strikethrough via
// markdown-it, raw HTML passthrough, KaTeX math, and source-line
// annotations (data-line / data-line-end) used for scroll sync.
import MarkdownIt from 'markdown-it';
import katexPlugin from '@vscode/markdown-it-katex';

const md = new MarkdownIt({
  html: true,        // any HTML/CSS works as-is: <div style="...">, <style>, <img width=...>
  linkify: true,
  typographer: false, // don't rewrite quotes/dashes behind the user's back
});

// markdown-it rejects some URLs by default (e.g. SVG data: images). This is a
// local editor for your own documents, so accept anything a browser would,
// except script URLs.
md.validateLink = (url) => !/^\s*(javascript|vbscript):/i.test(url);

md.use(katexPlugin.default || katexPlugin, { throwOnError: false, enableFencedBlocks: true });

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

export function renderMarkdown(src) {
  return md.render(src);
}
