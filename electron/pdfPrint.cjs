// ─── Spool a PDF to a named Windows printer at EXACT 1:1 scale ───────────────
// Why this module exists: webContents.print() hands Chromium's page to the
// Windows driver, and the driver is then free to "fit to page" / "auto-rotate"
// whatever it was given. On the shop's Canon LBP6030 that turned the overlay
// sheet 90° and shrank it, so values landed outside (and below) their
// pre-printed cells. A PDF of the exact sheet size, spooled with scaling
// explicitly DISABLED, removes the driver's freedom to reinterpret geometry.
//
// SumatraPDF is used as the spooler because it is the only small, silent,
// no-install Windows PDF printer with a documented "noscale" switch:
//     SumatraPDF.exe -print-to "<printer>" -print-settings "noscale,copies=N"
//                    -silent -exit-when-done "<file.pdf>"
// It IS bundled in this repo (vendor/pdfprint/SumatraPDF.exe) and shipped to
// resources/bin/ via package.json build.extraResources — see resolveExe() for the
// lookup order. When it is absent (or fails its integrity pin below), a REAL slip
// does NOT fall back to the driver: overlayForm.printOverlay refuses with
// 'pdf-engine-unavailable' and prints nothing, because the driver path would ruin
// an expensive pre-printed slip. Only proof/test prints (plain paper) fall back.
const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const { spawn } = require('child_process')

// Accepted file names, in order. PDFtoPrinter is a common alternative the shop
// may already have; it takes the printer name as its second positional arg, so
// argsFor() below branches on the name.
const EXE_NAMES = ['SumatraPDF.exe', 'SumatraPDF-portable.exe', 'PDFtoPrinter.exe']

// Integrity pin for the binary we SHIP. A candidate whose basename is listed here
// must match this SHA-256 or it is treated as ABSENT — a tampered or wrong-version
// SumatraPDF.exe must never run as our silent print spooler (it prints to real
// paper, unattended). Names we do not ship (PDFtoPrinter.exe, a custom env
// override) carry no pin and are accepted as the operator's own choice.
const EXPECTED_SHA256 = {
  'sumatrapdf.exe': '3793fa285bc890a5e4c263f6f9854cf425bee63c72e52f5362dbc41d60956bcf'
}

// path -> verified?, so the 17MB hash runs at most once per path per process.
const _pinCache = new Map()
// Pinned files that FAILED — surfaced via pinFailures() so main.cjs can log why a
// present-on-disk binary is being treated as missing (otherwise very confusing).
const _pinFailures = new Set()

function passesPin(file) {
  const want = EXPECTED_SHA256[path.basename(file).toLowerCase()]
  if (!want) return true // unpinned name — accept as chosen
  if (_pinCache.has(file)) return _pinCache.get(file)
  let ok = false
  try {
    ok = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') === want
  } catch { ok = false }
  _pinCache.set(file, ok)
  if (!ok) _pinFailures.add(file)
  return ok
}

// Paths that exist but failed their integrity pin (for diagnostic logging).
function pinFailures() { return Array.from(_pinFailures) }

// Where the binary is looked for, first hit wins:
//   1. GOLDLAB_PDF_PRINT_EXE — full path override (testing / odd installs)
//   2. packaged app: resources/bin/<name>   (package.json build.extraResources)
//   3. dev checkout:  <repo>/vendor/pdfprint/<name>
// Returns { exe, source } or null. Never throws.
// A candidate counts only when it exists AND passes its integrity pin — a pinned
// binary that fails the hash is skipped as if it were not there, so resolveExe
// returns null and the caller treats the spooler as missing.
function resolveExe() {
  try {
    const override = process.env.GOLDLAB_PDF_PRINT_EXE
    if (override && fs.existsSync(override) && passesPin(override)) return { exe: override, source: 'env' }
    const dirs = []
    if (process.resourcesPath) dirs.push({ dir: path.join(process.resourcesPath, 'bin'), source: 'packaged' })
    dirs.push({ dir: path.join(__dirname, '..', 'vendor', 'pdfprint'), source: 'dev' })
    for (const { dir, source } of dirs) {
      for (const name of EXE_NAMES) {
        const p = path.join(dir, name)
        if (fs.existsSync(p) && passesPin(p)) return { exe: p, source }
      }
    }
  } catch {}
  return null
}

function available() { return !!resolveExe() }

// noscale is the whole point: it forbids the "shrink/fit to printable area"
// rescaling that produced the shrunken, rotated print. monochrome forces solid-K
// black instead of letting the driver halftone the text into faint grey — the
// same intent the driver-fallback's `color:false` had, which was MISSING from
// this (the actually-used) engine. Copies are handled by the spooler so the PDF
// is rendered once. `mono` defaults true (this path only ever feeds the Canon
// LBP6030, a mono laser); pass false to leave colour to the printer's own setting.
// orientation ('portrait' | 'landscape'): sent EXPLICITLY so the driver's default
// orientation is never inherited. A Landscape driver default rotated the overlay
// 90° (the "ghooma hua" print); noscale only stops scaling, not rotation. Both
// tokens are documented SumatraPDF switches (confirmed present in the binary).
// Omitted → the old behaviour (driver default).
function argsFor(exe, { file, deviceName, copies, mono = true, orientation }) {
  const n = Math.max(1, Math.min(5, parseInt(copies, 10) || 1))
  if (/pdftoprinter/i.test(path.basename(exe))) {
    // PDFtoPrinter.exe <file> "<printer>" [copies]  (no per-setting switches)
    return [file, deviceName, String(n)]
  }
  const settings = ['noscale', `copies=${n}`]
  if (mono) settings.push('monochrome')
  if (orientation === 'portrait' || orientation === 'landscape') settings.push(orientation)
  return [
    '-print-to', deviceName,
    '-print-settings', settings.join(','),
    '-silent', '-exit-when-done',
    file
  ]
}

// Preview the exact command line WITHOUT spooling — for the «پرنٹ تشخیص» report,
// so the shop can see (and WhatsApp) precisely what will be sent. Returns
// { exe, args } or null when no spooler resolves.
function commandPreview({ file = '<sheet>.pdf', deviceName = '', copies = 1, mono = true, orientation } = {}) {
  const found = resolveExe()
  if (!found) return null
  return { exe: found.exe, args: argsFor(found.exe, { file, deviceName, copies, mono, orientation }) }
}

// Write a PDF buffer to a temp file the spooler can read. Returns { file, cleanup }.
function writeTempPdf(buf, tag = 'overlay') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'goldlab-pdf-'))
  const file = path.join(dir, `${tag}.pdf`)
  fs.writeFileSync(file, buf)
  return { file, cleanup: () => { try { fs.rmSync(dir, { recursive: true, force: true }) } catch {} } }
}

// Spool `buf` to `deviceName`. Resolves { ok, engine:'pdf', exe, source } or
// { ok:false, reason } — the caller decides whether to fall back. Deliberately
// never throws: a failure here must be a normal, logged, recoverable outcome.
function printPdfBuffer({ buf, deviceName, copies = 1, tag = 'overlay', mono = true, orientation, timeoutMs = 60000 }) {
  return new Promise((resolve) => {
    const found = resolveExe()
    if (!found) return resolve({ ok: false, reason: 'pdf-spooler-missing' })
    if (!deviceName) return resolve({ ok: false, reason: 'pdf-spooler-needs-device' })
    let tmp = null
    try {
      tmp = writeTempPdf(buf, tag)
      const args = argsFor(found.exe, { file: tmp.file, deviceName, copies, mono, orientation })
      const p = spawn(found.exe, args, { windowsHide: true })
      let err = ''
      let settled = false
      // The temp PDF must outlive the spooler process, so cleanup happens only
      // after close/timeout — never in a finally that races the child.
      const done = (r) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (tmp) tmp.cleanup()
        resolve(r)
      }
      const timer = setTimeout(() => {
        try { p.kill() } catch {}
        // Same rule as the thermal spool: a timeout means the job MAY be in the
        // Windows queue already, so the caller must not blindly retry elsewhere.
        done({ ok: false, reason: 'pdf-spool-timeout', mayHavePrinted: true })
      }, timeoutMs)
      p.stderr.on('data', (d) => { err += d })
      p.on('error', (e) => done({ ok: false, reason: 'pdf-spawn-failed: ' + (e.message || String(e)) }))
      p.on('close', (code) => {
        if (code === 0) return done({ ok: true, engine: 'pdf', exe: found.exe, source: found.source })
        done({ ok: false, reason: `pdf-spooler-exit-${code}${err ? ': ' + err.trim().slice(0, 200) : ''}`, mayHavePrinted: false })
      })
    } catch (e) {
      if (tmp) tmp.cleanup()
      resolve({ ok: false, reason: 'pdf-spool: ' + (e && e.message || String(e)) })
    }
  })
}

// ── Page count, straight from the PDF bytes ──────────────────────────────────
// Used to prove a one-page sheet (a second blank page would waste a pre-printed
// slip on every print). Prefers the page-tree /Count, falls back to counting
// page objects. Returns a number, or null when the structure is unreadable —
// callers treat null as "unknown", never as "one".
function countPages(buf) {
  try {
    const s = Buffer.isBuffer(buf) ? buf.toString('latin1') : String(buf)
    let best = null
    // /Type /Pages ... /Count N  (the order of keys inside the dict varies)
    const re = /\/Type\s*\/Pages\b[^>]*?\/Count\s+(\d+)|\/Count\s+(\d+)[^>]*?\/Type\s*\/Pages\b/g
    let m
    while ((m = re.exec(s))) {
      const n = parseInt(m[1] != null ? m[1] : m[2], 10)
      if (Number.isFinite(n) && (best == null || n > best)) best = n
    }
    if (best != null) return best
    const pages = s.match(/\/Type\s*\/Page(?![s\w])/g)
    return pages ? pages.length : null
  } catch { return null }
}

// First /MediaBox of a PDF → { wPt, hPt } in points, or null. Used to pick the
// spool orientation from the ACTUAL rendered page (wPt > hPt → the page is wide).
function pageSize(buf) {
  try {
    const s = Buffer.isBuffer(buf) ? buf.toString('latin1') : String(buf)
    const m = /\/MediaBox\s*\[\s*(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s*\]/.exec(s)
    if (!m) return null
    const wPt = Math.abs(Number(m[3]) - Number(m[1]))
    const hPt = Math.abs(Number(m[4]) - Number(m[2]))
    if (!(wPt > 0 && hPt > 0)) return null
    return { wPt, hPt }
  } catch { return null }
}

module.exports = { resolveExe, available, printPdfBuffer, countPages, pageSize, writeTempPdf, pinFailures, commandPreview, EXE_NAMES }
