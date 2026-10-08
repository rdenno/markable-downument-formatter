// Thin layer over file I/O + PDF export.
// Desktop app (Electron): real files and native PDF export via window.mdpdf (preload.js).
// Plain browser: file picker / download / print dialog fallbacks.

const native = typeof window !== 'undefined' ? window.mdpdf : null;

const desktop = native && {
  openFile: () => native.openFile(),
  saveFile: (opts) => native.saveFile(opts),
  exportPdf: ({ html, name, path }) => native.exportPdf({ html, name, path }),
  confirmDiscard: (name) => native.confirmDiscard(name),
  setDirty: (d) => native.setDirty(d),
  dirUrl: (p) => native.dirUrl(p),
  onMenu: (cb) => native.onMenu(cb),
  onOpenPath: (cb) => native.onOpenPath(cb),
  pickImage: (docPath) => native.pickImage(docPath),
  editCommand: (cmd) => native.editCommand(cmd),
};

const browser = {
  openFile() {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.md,.markdown,.txt,text/markdown,text/plain';
      input.onchange = async () => {
        const f = input.files[0];
        resolve(f ? { text: await f.text(), path: null, name: f.name } : null);
      };
      input.click();
    });
  },
  async saveFile({ name, text }) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/markdown' }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    return { name };
  },
  async exportPdf({ frame }) {
    // Paged.js already laid out real pages; the browser's "Save as PDF" prints them 1:1.
    frame.contentWindow.print();
    return 'via print dialog';
  },
  async confirmDiscard(name) {
    return window.confirm(`Discard unsaved changes to ${name}?`);
  },
  dirUrl: () => new URL('./', location.href).href,
};

export const platform = desktop || browser;
