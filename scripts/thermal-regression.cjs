// ─── Thermal path regression check ───────────────────────────────────────────
// The ESC/POS thermal path is in production and must not move when the overlay
// path is worked on. This renders the worst-case receipt through the REAL
// rasterPrint pipeline in dry-run mode (GOLDLAB_PRINT_PDF_DIR → bytes + a PNG of
// the exact 1-bit bitmap, no printer touched) and byte-compares that PNG with the
// committed artifacts/thermal-worstcase-regression.png.
//
// Identical bytes = the render is unchanged, down to the pixel. A difference is
// not automatically a bug (fonts/Electron version move too), but it must be
// explained before shipping.
//
// Run: npm run thermal:regression
const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const { app, BrowserWindow } = require('electron')

const ROOT = path.join(__dirname, '..')
const BASELINE = path.join(ROOT, 'artifacts', 'thermal-worstcase-regression.png')

// The dry-run hook is read at call time inside rasterPrint, so it just has to be
// set before printHtml runs.
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'goldlab-thermal-reg-'))
process.env.GOLDLAB_PRINT_PDF_DIR = OUT

const raster = require(path.join(ROOT, 'electron', 'rasterPrint.cjs'))

app.on('window-all-closed', () => {}) // keep alive between renders (see overlay-dryrun)

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex')

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 900, height: 700, webPreferences: { sandbox: false, offscreen: { useSharedTexture: false } } })
  let code = 0
  try {
    console.log('\n=== THERMAL REGRESSION (dry run — no printer touched) ===')
    // printScale 1.15 = the shipped default (see main.cjs printSettings).
    const res = await raster.testPrint({ kind: 'worstcase', win, printScale: 1.15 })
    if (!res || !res.ok) { console.error('render FAILED:', res && res.reason); app.exit(1); return }
    const png = fs.readdirSync(OUT).find((f) => f.endsWith('.png'))
    if (!png) { console.error('no PNG produced in ' + OUT); app.exit(1); return }
    const fresh = fs.readFileSync(path.join(OUT, png))
    console.log(`rendered  ${res.widthDots} x ${res.heightDots} dots   sha=${sha(fresh).slice(0, 16)}`)

    if (!fs.existsSync(BASELINE)) {
      fs.writeFileSync(BASELINE, fresh)
      console.log('no baseline existed — wrote one. Commit it and re-run to compare.')
    } else {
      const base = fs.readFileSync(BASELINE)
      console.log(`baseline  ${base.length} bytes            sha=${sha(base).slice(0, 16)}`)
      if (base.equals(fresh)) {
        console.log('\n  ok    thermal worst-case render is BYTE-IDENTICAL to the baseline\n')
      } else {
        const changed = path.join(ROOT, 'artifacts', 'thermal-worstcase-CHANGED.png')
        fs.writeFileSync(changed, fresh)
        console.error('\n  FAIL  thermal render CHANGED vs the baseline')
        console.error('        new output written to artifacts/thermal-worstcase-CHANGED.png')
        console.error('        compare the two before shipping.\n')
        code = 1
      }
    }
  } catch (e) {
    console.error(e); code = 1
  } finally {
    try { win.destroy() } catch {}
    try { fs.rmSync(OUT, { recursive: true, force: true }) } catch {}
    app.exit(code)
  }
})
