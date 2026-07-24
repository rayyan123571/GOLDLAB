/*
 * MANUAL "backup to Drive folder" — completely independent of the automatic
 * backup in electron/backup.cjs. It shares nothing with it: its own config file
 * (manual-backup-config.json), its own folder, its own filenames, no rotation,
 * no restore, no timers. Deleting this file would leave the automatic backup
 * working exactly as it does today.
 *
 * One click = one dated snapshot copied into a folder the shopkeeper picked
 * (typically a Google Drive Desktop synced folder, so Drive uploads it itself —
 * there is no network code here at all).
 *
 *   flush → copy DB to <folder>/GoldLab_YYYY-MM-DD_HHMM.sqlite.tmp → rename
 *
 * COPY only: the live goldlab.sqlite is never moved, renamed or deleted by any
 * path in this file. Every click writes a NEW file; an earlier snapshot is never
 * overwritten (a same-minute second click gets a _2, _3, … suffix).
 */
const { dialog } = require('electron')
const path = require('path')
const fs = require('fs')

const CONFIG = 'manual-backup-config.json' // NOT backup-config.json (auto backup's)

let userDataDir = null
let dbPath = null
let flushFn = null
let running = false // re-entry guard: a double-click must not run two copies

const log = (...a) => console.log('[manual-backup]', ...a)
const logErr = (msg, e) => console.error('[manual-backup]', msg, e && e.message ? e.message : e)

function init(opts) {
  userDataDir = opts.userDataDir
  dbPath = opts.dbPath
  flushFn = opts.flush
}

/* ---------- config (its own file; never backup-config.json) ---------- */

function configPath() { return path.join(userDataDir, CONFIG) }

function readConfig() {
  try {
    const cfg = JSON.parse(fs.readFileSync(configPath(), 'utf8'))
    return cfg && typeof cfg === 'object' ? cfg : {}
  } catch {
    return {} // missing/corrupt = nothing chosen yet; never an error
  }
}

function saveConfig(patch) {
  try {
    fs.writeFileSync(configPath(), JSON.stringify({ ...readConfig(), ...patch }, null, 2))
    return true
  } catch (e) {
    logErr('Could not save manual-backup config:', e)
    return false
  }
}

/* ---------- helpers ---------- */

// Usable only if we can actually create it AND write inside it — a disconnected
// Drive letter or a read-only folder fails HERE, before the copy starts, rather
// than halfway through it.
function ensureWritableDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true })
    const probe = path.join(dir, '.goldlab-manual-write-test')
    fs.writeFileSync(probe, 'ok')
    fs.unlinkSync(probe)
    return true
  } catch {
    return false
  }
}

// GoldLab_YYYY-MM-DD_HHMM.sqlite in LOCAL time (the shopkeeper's own clock).
function snapshotName(d) {
  const p = (n) => String(n).padStart(2, '0')
  return `GoldLab_${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}.sqlite`
}

// Never overwrite an earlier snapshot: two clicks in the same minute get _2, _3…
function freeName(folder, base) {
  if (!fs.existsSync(path.join(folder, base))) return base
  const stem = base.replace(/\.sqlite$/, '')
  for (let i = 2; i < 100; i++) {
    const candidate = `${stem}_${i}.sqlite`
    if (!fs.existsSync(path.join(folder, candidate))) return candidate
  }
  return `${stem}_${Date.now()}.sqlite`
}

/* ---------- public API ---------- */

// { ok, folder, lastBackupAt (ISO|null), lastFileName }
function getStatus() {
  const cfg = readConfig()
  return {
    ok: true,
    folder: cfg.folder || '',
    lastBackupAt: cfg.lastBackupAt || null,
    lastFileName: cfg.lastFileName || ''
  }
}

// Native folder picker (openDirectory + createDirectory), the same properties as
// the reports-folder picker. Saves the choice. { ok, folder } | { ok:false, reason }
async function pickFolder(win) {
  try {
    const r = await dialog.showOpenDialog(win || null, {
      title: 'بیک اپ فولڈر منتخب کریں',
      buttonLabel: 'Use this folder',
      properties: ['openDirectory', 'createDirectory']
    })
    if (r.canceled || !r.filePaths || !r.filePaths.length) return { ok: false, reason: 'cancelled' }
    const folder = r.filePaths[0]
    if (!ensureWritableDir(folder)) return { ok: false, reason: 'not-writable' }
    saveConfig({ folder })
    log('Manual backup folder chosen:', folder)
    return { ok: true, folder }
  } catch (e) {
    logErr('Folder pick failed:', e)
    return { ok: false, reason: 'error', detail: String(e && e.message ? e.message : e) }
  }
}

// One manual snapshot. Returns { ok:true, fileName, folder, lastBackupAt } or
// { ok:false, reason } with reason one of:
//   no-folder | not-writable | no-db | busy | copy-failed
function run() {
  if (running) return { ok: false, reason: 'busy' }
  running = true
  let tmpFile = null
  try {
    // 1. FLUSH FIRST — the same db.flush the automatic backup uses (wired in
    //    main.cjs). Without it the copy could miss the newest saved rows.
    try { if (typeof flushFn === 'function') flushFn() } catch (e) { logErr('Flush before manual backup failed:', e) }

    if (!dbPath || !fs.existsSync(dbPath)) return { ok: false, reason: 'no-db' }

    const folder = readConfig().folder
    if (!folder) return { ok: false, reason: 'no-folder' }
    if (!ensureWritableDir(folder)) return { ok: false, reason: 'not-writable' }

    const fileName = freeName(folder, snapshotName(new Date()))
    const target = path.join(folder, fileName)
    tmpFile = `${target}.tmp`

    // 2. atomic: the whole copy goes to .tmp, then one rename puts it in place,
    //    so a half-written .sqlite is never left sitting in the Drive folder.
    fs.copyFileSync(dbPath, tmpFile)
    fs.renameSync(tmpFile, target)
    tmpFile = null

    const lastBackupAt = new Date().toISOString()
    saveConfig({ lastBackupAt, lastFileName: fileName })
    log('Manual backup written:', target)
    return { ok: true, fileName, folder, lastBackupAt }
  } catch (e) {
    logErr('Manual backup failed:', e)
    return { ok: false, reason: 'copy-failed', detail: String(e && e.message ? e.message : e) }
  } finally {
    if (tmpFile) { try { fs.existsSync(tmpFile) && fs.unlinkSync(tmpFile) } catch {} }
    running = false
  }
}

module.exports = { init, getStatus, pickFolder, run }
