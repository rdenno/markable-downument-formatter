// Snippets for the Insert menu. Plain Markdown/HTML, so the result renders the
// same anywhere; the attributes are the knobs you edit:
//   data-align="left|center|right"   alignment of everything inside (text, tables, images)
//   data-width="2" or "40%"          column width: a share of the row, or a fixed size
//   data-valign="top|center|bottom"  vertical alignment of the columns
// `select` is the placeholder that gets selected after inserting, ready to type over.
// `wrap(content, inline)` (optional): with text selected, the template wraps it
// instead of being inserted after it. The selection is first expanded to whole
// blocks, so half a math block or table is never wrapped.

export const TEMPLATES = [
  {
    id: 'image', label: 'Image', select: 'image.png',
    text: '<img src="image.png" alt="" width="60%" data-align="center">',
  },
  {
    id: 'figure', label: 'Image with caption', select: 'image.png',
    text: [
      '<figure data-align="center">',
      '<img src="image.png" alt="" width="60%">',
      '<figcaption>Caption</figcaption>',
      '</figure>',
    ].join('\n'),
  },
  {
    id: 'columns', label: 'Columns', select: 'Left column',
    text: [
      '<div class="columns" data-valign="top">',
      '<div data-width="1" data-align="left">',
      '',
      'Left column',
      '',
      '</div>',
      '<div data-width="1" data-align="left">',
      '',
      'Right column',
      '',
      '</div>',
      '</div>',
    ].join('\n'),
    // Selected blocks become the first column.
    wrap: (c) => ({
      text: [
        '<div class="columns" data-valign="top">',
        '<div data-width="1" data-align="left">', '', c, '', '</div>',
        '<div data-width="1" data-align="left">', '', 'Right column', '', '</div>',
        '</div>',
      ].join('\n'),
      select: 'Right column',
    }),
  },
  {
    id: 'table', label: 'Table (centered)', select: 'Header 1',
    // A selected table gets centered; anything else is left alone.
    wrapIf: (type) => type === 'table',
    wrap: (c) => ({ text: ['<div data-align="center">', '', c, '', '</div>'].join('\n') }),
    text: [
      '<div data-align="center">',
      '',
      '| Header 1 | Header 2 | Header 3 |',
      '|:---------|:--------:|---------:|',
      '| left     | center   | right    |',
      '| a        | b        | c        |',
      '',
      '</div>',
    ].join('\n'),
  },
  {
    id: 'center', label: 'Centered block', select: 'Centered content',
    text: ['<div data-align="center">', '', 'Centered content', '', '</div>'].join('\n'),
    wrap: (c) => ({ text: ['<div data-align="center">', '', c, '', '</div>'].join('\n') }),
  },
  {
    id: 'math', label: 'Math', select: 'x^2', text: '$$\nx^2\n$$',
    wrap: (c, inline) => ({ text: inline ? '$' + c + '$' : '$$\n' + c + '\n$$' }),
    already: (type) => type === 'math_block',
  },
  {
    id: 'code', label: 'Code', select: 'code', text: '```python\ncode\n```',
    wrap: (c, inline) => {
      if (inline) { const tick = c.includes('`') ? '``' : '`'; return { text: tick + (tick.length > 1 ? ' ' + c + ' ' : c) + tick }; }
      const fence = /^```/m.test(c) ? '~~~' : '```';
      return { text: fence + 'text\n' + c + '\n' + fence, select: 'text' };
    },
    already: (type) => type === 'fence' || type === 'code_block',
  },
  { id: 'pagebreak', label: 'Page break', select: null, text: '\\newpage' },
  {
    id: 'settings', label: 'Document settings', select: 'Title', atTop: true,
    text: [
      '---',
      'title: Title',
      'page-size: A4            # A4, letter, legal, ...',
      'orientation: portrait    # or landscape',
      'margin: 2cm',
      'font: Charter            # any installed font',
      'font-size: 11',
      'page-numbers: bottom-center   # true, false, bottom-right, top-right, ...',
      '---',
    ].join('\n'),
  },
];
