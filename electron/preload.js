const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mdpdf', {
  openFile: () => ipcRenderer.invoke('open-file'),
  saveFile: (opts) => ipcRenderer.invoke('save-file', opts),
  exportPdf: (opts) => ipcRenderer.invoke('export-pdf', opts),
  confirmDiscard: (name) => ipcRenderer.invoke('confirm-discard', name),
  setDirty: (d) => ipcRenderer.send('set-dirty', d),
  dirUrl: (p) => ipcRenderer.sendSync('dir-url', p),
  onMenu: (cb) => ipcRenderer.on('menu', (_e, cmd) => cb(cmd)),
  onOpenPath: (cb) => ipcRenderer.on('open-path', (_e, f) => cb(f)),
});
