# Markable

A small, predictable Markdown → PDF editor. Raw Markdown on the left, the real
PDF pages on the right, with live preview and scroll sync between the two panes.

## Run it

```sh
npm install
npm start          # builds and opens the desktop app (Electron)
```

`npm run serve` runs it in a normal browser at http://localhost:8123 instead.
In that mode, Export goes through the browser's print dialog ("Save as PDF").

## How it works (and why it's predictable)

- **Markdown**: standard CommonMark via [markdown-it](https://github.com/markdown-it/markdown-it),
  plus GFM tables, strikethrough and auto-links. Nothing app-specific.
- **Formatting = HTML + CSS.** Raw HTML passes straight through and CSS behaves
  the way it does in a browser. No special command language to learn.
- **Math**: `$inline$` and `$$display$$` (or a ```` ```math ```` block) via KaTeX.
  A bad formula renders as a red inline error. It never breaks the rest of the document.
- **Pages**: [Paged.js](https://pagedjs.org) splits the HTML into real pages using
  CSS paged media. The PDF export prints that same paginated document in Chromium,
  so **the preview is the PDF**.

### Cheat sheet

| Want                     | Write                                                     |
|--------------------------|-----------------------------------------------------------|
| Page break               | `\newpage` or `\pagebreak` on its own line                |
| Page size / margins      | `<style>@page { size: letter; margin: 1in; }</style>`     |
| Landscape                | `<style>@page { size: A4 landscape; }</style>`            |
| Font                     | `<style>body { font-family: Arial; font-size: 12pt; }</style>` |
| No page numbers          | `<style>@page { @bottom-center { content: none; } }</style>` |
| Keep a block on one page | `<div style="break-inside: avoid"> … </div>`              |
| Image size               | `<img src="pic.png" width="300">`                         |

Relative image paths resolve against the folder of the open `.md` file.

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

## Layout

```
electron/   main process (windows, file dialogs, PDF export) + preload bridge
src/        renderer: editor, markdown pipeline, preview, scroll sync
index.html  app shell
build.mjs   esbuild bundle -> dist/app.js
```
