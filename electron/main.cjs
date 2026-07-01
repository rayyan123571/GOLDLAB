const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const path = require('path')
const fs = require('fs')
const db = require('./db.cjs')

const isDev = process.env.NODE_ENV === 'development'
let win = null

function createWindow() {
  win = new BrowserWindow({
    width: 1500,
    height: 840,
    minWidth: 1200,
    minHeight: 720,
    title: 'چوہدری گولڈ لیبارٹری — Chaudhry Gold Laboratory',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (isDev) {
    win.loadURL('http://localhost:5173')
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }
}

// Single IPC entry point: renderer calls window.api.invoke(channel, payload)
ipcMain.handle('db', async (_evt, { fn, args }) => {
  if (typeof db.api[fn] !== 'function') {
    throw new Error(`Unknown db function: ${fn}`)
  }
  return db.api[fn](...(args || []))
})

// Export the CURRENT report to PDF (Part 3). The renderer flips a body class so
// only the report (`.print-area`) is visible; @media print CSS drives both the
// print dialog and printToPDF, so the PDF contains only the filtered report +
// totals with Urdu/RTL intact. Returns { ok, path? , canceled? }.
ipcMain.handle('export-pdf', async (_evt, { defaultName, cssPageSize } = {}) => {
  if (!win) return { ok: false }
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'رپورٹ کو PDF میں محفوظ کریں',
    defaultPath: defaultName || 'report.pdf',
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  })
  if (canceled || !filePath) return { ok: false, canceled: true }
  // cssPageSize → honour the CSS @page rule (thermal: narrow width + continuous
  // height) the renderer injected. Otherwise export a normal A4 sheet.
  const opts = cssPageSize
    ? { printBackground: true, preferCSSPageSize: true }
    : { printBackground: true, pageSize: 'A4', margins: { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 } }
  const data = await win.webContents.printToPDF(opts)
  fs.writeFileSync(filePath, data)
  return { ok: true, path: filePath }
})

app.whenReady().then(async () => {
  await db.init(app.getPath('userData'))
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  db.flush()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => db.flush())
