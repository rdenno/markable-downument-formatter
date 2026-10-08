import { EditorView, basicSetup } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import { indentWithTab } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';

const theme = EditorView.theme({
  '&': { height: '100%', fontSize: 'var(--editor-font-size, 14px)' },
  '.cm-scroller': {
    fontFamily: '"SFMono-Regular", Menlo, Consolas, "Liberation Mono", monospace',
    lineHeight: '1.55',
  },
  '.cm-content': { padding: '16px 0 40vh' }, // room to scroll the last lines up
  '.cm-line': { padding: '0 16px' },
  '.cm-gutters': { background: 'transparent', border: 'none', color: '#aaa' },
  '&.cm-focused': { outline: 'none' },
});

export function createEditor(parent, { doc = '', onChange, onGeometry }) {
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        basicSetup,
        keymap.of([indentWithTab]),
        markdown({ base: markdownLanguage, codeLanguages: languages }),
        EditorView.lineWrapping,
        theme,
        EditorView.updateListener.of((u) => {
          if (u.docChanged) onChange(u);
          // CodeMirror estimates heights of lines it hasn't drawn yet and corrects
          // them as they scroll into view; re-sync when that happens.
          else if (u.geometryChanged || u.heightChanged) onGeometry?.(u);
        }),
      ],
    }),
  });
  return view;
}

export function setEditorDoc(view, text) {
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, selection: { anchor: 0 } });
  view.scrollDOM.scrollTop = 0;
}

/** Y of a 0-based source line inside the editor's scroll content (top or bottom edge). */
export function editorYForLine(view, line0, bottom) {
  const doc = view.state.doc;
  const n = Math.min(Math.max(line0 + 1, 1), doc.lines);
  const block = view.lineBlockAt(doc.line(n).from);
  const offset = view.documentTop - view.scrollDOM.getBoundingClientRect().top + view.scrollDOM.scrollTop;
  return offset + (bottom ? block.bottom : block.top);
}
