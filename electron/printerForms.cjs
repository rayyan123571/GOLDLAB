// ─── What paper sizes does this printer actually offer? ──────────────────────
// The overlay sheet is a NON-STANDARD 215.9 × 139.7 mm (half-letter landscape).
// If the Canon has no form of that size, the driver has nothing to match and
// falls back to its own default paper — then "fit to page" and "auto-rotate"
// turn our exact-size page into the rotated, shrunken print the shop reported.
// So the app must CHECK, not assume.
//
// Electron's getPrintersAsync() gives a driver-defined `options` bag that does
// not reliably contain page sizes, so this asks Windows directly through
// System.Drawing.Printing.PrinterSettings, whose PaperSizes carry real
// dimensions (in hundredths of an inch).
//
// PowerShell 2.0 safe (Windows 7): `Add-Type -AssemblyName` only LOADS an
// assembly — no C# is compiled here, so none of the C#3 syntax limits that broke
// the thermal RAW path apply.
const { spawn } = require('child_process')

const MM_PER_UNIT = 25.4 / 100 // PrinterSettings units are 1/100 inch

// Printer names come from the DB; embed as a single-quoted PowerShell literal
// with '' escaping so a name containing a quote cannot break out of the string.
const psLiteral = (s) => "'" + String(s == null ? '' : s).replace(/'/g, "''") + "'"

function script(deviceName) {
  return [
    '$ErrorActionPreference = "Stop"',
    'Add-Type -AssemblyName System.Drawing',
    '$ps = New-Object System.Drawing.Printing.PrinterSettings',
    `$ps.PrinterName = ${psLiteral(deviceName)}`,
    // IsValid is false for a printer name Windows does not know.
    'if (-not $ps.IsValid) { Write-Output "INVALID"; exit 0 }',
    // name|width|height, one per line. Width/Height are hundredths of an inch.
    'foreach ($p in $ps.PaperSizes) { Write-Output ("SIZE|" + $p.PaperName + "|" + $p.Width + "|" + $p.Height) }'
  ].join('\n')
}

// Returns { ok, sizes:[{name,wMm,hMm}] } | { ok:false, reason }. Never throws:
// a preflight that cannot read the printer must degrade to "unknown", not break
// printing.
function listPaperSizes(deviceName, timeoutMs = 20000) {
  return new Promise((resolve) => {
    if (!deviceName) return resolve({ ok: false, reason: 'no-device' })
    let out = ''
    let err = ''
    let settled = false
    const done = (r) => { if (!settled) { settled = true; clearTimeout(timer); resolve(r) } }
    let p
    const timer = setTimeout(() => { try { p.kill() } catch {} ; done({ ok: false, reason: 'forms-timeout' }) }, timeoutMs)
    try {
      p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script(deviceName)], { windowsHide: true })
    } catch (e) { return done({ ok: false, reason: 'forms-spawn: ' + (e.message || String(e)) }) }
    p.stdout.on('data', (d) => { out += d })
    p.stderr.on('data', (d) => { err += d })
    p.on('error', (e) => done({ ok: false, reason: 'forms-spawn: ' + (e.message || String(e)) }))
    p.on('close', () => {
      if (/INVALID/.test(out)) return done({ ok: false, reason: 'printer-not-valid' })
      const sizes = []
      for (const line of out.split(/\r?\n/)) {
        const m = /^SIZE\|(.*)\|(\d+)\|(\d+)$/.exec(line.trim())
        if (!m) continue
        sizes.push({
          name: m[1],
          wMm: Math.round(Number(m[2]) * MM_PER_UNIT * 10) / 10,
          hMm: Math.round(Number(m[3]) * MM_PER_UNIT * 10) / 10
        })
      }
      if (!sizes.length) return done({ ok: false, reason: err.trim().slice(0, 200) || 'no-sizes-reported' })
      done({ ok: true, sizes })
    })
  })
}

// Is there a form matching w × h (mm) within tol? Either orientation counts: a
// "GOLDLAB PARCHI" defined as 139.7 × 215.9 is the same physical sheet, and the
// driver rotates between them itself.
function findForm(sizes, w, h, tol = 0.5) {
  const near = (a, b) => Math.abs(a - b) <= tol
  return (sizes || []).find((s) =>
    (near(s.wMm, w) && near(s.hMm, h)) || (near(s.wMm, h) && near(s.hMm, w))
  ) || null
}

// The click-path the shopkeeper follows to create the form, as plain Urdu text —
// also handed to the UI's "کاپی کریں" button so it can be sent over WhatsApp.
// Kept here (not in the component) so the printed proof footer, the dialog and
// the copied text can never drift apart.
function formInstructionsUrdu(paperW = 215.9, paperH = 139.7, printer = 'Canon LBP6030') {
  const cmW = (paperW / 10).toFixed(2)
  const cmH = (paperH / 10).toFixed(2)
  return [
    'گولڈ لیب — پرچی کے لیے پرنٹر میں کاغذ کا ناپ بنائیں',
    '',
    `پرنٹر: ${printer}`,
    `ناپ: ${cmW} سم × ${cmH} سم  (${paperW} × ${paperH} ملی میٹر)`,
    '',
    '1. Control Panel کھولیں → Devices and Printers۔',
    '2. اوپر کسی بھی پرنٹر پر ایک بار کلک کریں، پھر اوپر والی پٹی میں Print Server Properties دبائیں۔',
    '3. Forms والے ٹیب میں "Create a new form" پر ٹک لگائیں۔',
    '4. Form name میں لکھیں:  GOLDLAB PARCHI',
    '5. Units میں Metric منتخب کریں۔',
    `6. Width میں ${cmW} اور Height میں ${cmH} لکھیں۔`,
    '7. چاروں Margins صفر (0.00) رکھیں۔',
    '8. Save Form دبائیں، پھر Close۔',
    '',
    `9. اب ${printer} پر دائیں کلک → Printing Preferences۔`,
    '10. Page Setup میں Page Size = GOLDLAB PARCHI منتخب کریں۔',
    '11. Scaling / Page Layout: "Off" یا "100%" یا "Actual size" رکھیں — Fit to Page نہ ہو۔',
    '12. Auto-rotate / Rotate بند (Off) رکھیں۔',
    '13. OK دبا کر محفوظ کریں۔',
    '',
    '14. آخر میں گولڈ لیب میں «پروف شیٹ» چھاپ کر دونوں 100mm بار ناپ لیں۔'
  ].join('\n')
}

module.exports = { listPaperSizes, findForm, formInstructionsUrdu }
