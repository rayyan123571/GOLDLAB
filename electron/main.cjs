const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const db = require('./db.cjs')

const isDev = process.env.NODE_ENV === 'development'
let win = null

function createWindow() {
  win = new BrowserWindow({
    width: 1500,
    height: 840,
    minWidth: 1200,
    minHeight: 720,
    title: 'گولڈ لیب — Gold Laboratory',
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
