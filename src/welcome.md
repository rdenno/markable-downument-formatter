# Welcome to Markable

Markdown on the left, the **actual PDF pages** on the right. The preview is
exactly what gets exported — same pages, same breaks.

## What works

- Standard Markdown (CommonMark) plus tables, ~~strikethrough~~ and auto-links
- Math with KaTeX: inline $e^{i\pi} + 1 = 0$ or \(a^2 + b^2 = c^2\), and display:

$$
\int_0^\infty e^{-x^2}\,dx = \frac{\sqrt{\pi}}{2}
$$

- Any HTML and CSS, exactly as a browser would handle it:
  <span style="color: crimson">coloured text</span>, `<img width="200">`, `<div style="...">`
- A broken formula only shows an inline error — it never breaks the rest
  of the document: $\frac{1}{$

| Feature        | How                                   |
|----------------|---------------------------------------|
| Page break     | `\newpage` or `\pagebreak` on its own line |
| Page setup     | front matter (see below) or `<style>@page { margin: 1in; }</style>` |
| Change font    | front matter or `<style>body { font-family: Arial; }</style>` |
| Keep together  | `<div style="break-inside: avoid">…</div>` |
| Center image   | `<img src="pic.png" data-align="center">` |
| Columns        | Insert ▾ → Columns (or select text first to wrap it) |

```python
def hello():
    # highlighted because the block says "python"
    print("long lines wrap instead of running off the page")
```

Document settings go in a block at the very top of the file:

```yaml
---
page-size: letter
margin: 1in
font: Arial
font-size: 12
page-numbers: bottom-right
---
```

> Scroll either side — the other follows. Ctrl/Cmd + scroll (or the
> − / + buttons) zooms whichever pane you're in.

\newpage

# Page two

Everything after `\newpage` starts on a new page.
