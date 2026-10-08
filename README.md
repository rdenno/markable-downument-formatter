# Markable

A desktop Markdown editor that shows the PDF pages as you type and exports them
to PDF. Markdown on the left, pages on the right.

> **AI-developed.** The code in this repository was written by Claude (Anthropic's
> AI model) through Claude Code, following requests and testing feedback from the
> repository owner. It has been tested by that person on their own documents, and
> by automated checks written during development.

## Download

Get the latest build from the [Releases page](https://github.com/rdenno/markable-downument-formatter/releases):

- Windows: `Markable-Setup-<version>.exe` (installer) or `Markable-<version>-portable.exe`
- Linux: `Markable-<version>.AppImage` or the `.deb`

The builds aren't code-signed, so Windows SmartScreen warns on first run
("More info" → "Run anyway").

## How it works

The Markdown is converted to HTML with [markdown-it](https://github.com/markdown-it/markdown-it)
(CommonMark plus GFM tables). Math is rendered with KaTeX and code with
highlight.js. [Paged.js](https://pagedjs.org) then splits the HTML into pages
using CSS print rules. The preview shows that paged document, and Export PDF
prints the same document through Chromium, so the PDF matches the preview.

Formatting beyond Markdown is plain HTML and CSS. There is no extra command
language.

## Writing

- **Math:** `$…$` or `\(…\)` inline, `$$…$$` or `\[…\]` for display. A broken
  formula shows a red error in place; the rest of the document still renders.
- **Code:** fenced blocks are highlighted when the language is named (```` ```python ````).
- **Page break:** `\newpage` or `\pagebreak` on its own line.
- **Images:** relative paths are resolved from the folder of the `.md` file.
- **HTML:** allowed anywhere. Markdown inside an HTML block is only formatted
  when there are blank lines around it.
- **CSS:** put a `<style>` block anywhere in the document, e.g.
  `<style>@page { margin: 1in; } body { font-family: Arial; }</style>`.

### Document settings

An optional YAML block at the top of the file:

```yaml
---
title: Homework 2
page-size: letter        # A4, A5, letter, legal
orientation: portrait    # or landscape
margin: 1in
font: Arial
font-size: 12            # pt
line-height: 1.4
page-numbers: bottom-right   # true, false, bottom-center, top-right, ...
---
```

Pandoc's names also work (`papersize`, `fontsize`, `mainfont`, `geometry: margin=1in`).
Mistakes show as a warning in the preview's status bar.

### Layout

**Insert ▾** in the toolbar (or right-click in the editor) adds snippets: image,
image with caption, columns, centered table, centered block, math, code, page
break, document settings. With text selected, columns, centered block, math and
code wrap the selection instead. The selection is widened to whole blocks first,
so a formula or table is never split.

The snippets use three attributes:

| Attribute | On | Effect |
|---|---|---|
| `data-align="left/center/right"` | a `<div>`, `<img>` or `<figure>` | aligns the text, tables and images inside |
| `data-width="2"` or `"40%"` | a column | relative share of the row, or a fixed width |
| `data-valign="top/center/bottom"` | `<div class="columns">` | vertical alignment of the columns |

When the cursor is in a Markdown table or a columns block, buttons appear above
the line to add or delete a row or column at that position.

## Using the editor

- Drag the divider to resize the panes.
- Each pane zooms on its own: the − / + buttons, Ctrl+scroll, or Ctrl+`=` / `-` / `0`.
  **Fit** sizes the page to the panel width.
- Scrolling either pane scrolls the other to the same place in the document.
- **Highlight cursor** marks the block under the cursor in the preview.
- The theme button switches between system, light and dark. **Dark pages**
  inverts the page colors on screen only; exported PDFs are unaffected.
- Shortcuts: Ctrl+N / O / S / Shift+S / E (new, open, save, save as, export),
  Ctrl+F (find and replace).

For long documents, the preview shows the pages in view first and reuses
unchanged pages from the previous render. Export always lays out the whole
document again.

## Building from source

```sh
npm install
npm start            # build and run
npm run dist:win     # installers into out/ (or dist:linux)
```

`npm run serve` runs it in a browser at http://localhost:8123; Export then uses
the browser's print dialog.

Releases are built by GitHub Actions (`.github/workflows/build.yml`): push a
`v*` tag, or run the workflow manually with a version in the `release` field.

## Source layout

```
electron/          main process: windows, file dialogs, PDF export
src/app.js         panes, zoom, render loop, menus
src/markdown.js    Markdown → HTML
src/frontmatter.js document settings → CSS
src/document.js    the paged HTML document used by preview and export
src/sync.js        scroll sync
src/incremental.js page reuse for long documents
src/structure.js   wrapping and table/column editing
src/templates.js   Insert menu snippets
```

## License

GPL-3.0-or-later. See [LICENSE](LICENSE).
