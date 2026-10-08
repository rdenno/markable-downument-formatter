# Markable

A small, predictable Markdown → PDF editor. Raw Markdown on the left, the real
PDF pages on the right, with live preview and scroll sync between the two panes.

## Install

Installers are built by GitHub Actions:

- **Releases:** push a tag like `v0.1.0` and the
  [Releases page](https://github.com/rdenno/markable-downument-formatter/releases) gets a
  Windows installer, a portable Windows `.exe`, a Linux `.AppImage` and a `.deb`.
- **Any build:** open a run under the **Actions** tab ("Build installers") and download
  the `Markable-Windows` / `Markable-Linux` artifact.

The builds aren't code-signed, so Windows SmartScreen will warn the first time
you run the installer ("More info" → "Run anyway").

## Run from source

```sh
npm install
npm start            # build and open the app
npm run dist:win     # build installers into out/ (or dist:linux)
```

`npm run serve` runs it in a normal browser at http://localhost:8123 instead.
In that mode, Export goes through the browser's print dialog ("Save as PDF").

## How it works (and why it's predictable)

- **Markdown**: standard CommonMark via [markdown-it](https://github.com/markdown-it/markdown-it),
  plus GFM tables, strikethrough and auto-links. Nothing app-specific.
- **Formatting = HTML + CSS.** Raw HTML passes straight through and CSS behaves
  the way it does in a browser. No special command language to learn.
- **Math** (KaTeX): `$inline$`, `\(inline\)`, `$$display$$`, `\[display\]`, or a
  ```` ```math ```` block. A bad formula shows a red inline error. It never breaks the rest of the document.
- **Code**: fenced blocks are syntax-highlighted when you name the language
  (```` ```python ````). Unlabelled blocks stay plain. Nothing is guessed.
- **Pages**: [Paged.js](https://pagedjs.org) splits the HTML into real pages using
  CSS paged media. The PDF export prints that same paginated document in Chromium,
  so **the preview is the PDF**.

### Document settings (front matter)

An optional YAML block at the very top of the file:

```yaml
---
title: Quarterly report      # PDF title
page-size: letter            # A4, A5, letter, legal, ... or "210mm 297mm"
orientation: landscape       # portrait / landscape
margin: 1in                  # one value, or "top right bottom left"
font: Arial                  # any installed font; a list works too: "Inter, Arial"
font-size: 12                # number = pt, or "12pt", "16px"
line-height: 1.4
text-align: justify
page-numbers: bottom-right   # true, false, bottom-center (default), bottom-left, top-right, ...
lang: en
---
```

Pandoc's names work too (`papersize`, `fontsize`, `mainfont`, `linestretch`,
`geometry: margin=1in`). Mistakes don't stop the document rendering: a warning
appears in the preview's status bar instead. When the document sets a page
size, the toolbar's page-size picker is disabled.

### Cheat sheet

| Want                     | Write                                                     |
|--------------------------|-----------------------------------------------------------|
| Page break               | `\newpage` or `\pagebreak` on its own line                |
| Page size / margins      | front matter, or `<style>@page { size: letter; margin: 1in; }</style>` |
| Font                     | front matter, or `<style>body { font-family: Arial; }</style>` |
| Keep a block on one page | `<div style="break-inside: avoid"> … </div>`              |
| Image size               | `<img src="pic.png" width="300">`                         |
| Centered image           | `<img src="pic.png" data-align="center">` (also `left` / `right`), or `<p align="center"><img …></p>` |
| Side-by-side, no borders | `<div class="columns">` with one `<div>` per column (see below) |
| Anything else            | CSS in a `<style>` block, anywhere in the document        |

Relative image paths resolve against the folder of the open `.md` file.

**Insert menu.** The toolbar's **Insert ▾** button and the editor's right-click
menu paste in ready-made snippets: image (picks a file), image with caption,
columns, centered table, centered block, math, code, page break, document
settings. The inserted placeholder is selected, ready to type over.

With text selected, **Columns, Centered block, Math and Code wrap the selection**
instead (Table centers a selected table). The selection is first widened to
whole Markdown blocks, so half a formula, table or list is never cut in two;
a selection inside one line wraps inline (`$…$`, `` `…` ``).

**Rows and columns.** With the cursor in a Markdown table or a `columns` block,
small buttons appear above the line to add a row/column before or after the one
you're in, or delete it. Tables are re-aligned so the pipes line up.
The snippets use a few readable attributes you can edit:

| Attribute | On | Does |
|---|---|---|
| `data-align="left / center / right"` | any `<div>`, `<img>`, `<figure>` | aligns everything inside: text, tables, images |
| `data-width="2"` or `"40%"` / `"6cm"` | a column | share of the row, or a fixed width |
| `data-valign="top / center / bottom"` | `<div class="columns">` | vertical alignment of the columns |

**Columns.** Each child of `.columns` is one column. Markdown inside HTML is
parsed when it has blank lines around it:

```html
<div class="columns">
<div data-width="2" data-align="center">

![](figure.png)

</div>
<div data-width="1">

Text **beside** the figure, with $math$ and lists.

</div>
</div>
```

## Editor

- Drag the divider to resize the panes.
- Zoom each pane separately: the − / + buttons, Ctrl/Cmd + scroll over a pane,
  or Ctrl/Cmd + `=` / `-` / `0` for the pane you last used. **Fit** keeps the
  page width fitted to the preview panel.
- **Scroll sync** is on by default, and either pane can drive it. Every Markdown block
  (paragraph, heading, image, table row, list item, code block, formula) is
  matched to its box in the preview. Positions inside a box are interpolated,
  so tall images, tables and page gaps stay aligned.
- Ctrl/Cmd + N / O / S / Shift+S / E: new, open, save, save as, export PDF.

### Speed on long documents

The preview shows the pages you're looking at as soon as they're laid out,
and later pages fill in below. Pages before the line you edited are reused
from the previous render rather than laid out again. This only affects the
on-screen preview: **Export PDF always lays out the whole document from scratch.**

## Layout

```
electron/          main process (windows, file dialogs, PDF export) + preload bridge
src/app.js         renderer: panes, zoom, render loop
src/markdown.js    markdown → HTML (markdown-it, KaTeX, highlight.js, source lines)
src/frontmatter.js YAML front matter → CSS
src/document.js    the paginated HTML document (shared by preview and export)
src/sync.js        scroll sync
src/incremental.js page reuse for fast previews
build.mjs          esbuild bundle + runtime assets → dist/
```
