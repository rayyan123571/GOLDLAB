// ─── Auto report-PDF export to a synced folder (e.g. Google Drive Desktop) ───
// After a transaction, the renderer sends the HTML of each affected report here.
// For each report we DELETE its own old PDF(s) then WRITE a fresh, uniquely-named
// one into REPORTS_DIR, so a remote client always sees the latest.
//
// SAFETY IS THE WHOLE POINT OF THIS MODULE (see assertSafeReportsDir + delete
// rules below): it must be IMPOSSIBLE for this feature to touch the SQLite DB or
// anything outside REPORTS_DIR.
//   • deletion only ever removes TOP-LEVEL files inside REPORTS_DIR that end in
//     ".pdf" AND start with "<reportKey>__" — nothing else, no recursion, no dirs;
//   • REPORTS_DIR is asserted to be neither equal to, inside, nor a parent of the
//     DB directory (%AppData%/gold-lab) — otherwise we throw and do nothing;
//   • goldlab.sqlite is never read/moved/copied/deleted (it can't match the delete
//     filter, and an explicit name guard blocks it anyway).
// This module does NO backup of any kind.
const { BrowserWindow } = require('electron')
const fs = require('fs')
const path = require('path')

// reportKey must be a simple slug so it is filename-safe and can't smuggle a path.
const KEY_RE = /^[a-z0-9_-]{1,40}$/i
const DB_FILENAME = 'goldlab.sqlite' // never touched, ever

// Windows-reserved device names — a file may not be called any of these.
const RESERVED_RE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

// The VISIBLE filename is the Urdu button label; reportKey stays the internal id.
// Urdu/RTL characters are perfectly legal on NTFS (UTF-16 filenames) and in Google
// Drive, so we sanitize ONLY what Windows actually forbids and keep the Urdu intact:
//   • < > : " / \ | ? * and control chars 0–31  → dropped (these also make it
//     impossible for a label to smuggle a path separator or escape REPORTS_DIR);
//   • whitespace → '-' so the name is one token and "__<stamp>" stays easy to spot;
//   • '__' collapsed — it is our label/stamp separator and must appear exactly once;
//   • leading/trailing dots and spaces trimmed (Windows silently strips them);
//   • NFC-normalized so the written name and the delete-prefix compare byte-identical.
// Anything left empty, over-long, or a reserved device name falls back to the ASCII
// key — the export must never fail just because a label was odd.
function safeFileLabel(label, fallbackKey) {
  let s = String(label == null ? '' : label).normalize('NFC')
  s = Array.from(s).filter((ch) => ch.codePointAt(0) >= 32).join('') // drop control chars
  s = s.replace(/[<>:"/\\|?*]/g, '')                                 // Windows-illegal
  s = s.replace(/\s+/g, '-')                                         // one token
  s = s.replace(/_{2,}/g, '_')
  s = s.replace(/^[.\s_-]+|[.\s_-]+$/g, '')                          // no stray edges
  if (!s || s.length > 60 || RESERVED_RE.test(s)) return fallbackKey
  return s
}

// Local "YYYY-MM-DD_HH-mm-ss" (unique per second — no Drive preview cache; the
// timestamp also tells the client which file is the latest).
function stamp() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`
}

// Is `child` equal to, or nested inside, `parent`? (case-insensitive for Windows).
function isWithin(child, parent) {
  const rel = path.relative(parent, child)
  return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel))
}

// THROWS unless reportsDir is safely SEPARATE from the DB directory. Blocks the
// three dangerous relationships: equal, reportsDir inside dbDir, dbDir inside
// reportsDir (i.e. reportsDir is a parent). Anything unexpected → throw (fail safe).
function assertSafeReportsDir(reportsDir, dbDir) {
  if (!reportsDir || typeof reportsDir !== 'string') throw new Error('reports-dir-empty')
  if (!dbDir) throw new Error('db-dir-unknown')
  const A = path.resolve(reportsDir)
  const B = path.resolve(dbDir)
  const al = A.toLowerCase()
  const bl = B.toLowerCase()
  if (al === bl) throw new Error('reports-dir equals the database directory — refusing')
  if (isWithin(al, bl)) throw new Error('reports-dir is inside the database directory — refusing')
  if (isWithin(bl, al)) throw new Error('reports-dir is a PARENT of the database directory — refusing')
  return { A, B }
}

// Delete ONLY this report's own previous PDFs. Ultra-narrow filter; every other
// file in the folder (including the DB, were it ever there — it never is) is left
// untouched. Returns the count removed. Missing dir → 0 (nothing to clean).
function deleteOldReports(dir, reportKey) {
  // NFC on both sides: the prefix may now be Urdu, and a sync client can hand back
  // a differently-normalized name than we wrote. Compare like-for-like so a report
  // still matches its OWN files — the guards below are unchanged.
  const prefix = String(reportKey).normalize('NFC') + '__'
  let removed = 0
  let names
  try { names = fs.readdirSync(dir) } catch { return 0 }
  for (const name of names) {
    // Hard guards, in order of paranoia:
    if (name === DB_FILENAME) continue                    // never the DB
    if (!name.normalize('NFC').startsWith(prefix)) continue // only THIS report's files
    if (!name.toLowerCase().endsWith('.pdf')) continue    // only .pdf
    const full = path.join(dir, name)
    let st
    try { st = fs.lstatSync(full) } catch { continue }
    if (!st.isFile()) continue                            // never a dir/symlink/etc.
    try { fs.unlinkSync(full); removed++ } catch { /* leave it; not fatal */ }
  }
  return removed
}

// Render one HTML string to a PDF buffer on an EXISTING hidden window. A single
// window is reused for the whole batch (created/destroyed by the caller) — faster,
// and it sidesteps the "only one fresh BrowserWindow per turn" quirk that can make
// a per-report window fail to load. `html` may carry the /*__APP_CSS__*/ marker
// which the caller has already spliced.
async function htmlToPdfOn(w, html, { landscape = false, pageSize = 'A4' } = {}) {
  await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
  // The report page defines window.__ready (fonts settled) — await it, but never
  // hang: a short cap guarantees we always print.
  try {
    await Promise.race([
      w.webContents.executeJavaScript('Promise.resolve(window.__ready)', true),
      new Promise((r) => setTimeout(r, 4000))
    ])
  } catch { /* print anyway */ }
  return await w.webContents.printToPDF({
    printBackground: true,
    landscape,
    pageSize,
    margins: { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 }
  })
}

// Load the built renderer stylesheet from disk, to splice into report HTML when
// the renderer couldn't serialize CSSOM (packaged file:// builds). Cached.
let appCssCache = null
function loadAppCss() {
  if (appCssCache != null) return appCssCache
  try {
    const assets = path.join(__dirname, '..', 'dist', 'assets')
    const file = fs.readdirSync(assets).find((f) => f.endsWith('.css'))
    appCssCache = file ? fs.readFileSync(path.join(assets, file), 'utf8') : ''
  } catch { appCssCache = '' }
  return appCssCache
}

// ── Orchestrator ─────────────────────────────────────────────────────────────
// reports = [{ reportKey, html, landscape?, pageSize? }]. For EACH, independently:
// assert safe → delete old → write fresh "<reportKey>__<stamp>.pdf". One report's
// failure never aborts the others, and NOTHING here can throw out to the caller in
// a way that blocks the transaction (main wraps the IPC too). Returns per-report
// results. The SQLite DB is never opened, read, copied, moved, or deleted.
async function generateReportPdfs({ reportsDir, dbDir, reports, staleKeys }) {
  const results = []
  if (!Array.isArray(reports) || !reports.length) return { ok: false, reason: 'no-reports', results }

  // One safety gate for the whole batch — if the folder is unsafe we do NOTHING.
  try {
    assertSafeReportsDir(reportsDir, dbDir)
  } catch (e) {
    return { ok: false, reason: String(e && e.message || e), results }
  }

  const dir = path.resolve(reportsDir)
  // Create the folder if the sync client hasn't yet (safe: it's the user's chosen
  // path and we already proved it isn't near the DB). Failure aborts the batch.
  try { fs.mkdirSync(dir, { recursive: true }) } catch (e) {
    return { ok: false, reason: 'mkdir: ' + (e && e.message || e), results }
  }

  // Clean up PDFs of reports that were REMOVED from the set (e.g. the old receipt
  // clones). Uses the same narrow, safety-guarded delete filter — deletes ONLY
  // "<key>__*.pdf", never anything else, never the DB.
  if (Array.isArray(staleKeys)) {
    for (const k of staleKeys) {
      if (KEY_RE.test(String(k || ''))) { try { deleteOldReports(dir, k) } catch {} }
    }
  }

  const css = loadAppCss()
  // ONE hidden window for the whole batch.
  const win = new BrowserWindow({
    show: false, width: 1200, height: 900, frame: false,
    webPreferences: { sandbox: false, backgroundThrottling: false, offscreen: false }
  })
  try {
    for (const r of reports) {
      const key = r && r.reportKey
      try {
        if (!KEY_RE.test(String(key || ''))) throw new Error('bad-report-key')
        if (!r.html || typeof r.html !== 'string') throw new Error('no-html')
        // VISIBLE name = the Urdu button label (sanitized); reportKey stays internal.
        const name = safeFileLabel(r.label, key)
        // Same delete filter as always, just run for both prefixes: the Urdu name
        // (this report's current files) and the ASCII key (files written before the
        // rename, which would otherwise be orphaned forever). No new delete logic.
        const removed = deleteOldReports(dir, name) + (name === key ? 0 : deleteOldReports(dir, key))
        const html = r.html.includes('/*__APP_CSS__*/') ? r.html.replace('/*__APP_CSS__*/', css) : r.html
        const pdf = await htmlToPdfOn(win, html, { landscape: !!r.landscape, pageSize: r.pageSize || 'A4' })
        const file = path.join(dir, `${name}__${stamp()}.pdf`)
        fs.writeFileSync(file, pdf)
        results.push({ reportKey: key, ok: true, removed, file })
      } catch (e) {
        results.push({ reportKey: key, ok: false, reason: String(e && e.message || e) })
      }
    }
  } finally {
    try { win.destroy() } catch {}
  }
  return { ok: results.some((x) => x.ok), results }
}

module.exports = { generateReportPdfs, assertSafeReportsDir, deleteOldReports, safeFileLabel }
