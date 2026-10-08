const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

let win;
let dirty = false;

function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'Markable',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, '..', 'index.html'));

  // Links in the preview open in the system browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-frame-navigate', (e) => {
    if (!e.isMainFrame && /^https?:/.test(e.url)) { e.preventDefault(); shell.openExternal(e.url); }
  });

  win.on('close', (e) => {
    if (!dirty) return;
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning', buttons: ['Discard changes', 'Cancel'], defaultId: 1, cancelId: 1,
      message: 'You have unsaved changes. Close anyway?',
    });
    if (choice !== 0) e.preventDefault();
  });

  const fileArg = process.argv.slice(app.isPackaged ? 1 : 2).find((a) => /\.(md|markdown|txt)$/i.test(a));
  if (fileArg) {
    win.webContents.once('did-finish-load', async () => {
      const p = path.resolve(fileArg);
      win.webContents.send('open-path', { path: p, name: path.basename(p), text: await fs.readFile(p, 'utf8') });
    });
  }
}

function buildMenu() {
  const send = (cmd) => () => win && win.webContents.send('menu', cmd);
  const isMac = process.platform === 'darwin';
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'New', accelerator: 'CmdOrCtrl+N', click: send('new') },
        { label: 'Open…', accelerator: 'CmdOrCtrl+O', click: send('open') },
        { type: 'separator' },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: send('save') },
        { label: 'Save As…', accelerator: 'CmdOrCtrl+Shift+S', click: send('saveAs') },
        { type: 'separator' },
        { label: 'Export PDF…', accelerator: 'CmdOrCtrl+E', click: send('export') },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      // No zoom roles here: Ctrl +/-/0 zoom the focused pane, handled in the renderer.
      submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'togglefullscreen' }],
    },
  ]));
}

ipcMain.handle('open-file', async () => {
  const r = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }, { name: 'All files', extensions: ['*'] }],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  const p = r.filePaths[0];
  return { path: p, name: path.basename(p), text: await fs.readFile(p, 'utf8') };
});

ipcMain.handle('save-file', async (_e, { path: p, name, text }) => {
  if (!p) {
    const r = await dialog.showSaveDialog(win, {
      defaultPath: name || 'Untitled.md',
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (r.canceled || !r.filePath) return null;
    p = r.filePath;
  }
  await fs.writeFile(p, text, 'utf8');
  return { path: p, name: path.basename(p) };
});

ipcMain.handle('export-pdf', async (_e, { html, name, path: docPath }) => {
  const r = await dialog.showSaveDialog(win, {
    defaultPath: docPath ? path.join(path.dirname(docPath), name) : name,
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (r.canceled || !r.filePath) return null;

  // Render the exact same paginated HTML in a hidden window and print it.
  const tmp = path.join(os.tmpdir(), `markable-export-${process.pid}-${Date.now()}.html`);
  await fs.writeFile(tmp, html, 'utf8');
  const pdfWin = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false } });
  try {
    await pdfWin.loadFile(tmp);
    const deadline = Date.now() + 60000;
    while (!(await pdfWin.webContents.executeJavaScript('window.__pagedDone === true'))) {
      if (Date.now() > deadline) throw new Error('Timed out laying out pages');
      await new Promise((res) => setTimeout(res, 100));
    }
    const pdf = await pdfWin.webContents.printToPDF({ preferCSSPageSize: true, printBackground: true });
    await fs.writeFile(r.filePath, pdf);
    return r.filePath;
  } finally {
    pdfWin.destroy();
    fs.unlink(tmp).catch(() => {});
  }
});

ipcMain.handle('confirm-discard', (_e, name) => {
  return dialog.showMessageBoxSync(win, {
    type: 'warning', buttons: ['Discard changes', 'Cancel'], defaultId: 1, cancelId: 1,
    message: `Discard unsaved changes to ${name}?`,
  }) === 0;
});

ipcMain.on('set-dirty', (_e, d) => { dirty = !!d; });
ipcMain.on('dir-url', (e, p) => { e.returnValue = pathToFileURL(path.dirname(p)).href + '/'; });

app.whenReady().then(() => {
  buildMenu();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
