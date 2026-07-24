// End-to-end: feed the REAL report HTML (built by scripts/rpt-html-check.mjs into
// $OUT_HTML) through generateReportPdfs into a temp Drive folder, with staleKeys
// cleanup for the removed receipt reports. Proves: new PDFs written, OLD receipt
// PDFs (wasooli/lab/naqad/udhar) deleted, foreign file + fake DB untouched.
const { app } = require('electron')
const fs = require('fs')
const os = require('os')
const path = require('path')
const reportPdf = require('../electron/reportPdf.cjs')

const HTML = process.env.OUT_HTML
const OUT = path.join(os.tmpdir(), 'goldlab-e2e-reports')
const DB = path.join(os.tmpdir(), 'goldlab-e2e-db')
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(DB, { recursive: true })

const reports = fs.readdirSync(HTML).filter((f) => f.endsWith('.html'))
  .map((f) => ({ reportKey: f.replace(/\.html$/, ''), html: fs.readFileSync(path.join(HTML, f), 'utf8') }))

;(async () => {
  await app.whenReady()
  try {
    // Seed OLD (removed) receipt-report PDFs + a foreign file + fake DB.
    for (const k of ['wasooli', 'lab', 'naqad', 'udhar']) fs.writeFileSync(path.join(OUT, `${k}__2026-07-01_00-00-00.pdf`), 'OLD')
    fs.writeFileSync(path.join(OUT, 'client_note.txt'), 'keep')
    fs.writeFileSync(path.join(OUT, 'goldlab.sqlite'), 'FAKE-DB')

    const res = await reportPdf.generateReportPdfs({ reportsDir: OUT, dbDir: DB, reports, staleKeys: ['wasooli', 'lab', 'naqad', 'udhar'] })
    const after = fs.readdirSync(OUT).sort()
    console.log('ok:', res.ok, '| reports written:', res.results.filter((r) => r.ok).length + '/' + res.results.length)
    res.results.filter((r) => !r.ok).forEach((r) => console.log('   FAIL', r.reportKey, r.reason))
    console.log('stale receipt PDFs removed:', !after.some((f) => /^(wasooli|lab|naqad|udhar)__/.test(f)))
    console.log('foreign kept:', after.includes('client_note.txt'), '| fake DB kept:', after.includes('goldlab.sqlite') && fs.readFileSync(path.join(OUT, 'goldlab.sqlite'), 'utf8') === 'FAKE-DB')
    console.log('new report PDFs:', after.filter((f) => f.endsWith('.pdf')).map((f) => f.split('__')[0]).sort().join(', '))
  } catch (e) { console.error('ERR', e) } finally { app.quit() }
})()
