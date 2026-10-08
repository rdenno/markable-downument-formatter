// Snippets for the Insert menu. Plain Markdown/HTML, so the result renders the
// same anywhere; the attributes are the knobs you edit:
//   data-align="left|center|right"   alignment of everything inside (text, tables, images)
//   data-width="2" or "40%"          column width: a share of the row, or a fixed size
//   data-valign="top|center|bottom"  vertical alignment of the columns
// `select` is the placeholder that gets selected after inserting, ready to type over.

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
    id: 'columns2', label: 'Two columns', select: 'Left column',
    text: [
      '<div class="columns" data-valign="top">',
      '<div data-width="1" data-align="center">',
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
  },
  {
    id: 'columns3', label: 'Three columns', select: 'First column',
    text: [
      '<div class="columns" data-valign="top">',
      '<div data-width="1" data-align="left">',
      '',
      'First column',
      '',
      '</div>',
      '<div data-width="1" data-align="left">',
      '',
      'Second column',
      '',
      '</div>',
      '<div data-width="1" data-align="left">',
      '',
      'Third column',
      '',
      '</div>',
      '</div>',
    ].join('\n'),
  },
  {
    id: 'table', label: 'Table (centered)', select: 'Header 1',
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
  },
  { id: 'math', label: 'Math block', select: 'x^2', text: '$$\nx^2\n$$' },
  { id: 'code', label: 'Code block', select: 'code', text: '```python\ncode\n```' },
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
