// Dry-run for electron/reportPdf.cjs: generate report PDFs into a temp folder,
// then run AGAIN to prove old PDFs are deleted + fresh ones written (unique names),
// and that a foreign file + the "DB" are never touched. Also checks the safety
// refusal when REPORTS_DIR == DB dir.
// Run: MODE=1 node scripts/run-electron.cjs scripts/reports-test.cjs   (and MODE=2)
const { app } = require('electron')
const fs = require('fs')
const os = require('os')
const path = require('path')
const reportPdf = require('../electron/reportPdf.cjs')

const OUT = process.env.RPT_DIR || path.join(os.tmpdir(), 'goldlab-reports-test')
const DB = process.env.RPT_DB || path.join(os.tmpdir(), 'goldlab-db-test')
fs.mkdirSync(OUT, { recursive: true })
fs.mkdirSync(DB, { recursive: true })

const doc = (title, body) =>
  `<!doctype html><html dir="rtl"><head><meta charset="utf-8"><style>body{font-family:sans-serif;padding:20px}h1{font-size:20pt}</style></head>` +
  `<body><h1>${title}</h1>${body}<script>window.__ready=Promise.resolve(true)</scr` + `ipt></body></html>`

const reports = [
  { reportKey: 'lab', html: doc('لیب رسید', '<p>خالص وزن: 10.62 · بقایا: 4,150,588</p>'), pageSize: 'A4' },
  { reportKey: 'roznamcha', html: doc('روزنامچہ — 2026-07-20', '<table border=1><tr><td>وقت</td><td>گاہک</td></tr><tr><td>12:58</td><td>احمد</td></tr></table>'), landscape: true }
]

;(async () => {
  await app.whenReady()
  try {
    const MODE = process.env.MODE || '1'
    if (MODE === '3') {
      // Safety: refuse when reportsDir === dbDir.
      const r = await reportPdf.generateReportPdfs({ reportsDir: DB, dbDir: DB, reports })
      console.log('SAFETY (reportsDir==dbDir):', JSON.stringify(r.ok), r.reason)
    } else {
      if (MODE === '1') {
        // seed a foreign file + a fake DB alongside, to prove they survive
        fs.writeFileSync(path.join(OUT, 'client_note.txt'), 'keep me')
        fs.writeFileSync(path.join(OUT, 'goldlab.sqlite'), 'FAKE-DB')
      }
      const before = fs.readdirSync(OUT).filter((f) => f.endsWith('.pdf')).sort()
      const res = await reportPdf.generateReportPdfs({ reportsDir: OUT, dbDir: DB, reports })
      const after = fs.readdirSync(OUT).sort()
      console.log('MODE', MODE, '→ ok:', res.ok)
      res.results.forEach((r) => console.log('   ', r.reportKey, r.ok ? ('OK removed=' + r.removed + ' → ' + path.basename(r.file)) : ('FAIL: ' + r.reason)))
      console.log('   pdf BEFORE:', JSON.stringify(before))
      console.log('   ALL files AFTER:', JSON.stringify(after))
      console.log('   foreign file kept:', after.includes('client_note.txt'), '| fake DB kept:', after.includes('goldlab.sqlite') && fs.readFileSync(path.join(OUT, 'goldlab.sqlite'), 'utf8') === 'FAKE-DB')
    }
  } catch (e) { console.error('ERR', e) } finally { app.quit() }
})()
