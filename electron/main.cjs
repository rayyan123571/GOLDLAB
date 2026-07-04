const { app, BrowserWindow, ipcMain, dialog, clipboard } = require('electron')
const path = require('path')
const fs = require('fs')
const db = require('./db.cjs')
const backup = require('./backup.cjs')

const isDev = process.env.NODE_ENV === 'development'
let win = null

function createWindow() {
  win = new BrowserWindow({
    width: 1500,
    height: 840,
    minWidth: 1200,
    minHeight: 720,
    title: 'چوہدری گولڈ لیبارٹری — Chaudhry Gold Laboratory',
    // Frameless TRUE full-screen: covers the whole screen (Windows taskbar hidden),
    // no title bar. show:false + ready-to-show avoids a white flash. The in-app red
    // "X" (window.api.quitApp) and Alt+F4 are the ways out; Esc exits full-screen so
    // the user is never trapped without a taskbar.
    fullscreen: true,
    frame: false,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.once('ready-to-show', () => {
    win.setFullScreen(true) // ensure the taskbar is actually covered
    win.show()
  })

  // Escape hatches (a frameless full-screen window has no title bar, so these MUST
  // work): Alt+F4 quits, Esc drops out of full-screen so the taskbar is reachable.
  // We explicitly handle Alt+F4 because a frameless/full-screen window doesn't
  // always receive the default WM_CLOSE reliably.
  win.webContents.on('before-input-event', (evt, input) => {
    if (input.type !== 'keyDown') return
    if (input.alt && (input.key === 'F4' || input.code === 'F4')) {
      evt.preventDefault()
      app.quit()
    } else if (input.key === 'Escape' && win && win.isFullScreen()) {
      win.setFullScreen(false)
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

// Quit the whole app — wired to the in-app red "X" button (window.api.quitApp).
// db is flushed in before-quit / window-all-closed, so no data is lost.
ipcMain.handle('quit-app', () => { app.quit() })

// "–" button: fill the whole screen but KEEP THE TASKBAR VISIBLE. This leaves
// full-screen (which hides the taskbar) and maximizes to the work area, so the
// app occupies everything except the taskbar — on any screen size / any laptop.
ipcMain.handle('minimize-window', () => {
  if (!win) return
  if (win.isFullScreen()) win.setFullScreen(false)
  win.maximize()
})

// "□" button: occupy the ENTIRE screen with the taskbar HIDDEN (true full-screen)
// — the same state the app launches in, on any screen size.
ipcMain.handle('toggle-maximize', () => {
  if (!win) return
  win.setFullScreen(true)
})

// ── Printing (receipt-printer safe) ────────────────────────────────────────
// One print attempt. A watchdog timer (when given) resolves the promise even if
// Chromium never fires the print callback — a known Windows quirk — so the
// renderer's `await` can NEVER hang. timedOut distinguishes "no answer" from an
// explicit driver failure (only the latter is worth a dialog fallback; a timed-
// out job may still print later, and a fallback then would print twice).
function printOnce(opts, timeoutMs) {
  return new Promise((resolve) => {
    let done = false
    const finish = (ok, reason, timedOut) => { if (!done) { done = true; resolve({ ok, reason, timedOut }) } }
    const timer = timeoutMs ? setTimeout(() => finish(false, 'timeout', true), timeoutMs) : null
    try {
      win.webContents.print(opts, (success, failureReason) => {
        if (timer) clearTimeout(timer)
        finish(success, failureReason || '')
      })
    } catch (e) {
      if (timer) clearTimeout(timer)
      finish(false, String(e && e.message ? e.message : e))
    }
  })
}

// Print via the MAIN process. Receipts print SILENTLY straight to the system
// default printer (the shop's 80mm thermal): webContents.print's system dialog
// frequently fails to spool on Windows thermal drivers (long-standing Electron
// issue), which is why dialog printing produced nothing. If the silent attempt
// reports an explicit failure, we fall back to the dialog once so the user still
// has a path (e.g. printing to a different printer). Callers may pass
// { silent: false } to force the dialog. Always resolves { ok, reason }.
ipcMain.handle('print-page', async (_evt, opts = {}) => {
  if (!win) return { ok: false, reason: 'no-window' }
  const wantSilent = opts.silent !== false
  const base = { printBackground: true, ...opts }
  if (wantSilent) {
    const first = await printOnce({ ...base, silent: true }, 30000)
    if (first.ok || first.timedOut) return first
    // Explicit driver refusal (e.g. no default printer) → offer the dialog once.
    // Dialog attempts get a LONG watchdog (the user may sit in the dialog a
    // while) so a dead callback still can't hang the renderer forever.
    return printOnce({ ...base, silent: false }, 180000)
  }
  return printOnce({ ...base, silent: false }, 180000)
})

// Capture a screen region of the app window and place it on the system
// clipboard as an IMAGE — used by the WhatsApp share: the renderer shows the
// slip (same header/receipt/footer as printing), we snapshot it here, and the
// user pastes it straight into the WhatsApp chat with Ctrl+V. Never throws.
ipcMain.handle('capture-to-clipboard', async (_evt, rect) => {
  try {
    if (!win) return { ok: false, reason: 'no-window' }
    const r = {
      x: Math.max(0, Math.round(rect?.x || 0)),
      y: Math.max(0, Math.round(rect?.y || 0)),
      width: Math.max(1, Math.round(rect?.width || 1)),
      height: Math.max(1, Math.round(rect?.height || 1))
    }
    const img = await win.webContents.capturePage(r)
    if (!img || img.isEmpty()) return { ok: false, reason: 'empty-capture' }
    clipboard.writeImage(img)
    return { ok: true }
  } catch (e) {
    return { ok: false, reason: String(e && e.message ? e.message : e) }
  }
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
  const userDataDir = app.getPath('userData')
  const dbPath = path.join(userDataDir, 'goldlab.sqlite')
  // Restore check runs BEFORE the DB is opened/created. It does something ONLY
  // when goldlab.sqlite is missing (fresh machine / reinstall) — an existing DB
  // is opened untouched, with no prompt. Fully try/catch'd inside; never blocks.
  backup.restoreIfMissing({ userDataDir, dbPath })
  await db.init(userDataDir)
  console.log('Database opened.')
  // Silent automatic backups: shortly after launch, then every ~10 minutes, and
  // once more on quit below. Best-effort only — cannot crash or block the app.
  backup.start({ userDataDir, dbPath, flush: db.flush })
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  db.flush()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => { db.flush(); backup.runOnQuit() })
