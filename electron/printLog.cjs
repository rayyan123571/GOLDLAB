// Print diagnostics log — userData/print-log.txt.
//
// WHY: on a customer machine a failed print looks like "kuch nahi hua". The
// renderer's toast is transient and the main-process console.warn goes nowhere
// in a packaged build, so a print that never reaches the paper leaves ZERO
// evidence behind. This writes one line per print attempt (which engine, which
// printer, what the OS said) to a plain text file the shopkeeper can send over
// WhatsApp, so a print problem is diagnosed from facts instead of guesses.
//
// Deliberately dumb and crash-proof: plain appendFileSync, every call wrapped in
// try/catch, no dependency on the DB or a window. A logging failure must NEVER
// break a print.
const fs = require('fs')
const path = require('path')
const os = require('os')

const MAX_BYTES = 512 * 1024 // rotate at 512KB — keeps one .old, so worst case 1MB

let logFile = null

function stamp() {
  const d = new Date()
  const p = (n, w = 2) => String(n).padStart(w, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

function rotateIfBig() {
  try {
    if (fs.statSync(logFile).size < MAX_BYTES) return
    const old = logFile + '.old'
    try { fs.rmSync(old, { force: true }) } catch {}
    fs.renameSync(logFile, old)
  } catch {} // no file yet, or locked — either way just keep appending
}

// Values reach here from the DB and from Windows, so anything can be null/objects.
function fmt(v) {
  if (v == null) return '-'
  // ASCII only, everywhere in this file: the shopkeeper opens print-log.txt in
  // Notepad on an old Windows, which reads it as ANSI and turns any non-ASCII
  // character into garbage.
  if (typeof v === 'string') return v === '' ? '(blank = use default)' : v
  if (typeof v === 'object') { try { return JSON.stringify(v) } catch { return '[object]' } }
  return String(v)
}

function write(line) {
  if (!logFile) return
  try {
    rotateIfBig()
    fs.appendFileSync(logFile, `[${stamp()}] ${line}${os.EOL}`, 'utf8')
  } catch {}
}

// tag = short event name; fields = flat object of details.
function log(tag, fields = {}) {
  const parts = Object.entries(fields).map(([k, v]) => `${k}=${fmt(v)}`)
  write(`${tag}  ${parts.join('  ')}`)
}

// Called once at startup. The machine facts (Windows version, arch, Electron) are
// exactly what is needed to tell a Win7 problem apart from a printer problem, and
// they must be in the file BEFORE the first failed print — not asked for later.
function init(userDataDir, extra = {}) {
  try {
    logFile = path.join(userDataDir, 'print-log.txt')
    write('='.repeat(70))
    log('app-start', {
      windows: `${os.release()} (${process.arch})`,
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      ...extra
    })
  } catch { logFile = null }
}

// The installed printer list, logged once the window exists. A print that goes to
// a device name not in this list (renamed/offline printer) is the single most
// common cause of a silent no-print, and this makes it visible at a glance.
async function logPrinters(win) {
  try {
    const list = await win.webContents.getPrintersAsync()
    if (!list || !list.length) { log('printers', { count: 0, note: 'NO printers installed in Windows' }); return }
    log('printers', { count: list.length })
    for (const p of list) {
      log('  printer', { name: p.name, default: !!p.isDefault, status: p.status, desc: p.description || '' })
    }
  } catch (e) {
    log('printers', { error: e && e.message || String(e) })
  }
}

function file() { return logFile }

module.exports = { init, log, logPrinters, file }
