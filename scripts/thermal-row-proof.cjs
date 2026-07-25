// ─── Thermal لیب رسید — proof of the «پوائنٹ» → «بقایا سونا» swap ─────────────
//
// The لیب رسید's money table now prints «بقایا سونا» (the net gold, sonaDena)
// where «پوائنٹ» used to sit, and the separate «بقایا سونا» row from the previous
// build is gone again. That legitimately moves the thermal:regression baseline —
// but "the baseline moved" must never be taken on trust. This renders the
// worst-case لیب رسید through the REAL rasterPrint pipeline and proves the change
// in isolation against artifacts/thermal-worstcase-before.png — the ORIGINAL
// baseline from BEFORE the extra row ever existed (11 template rows, پوائنٹ in
// the بقایا رقم row):
//
//   A. same sheet: 576 dots wide, same height, same printed rules and row bands —
//      i.e. removing the extra row put the slip back EXACTLY on the original
//      geometry (and shorter than the extra-row build it replaces)
//   B. every differing scanline lies inside ONE row band — the بقایا رقم row,
//      where the label/value pair was swapped. Nothing above or below moved.
//   C. DOM layout at the pipeline's own 576px width: table 3 keeps the ORIGINAL
//      column widths (111.41 | 161.67 | 160.72 | 125.63) — «بقایا سونا» lives in
//      the wide second label column, so no column grew — and the money table
//      spans the same x for both the worst-case and a realistic receipt
//   D. the نام row (longest Urdu name, wrap enabled) is still ONE line
//
// Run: npm run thermal:rowproof
const fs = require('fs')
const os = require('os')
const path = require('path')
const { app, BrowserWindow, nativeImage, screen } = require('electron')

const ROOT = path.join(__dirname, '..')
const ART = path.join(ROOT, 'artifacts')
const ORIGINAL = path.join(ART, 'thermal-worstcase-before.png') // pre-extra-row baseline

const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'goldlab-rowproof-'))
process.env.GOLDLAB_PRINT_PDF_DIR = OUT
const raster = require(path.join(ROOT, 'electron', 'rasterPrint.cjs'))

app.on('window-all-closed', () => {})

let failures = 0
const fail = (m) => { failures++; console.error('  FAIL  ' + m) }
const pass = (m) => console.log('  ok    ' + m)

// The ORIGINAL money-table column widths (css px), measured before any of this —
// the swap must leave every one of them exactly in place.
const T3_WIDTHS = [111.41, 161.67, 160.72, 125.63]

// Render the current worst-case template; returns the dry-run PNG path.
async function render(win, tag) {
  for (const f of fs.readdirSync(OUT)) fs.unlinkSync(path.join(OUT, f))
  const res = await raster.testPrint({ kind: 'worstcase', win, printScale: 1.15 })
  if (!res || !res.ok) throw new Error(`render failed: ${res && res.reason}`)
  const png = fs.readdirSync(OUT).find((f) => f.endsWith('.png'))
  const dest = path.join(ART, `thermal-worstcase-${tag}.png`)
  fs.copyFileSync(path.join(OUT, png), dest)
  return dest
}

// Measure the rendered table layout in the DOM, grouped per table, at the SAME
// effective 576px width the raster pipeline uses (offscreen + DPI zoom, no
// scrollbar) — layout numbers carry no rasterization rounding.
async function layout(data) {
  const scale = (screen.getPrimaryDisplay() && screen.getPrimaryDisplay().scaleFactor) || 1
  const dipW = Math.ceil(576 / scale)
  const w = new BrowserWindow({
    show: false, width: dipW, height: 600, frame: false,
    webPreferences: { offscreen: { useSharedTexture: false }, backgroundThrottling: false, sandbox: false }
  })
  try {
    await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(raster.buildReceiptHtml(data)))
    w.webContents.setZoomFactor(1 / scale)
    let h = 900
    try { h = await w.webContents.executeJavaScript('Promise.resolve(window.__ready)', true) } catch {}
    w.setContentSize(dipW, Math.ceil((Number(h) || 900) / scale) + 20)
    await new Promise((r) => setTimeout(r, 120))
    return await w.webContents.executeJavaScript(`(function(){
      var r = document.querySelector('[data-measure]').getBoundingClientRect()
      var R = Math.round, out = []
      var tables = document.querySelectorAll('table')
      Array.prototype.forEach.call(tables, function (tbl, ti) {
        Array.prototype.forEach.call(tbl.querySelectorAll('tr'), function (tr) {
          var b = tr.getBoundingClientRect()
          out.push({
            table: ti,
            h: R(b.height * 100) / 100,
            cells: Array.prototype.map.call(tr.children, function (td) {
              var c = td.getBoundingClientRect()
              return { x: R((c.left - r.left) * 100) / 100, w: R(c.width * 100) / 100, text: (td.textContent || '').trim() }
            })
          })
        })
      })
      return out
    })()`, true)
  } finally { try { w.destroy() } catch {} }
}

// ── bitmap helpers (the dry-run PNG is pure black/white) ─────────────────────
function load(file) {
  const img = nativeImage.createFromPath(file)
  const { width, height } = img.getSize()
  if (!width || !height) throw new Error('could not read ' + file)
  const bgra = img.toBitmap()
  const px = Buffer.alloc(width * height) // 1 byte/pixel, 1 = black
  for (let i = 0, n = width * height; i < n; i++) px[i] = bgra[i * 4] < 128 ? 1 : 0
  return { width, height, px, file }
}
const rowEq = (a, ya, b, yb) => a.px.compare(b.px, yb * b.width, (yb + 1) * b.width, ya * a.width, (ya + 1) * a.width) === 0
const rowInk = (im, y) => { let n = 0; for (let x = 0; x < im.width; x++) n += im.px[y * im.width + x]; return n }

function hRules(im) {
  const out = []
  let run = -1
  for (let y = 0; y < im.height; y++) {
    const solid = rowInk(im, y) > im.width * 0.5
    if (solid && run < 0) run = y
    if (!solid && run >= 0) { out.push({ y0: run, y1: y - 1 }); run = -1 }
  }
  if (run >= 0) out.push({ y0: run, y1: im.height - 1 })
  return out
}
const bandsOf = (rules) => rules.slice(0, -1).map((r, i) => rules[i + 1].y0 - r.y1 - 1)

function sideBySide(a, b, band) {
  const GAP = 24
  const W = a.width + GAP + b.width
  const H = Math.max(a.height, b.height)
  const bgra = Buffer.alloc(W * H * 4, 0xff)
  const blit = (im, ox) => {
    for (let y = 0; y < im.height; y++) {
      for (let x = 0; x < im.width; x++) {
        const v = im.px[y * im.width + x] ? 0 : 255
        const o = ((y * W) + ox + x) * 4
        bgra[o] = v; bgra[o + 1] = v; bgra[o + 2] = v; bgra[o + 3] = 255
      }
    }
  }
  blit(a, 0)
  blit(b, a.width + GAP)
  for (let y = band.from; y <= band.to && y < H; y++) { // marker in the gutter
    for (let x = a.width + 6; x < a.width + GAP - 6; x++) {
      const o = ((y * W) + x) * 4
      bgra[o] = 0; bgra[o + 1] = 0; bgra[o + 2] = 0; bgra[o + 3] = 255
    }
  }
  return nativeImage.createFromBitmap(bgra, { width: W, height: H }).toPNG()
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 900, height: 700, webPreferences: { sandbox: false, offscreen: { useSharedTexture: false } } })
  try {
    console.log('\n=== THERMAL لیب رسید — «پوائنٹ» → «بقایا سونا» SWAP PROOF (dry run) ===')
    if (!fs.existsSync(ORIGINAL)) { fail(`missing ${ORIGINAL} (the pre-extra-row baseline)`); app.exit(1); return }

    const a = load(ORIGINAL)                       // original: 11 rows, پوائنٹ
    const b = load(await render(win, 'after'))     // current : 11 rows, بقایا سونا
    console.log(`original ${a.width}x${a.height}   current ${b.width}x${b.height}   (extra-row build was 576x1619)\n`)

    // ── A. same sheet geometry as the ORIGINAL ────────────────────────────────
    console.log('A. sheet geometry vs the original baseline:')
    a.width === 576 && b.width === 576 ? pass('both 576 dots wide') : fail(`width ${a.width} -> ${b.width}`)
    a.height === b.height
      ? pass(`same height (${b.height} dots) — the extra row is gone, back on the original geometry`)
      : fail(`height differs: original ${a.height}, current ${b.height}`)
    b.height < 1619
      ? pass(`and shorter than the extra-row build it replaces (${b.height} < 1619)`)
      : fail('slip did not shrink vs the extra-row build')
    const ra = hRules(a); const rb = hRules(b)
    const ba = bandsOf(ra); const bb = bandsOf(rb)
    ba.length === bb.length && ba.every((v, i) => v === bb[i])
      ? pass(`all ${ba.length} row bands identical to the original — no row grew, shrank, appeared or vanished`)
      : fail(`row bands differ: [${ba.join(',')}] vs [${bb.join(',')}]`)

    // ── B. the swap is the ONLY pixel difference, confined to ONE row band ────
    let firstDiff = -1; let lastDiff = -1
    for (let y = 0; y < a.height; y++) {
      if (!rowEq(a, y, b, y)) { if (firstDiff < 0) firstDiff = y; lastDiff = y }
    }
    console.log('\nB. differing scanlines:')
    if (firstDiff < 0) { fail('no differing scanlines at all — the swap did not render?') } else {
      console.log(`   rows ${firstDiff}..${lastDiff} differ (${lastDiff - firstDiff + 1} scanlines)`)
      // the band that fully contains the diff (between two adjacent printed rules)
      const band = rb.findIndex((r, i) => i < rb.length - 1 && rb[i].y1 < firstDiff && lastDiff < rb[i + 1].y0)
      band >= 0
        ? pass(`ALL differing scanlines sit inside ONE row band (band ${band}, the بقایا رقم row) — the پوائنٹ→بقایا سونا swap is the only change`)
        : fail('differences span more than one row band — something else changed too')
      fs.writeFileSync(path.join(ART, 'thermal-worstcase-sidebyside.png'),
        sideBySide(a, b, { from: firstDiff, to: lastDiff }))
    }

    // ── C. DOM layout: original column widths, table back in place ────────────
    const WITH = raster.WORST_CASE_DATA
    const lay = await layout(WITH)
    const rows3 = lay.filter((r) => r.table === 2)
    console.log('\nC. DOM layout (576px, no rasterization rounding):')
    console.log(`   table rows: ${lay.length} total, ${rows3.length} in the money table`)
    lay.length === 11 ? pass('template is back to 11 rows') : fail(`template has ${lay.length} rows, expected 11`)
    const widths = rows3[rows3.length - 1].cells.map((c) => c.w)
    console.log(`   table-3 widths: ${widths.join(' | ')}   (original: ${T3_WIDTHS.join(' | ')})`)
    widths.length === 4 && widths.every((w, i) => Math.abs(w - T3_WIDTHS[i]) <= 0.05)
      ? pass('all four money-table columns are EXACTLY the original widths — «بقایا سونا» fits its wide column without growing it')
      : fail('money-table column widths moved')
    const bsRows = lay.filter((r) => r.cells.some((c) => c.text === 'بقایا سونا'))
    bsRows.length === 1 && bsRows[0].cells.some((c) => c.text === 'بقایا رقم')
      ? pass('«بقایا سونا» appears exactly ONCE, inside the بقایا رقم row — no separate row remains')
      : fail(`بقایا سونا appears in ${bsRows.length} row(s)${bsRows.length ? ` (first row's cells: ${bsRows[0].cells.map((c) => c.text || '·').join(' | ')})` : ''}`)
    lay.some((r) => r.cells.some((c) => c.text === 'پوائنٹ'))
      ? fail('a پوائنٹ cell still renders on the thermal slip')
      : pass('no پوائنٹ anywhere on the thermal slip — deliberate')

    // span: the money table must sit at its ORIGINAL x for the worst case AND a
    // realistic receipt (the overlay sample's tables, with the same swap applied).
    const overlayForm = require(path.join(ROOT, 'electron', 'overlayForm.cjs'))
    const realistic = overlayForm.buildSampleData()
    realistic.tables = realistic.tables.map((t) => t.map((row) => row.map((c) =>
      c.l === 'پوائنٹ' ? { l: 'بقایا سونا' } : (c.v === '0.9111' ? { v: '10.599' } : c))))
    for (const [name, data, wantX] of [['worst-case', WITH, 5.08], ['realistic', realistic, 6.98]]) {
      const cells = (await layout(data)).filter((r) => r.table === 2).pop().cells
      const left = Math.min(...cells.map((c) => c.x))
      Math.abs(left - wantX) <= 0.35
        ? pass(`${name}: money table starts at x ${left} (original ~${wantX}) — back in place`)
        : fail(`${name}: money table starts at x ${left}, expected ~${wantX}`)
    }

    // ── D. نام row still one line ─────────────────────────────────────────────
    console.log('\nD. نام row (longest Urdu name, wrap enabled):')
    ba[ba.length - 2] === bb[bb.length - 2]
      ? pass(`same band height as the original (${bb[bb.length - 2]} dots) — «محمد عبدالرحمٰن چوہدری اینڈ سنز» is still ONE line`)
      : fail(`نام band ${ba[ba.length - 2]} -> ${bb[bb.length - 2]}`)

    console.log('\nartifacts:')
    console.log('  thermal-worstcase-before.png      original baseline (پوائنٹ era)')
    console.log('  thermal-worstcase-after.png       current (بقایا سونا in its place)')
    console.log('  thermal-worstcase-sidebyside.png  both, differing band marked in the gutter')
    console.log(failures ? `\n${failures} FAILURE(S)\n` : '\nthe swap is the ONLY change, on the original geometry\n')
    app.exit(failures ? 1 : 0)
  } catch (e) {
    console.error(e); app.exit(1)
  } finally {
    try { win.destroy() } catch {}
    try { fs.rmSync(OUT, { recursive: true, force: true }) } catch {}
  }
})
