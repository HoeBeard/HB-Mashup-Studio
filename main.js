// HB Mashup Studio — desktop shell. © HB Software
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs/promises');

let win;

function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 860,
    minWidth: 1000,
    minHeight: 640,
    title: 'HB Mashup Studio',
    backgroundColor: '#140b18',
    icon: path.join(__dirname, 'src', 'assets', 'logo.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'src', 'index.html'));

  // Links (like hbcs.info) open in the normal browser, never inside the app
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) { e.preventDefault(); if (/^https?:\/\//.test(url)) shell.openExternal(url); }
  });

  // Ask before closing if there are unsaved changes
  win.on('close', async (e) => {
    if (win.__forceClose) return;
    e.preventDefault();
    let dirty = false;
    try { dirty = await win.webContents.executeJavaScript('window.__hbDirty === true'); } catch {}
    if (dirty) {
      const { response } = await dialog.showMessageBox(win, {
        type: 'question',
        buttons: ['Close without saving', 'Cancel'],
        defaultId: 1, cancelId: 1,
        title: 'Unsaved mix',
        message: 'You have changes that are not saved. Close anyway?',
      });
      if (response !== 0) return;
    }
    win.__forceClose = true;
    win.close();
  });
}

ipcMain.handle('save-file', async (_e, { defaultName, filters, data }) => {
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: path.join(app.getPath('music'), defaultName),
    filters,
  });
  if (canceled || !filePath) return null;
  await fs.writeFile(filePath, Buffer.from(data));
  return filePath;
});

ipcMain.handle('open-project', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: [{ name: 'HB Mashup Project', extensions: ['hbmix'] }],
  });
  if (canceled || !filePaths.length) return null;
  const buf = await fs.readFile(filePaths[0]);
  return { name: path.basename(filePaths[0]), data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
});

ipcMain.handle('show-in-folder', (_e, p) => shell.showItemInFolder(p));

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
