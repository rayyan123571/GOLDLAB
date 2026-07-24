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
// It is NOT bundled in this repo — see resolveExe() for where to drop it. When
// it is absent the caller falls back to the hardened webContents.print path and
// says so in the print log; printing must never simply stop because a helper
// binary is missing.
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')

// Accepted file names, in order. PDFtoPrinter is a common alternative the shop
// may already have; it takes the printer name as its second positional arg, so
// argsFor() below branches on the name.
const EXE_NAMES = ['SumatraPDF.exe', 'SumatraPDF-portable.exe', 'PDFtoPrinter.exe']

// Where the binary is looked for, first hit wins:
//   1. GOLDLAB_PDF_PRINT_EXE — full path override (testing / odd installs)
//   2. packaged app: resources/bin/<name>   (package.json build.extraResources)
//   3. dev checkout:  <repo>/vendor/pdfprint/<name>
// Returns { exe, source } or null. Never throws.
function resolveExe() {
  try {
    const override = process.env.GOLDLAB_PDF_PRINT_EXE
    if (override && fs.existsSync(override)) return { exe: override, source: 'env' }
    const dirs = []
    if (process.resourcesPath) dirs.push({ dir: path.join(process.resourcesPath, 'bin'), source: 'packaged' })
    dirs.push({ dir: path.join(__dirname, '..', 'vendor', 'pdfprint'), source: 'dev' })
    for (const { dir, source } of dirs) {
      for (const name of EXE_NAMES) {
        const p = path.join(dir, name)
        if (fs.existsSync(p)) return { exe: p, source }
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
function argsFor(exe, { file, deviceName, copies, mono = true }) {
  const n = Math.max(1, Math.min(5, parseInt(copies, 10) || 1))
  if (/pdftoprinter/i.test(path.basename(exe))) {
    // PDFtoPrinter.exe <file> "<printer>" [copies]  (no per-setting switches)
    return [file, deviceName, String(n)]
  }
  const settings = ['noscale', `copies=${n}`]
  if (mono) settings.push('monochrome')
  return [
    '-print-to', deviceName,
    '-print-settings', settings.join(','),
    '-silent', '-exit-when-done',
    file
  ]
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
function printPdfBuffer({ buf, deviceName, copies = 1, tag = 'overlay', mono = true, timeoutMs = 60000 }) {
  return new Promise((resolve) => {
    const found = resolveExe()
    if (!found) return resolve({ ok: false, reason: 'pdf-spooler-missing' })
    if (!deviceName) return resolve({ ok: false, reason: 'pdf-spooler-needs-device' })
    let tmp = null
    try {
      tmp = writeTempPdf(buf, tag)
      const args = argsFor(found.exe, { file: tmp.file, deviceName, copies, mono })
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

module.exports = { resolveExe, available, printPdfBuffer, countPages, writeTempPdf, EXE_NAMES }
