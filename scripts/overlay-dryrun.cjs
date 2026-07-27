// ─── Overlay dry-run — geometry + page-count verification ────────────────────
//
// *** THIS DOES NOT PROVE THE PRINT WORKS ON THE CLIENT'S CANON. ***
// Everything here goes through printToPDF, which NEVER touches the Windows
// driver. The bug this whole feature is fighting — the driver auto-rotating and
// shrinking the page — is invisible to this script BY CONSTRUCTION. What it does
// prove: the sheet is exactly one page, every value lands inside the sheet, and
// no LEFT-slip value strays into the RIGHT-slip half. To learn what the printer
// does, print the proof sheet (پروف شیٹ) on plain paper and measure the bars.
//
// Run: npm run overlay:dryrun   → writes ./artifacts/overlay-*.pdf|.png
//
// Runs under Electron-as-node? No — it needs a real Electron runtime for
// BrowserWindow/printToPDF, so scripts/overlay-dryrun.cjs is launched BY
// electron (see the npm script), not by node.
const fs = require('fs')
const path = require('path')
const { app, BrowserWindow } = require('electron')

const ROOT = path.join(__dirname, '..')
const OUT = path.join(ROOT, 'artifacts')
const overlayForm = require(path.join(ROOT, 'electron', 'overlayForm.cjs'))
const pdfPrint = require(path.join(ROOT, 'electron', 'pdfPrint.cjs'))
const { DEFAULT_COORDS, DEFAULT_OFFSETS } = require(path.join(ROOT, 'electron', 'overlayDefaults.cjs'))

// Each render destroys its window. On Windows the DEFAULT window-all-closed
// handler then quits the app, which STOPS the next render's navigation — that is
// the ERR_FAILED the second render hit, and it is a harness artefact only: the
// real app always keeps its main window open, so an overlay print window is never
// the last one. Opting out of the default keeps this script alive between renders.
app.on('window-all-closed', () => {})

const PAPER = overlayForm.PAPERS.halfletter_landscape
const round2 = (n) => (n == null ? n : Math.round(n * 100) / 100)
let failures = 0
const fail = (msg) => { failures++; console.error('  FAIL  ' + msg) }
const pass = (msg) => console.log('  ok    ' + msg)

// The config the shop actually ships with (defaults), so the dry-run measures the
// out-of-the-box geometry rather than some invented test values.
function cfgFromDefaults(extra = {}) {
  return {
    overlay_paper: 'halfletter_landscape',
    offsetX: DEFAULT_OFFSETS.overlay_offx, offsetY: DEFAULT_OFFSETS.overlay_offy,
    scaleX: DEFAULT_OFFSETS.overlay_scalex, scaleY: DEFAULT_OFFSETS.overlay_scaley,
    rightDX: DEFAULT_OFFSETS.overlay_right_dx, rightDY: DEFAULT_OFFSETS.overlay_right_dy,
    fontPt: DEFAULT_OFFSETS.overlay_font_pt,
    landscape: !!DEFAULT_OFFSETS.overlay_landscape,
    rotate180: !!DEFAULT_OFFSETS.overlay_rotate180,
    engine: DEFAULT_OFFSETS.overlay_engine,
    ...extra
  }
}

// Render HTML → { pdf, png } without printing. Mirrors printOverlay's stage 1
// exactly (same printToPDF options), so what is asserted here is what stage 1
// would hand the spooler.
async function render(html, c, tag) {
  const w = new BrowserWindow({ show: false, width: 1200, height: 800, frame: false, webPreferences: { sandbox: false, backgroundThrottling: false } })
  // Temp file, not a data: URL — same reason as printOverlay (the proof sheet is
  // too big for a data: navigation and Chromium rejects it with ERR_FAILED).
  const htmlFile = path.join(OUT, `overlay-${tag}.html`)
  w.webContents.on('did-fail-load', (_e, code, desc, url, isMain) =>
    console.error(`  load-fail  code=${code} desc=${desc} main=${isMain} url=${String(url).slice(0, 90)}`))
  w.webContents.on('render-process-gone', (_e, d) => console.error('  renderer-gone', JSON.stringify(d)))
  try {
    fs.writeFileSync(htmlFile, html, 'utf8')
    await w.loadFile(htmlFile)
    try { await w.webContents.executeJavaScript('Promise.resolve(window.__ready)', true) } catch {}
    const pdf = await w.webContents.printToPDF({
      printBackground: true,
      preferCSSPageSize: true,
      landscape: c.landscape,
      pageSize: { width: PAPER.w / 25.4, height: PAPER.h / 25.4 },
      margins: { top: 0, bottom: 0, left: 0, right: 0 }
    })
    fs.writeFileSync(path.join(OUT, `overlay-${tag}.pdf`), pdf)
    if (!process.env.OVERLAY_DRYRUN_NO_PNG) {
      // A PNG next to it so the sheet can be eyeballed without a PDF viewer.
      const PX_PER_MM = 4
      await w.webContents.setZoomFactor(PX_PER_MM / (96 / 25.4))
      w.setContentSize(Math.ceil(PAPER.w * PX_PER_MM), Math.ceil(PAPER.h * PX_PER_MM))
      await new Promise((r) => setTimeout(r, 600))
      const img = await w.webContents.capturePage()
      fs.writeFileSync(path.join(OUT, `overlay-${tag}.png`), img.toPNG())
    }
    return { pdf, pageCount: pdfPrint.countPages(pdf) }
  } finally { try { w.destroy() } catch {} }
}

// Read the REAL laid-out geometry of the «بقایا رقم» box and of the three values
// that share its column, in mm. Computing this from the settings would only prove
// the arithmetic; what can actually collide is the painted line box of the value
// above/below, whose height only the browser knows.
async function measureBox(html) {
  const w = new BrowserWindow({ show: false, width: 1200, height: 800, frame: false, webPreferences: { sandbox: false, backgroundThrottling: false } })
  const htmlFile = path.join(OUT, 'overlay-box-measure.html')
  try {
    fs.writeFileSync(htmlFile, html, 'utf8')
    await w.loadFile(htmlFile)
    try { await w.webContents.executeJavaScript('Promise.resolve(window.__ready)', true) } catch {}
    return await w.webContents.executeJavaScript(`(() => {
      const MM = 96 / 25.4
      const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect()
        return { left: r.left / MM, right: r.right / MM, top: r.top / MM, bottom: r.bottom / MM } }
      const byText = (t) => [...document.querySelectorAll('span.f')].find((s) => s.textContent.trim() === t) || null
      const boxes = [...document.querySelectorAll('.bx')]
      return {
        box: box(boxes[0]), boxR: box(boxes[1]),
        rate: box(byText('434,500')),      // ریٹ  — the row ABOVE (y 77.5)
        baqaya: box(byText('4,150,588')),  // بقایا — the boxed value itself (y 84)
        point: box(byText('10.599'))       // سونا دینا ہے — the row BELOW (y 90)
      }
    })()`)
  } catch { return null } finally { try { w.destroy() } catch {} }
}

// Where each value ends up on the physical sheet, in mm, AFTER the global
// offset+scale — the same arithmetic the CSS transform performs.
function placed(coords, c) {
  const out = []
  const vals = overlayForm.sampleFieldValues()
  for (const key of Object.keys(coords)) {
    const co = coords[key]
    const text = vals[key]
    if (!co || text == null || String(text) === '' || String(text) === '-') continue
    for (const [side, dx, dy] of [['L', 0, 0], ['R', c.rightDX, c.rightDY]]) {
      const x = (Number(co.x) + dx) * c.scaleX + c.offsetX
      const y = (Number(co.y) + dy) * c.scaleY + c.offsetY
      out.push({ key, side, x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100, text: String(text) })
    }
  }
  return out
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const cfg = cfgFromDefaults()
  const c = overlayForm.normalizeCfg(cfg)

  console.log('\n=== OVERLAY DRY RUN ===')
  console.log(`sheet ${PAPER.w} x ${PAPER.h} mm   engine=${c.engine}  landscape=${c.landscape}  rotate180=${c.rotate180}`)
  console.log(`offset ${c.offsetX},${c.offsetY}   scale ${c.scaleX},${c.scaleY}   rightDX ${c.rightDX}   fontPt ${c.fontPt}\n`)

  // 1. the real slip
  const slipHtml = overlayForm.buildOverlayHtml(overlayForm.buildSampleData(), cfg)
  const slip = await render(slipHtml, c, 'slip')
  console.log('slip:')
  slip.pageCount === 1 ? pass('pageCount === 1') : fail(`pageCount is ${slip.pageCount} (a 2nd page wastes a pre-printed slip on every print)`)

  // 2. the proof sheet
  const proof = await render(overlayForm.buildProofHtml(cfg), c, 'proof')
  console.log('proof sheet:')
  proof.pageCount === 1 ? pass('pageCount === 1') : fail(`pageCount is ${proof.pageCount}`)

  // 3. geometry of every placed value
  const coords = { ...DEFAULT_COORDS, ...c.coords }
  const rows = placed(coords, c)
  // A value is anchored at its bottom-CENTRE, so a little slack each way covers
  // half the text width; the assertion is about gross mis-placement, not kerning.
  const PAD = 25
  const outside = rows.filter((r) => r.x < -PAD || r.x > PAPER.w + PAD || r.y < 0 || r.y > PAPER.h)
  console.log('geometry:')
  outside.length === 0 ? pass(`all ${rows.length} values inside the ${PAPER.w}x${PAPER.h} sheet`)
    : fail(`${outside.length} value(s) outside the sheet: ` + outside.map((r) => `${r.key}/${r.side}(${r.x},${r.y})`).join(', '))

  // LEFT values must stay in the left half, RIGHT values in the right half —
  // rightDX drift is the classic way the shop copy lands on the customer copy.
  const mid = PAPER.w / 2
  const strayL = rows.filter((r) => r.side === 'L' && r.x > mid)
  const strayR = rows.filter((r) => r.side === 'R' && r.x < mid)
  ;(strayL.length + strayR.length) === 0 ? pass('no LEFT value crosses into the RIGHT slip (and vice versa)')
    : fail(`${strayL.length} left + ${strayR.length} right value(s) on the wrong half`)

  // 4. the table the operator/dev actually reads
  console.log('\nfield              side      x(mm)   y(mm)   value')
  console.log('-'.repeat(64))
  for (const r of rows.filter((x) => x.side === 'L')) {
    console.log(r.key.padEnd(18) + r.side.padEnd(9) + String(r.x).padStart(6) + String(r.y).padStart(8) + '   ' + r.text)
  }

  // 5. «بقایا رقم» outline box — off by default, so first prove OFF is a no-op,
  //    then measure where ON actually puts it. The box is square-cornered and its
  //    neighbours are close (rate y=77.5 above, point y=90 below), so the numbers
  //    that matter are its top and bottom edges against those two values.
  console.log('\nباقیہ box:')
  const boxOffHtml = overlayForm.buildOverlayHtml(overlayForm.buildSampleData(), cfgFromDefaults())
  !boxOffHtml.includes('bx') ? pass('box OFF (default): the sheet carries no box element and no box CSS — nothing to render')
    : fail('box OFF still emitted box markup/CSS — the default sheet is not unchanged')

  const boxCfg = cfgFromDefaults({ boxOn: true })
  const bc = overlayForm.normalizeCfg(boxCfg)
  const boxHtml = overlayForm.buildOverlayHtml(overlayForm.buildSampleData(), boxCfg)
  const boxCount = (boxHtml.match(/class="bx"/g) || []).length
  boxCount === 2 ? pass('box ON: drawn on BOTH slips (left + right)')
    : fail(`box ON produced ${boxCount} rectangle(s), expected 2 (left + right)`)

  // An empty بقایا must not get an empty frame — the same rule every value obeys.
  // fieldValues() reads it out of the lab table's «بقایا رقم» label/value pair, so
  // blanking that pair is what an empty cell really looks like to the renderer.
  const emptyData = JSON.parse(JSON.stringify(overlayForm.buildSampleData()))
  // A table is an array of rows; a row is an array of {l:label} / {v:value} cells,
  // and labVals pairs each label with the cell that follows it.
  for (const table of (emptyData.tables || [])) {
    for (const row of (table || [])) {
      for (let i = 0; i < (row || []).length - 1; i++) {
        if (row[i] && row[i].l === 'بقایا رقم' && row[i + 1] && row[i + 1].v !== undefined) row[i + 1].v = ''
      }
    }
  }
  const emptyVals = overlayForm.fieldValues(emptyData)
  if (emptyVals.baqaya == null || String(emptyVals.baqaya) === '' || String(emptyVals.baqaya) === '-') {
    const emptyHtml = overlayForm.buildOverlayHtml(emptyData, boxCfg)
    !emptyHtml.includes('class="bx"') ? pass('box ON but بقایا empty: no rectangle drawn')
      : fail('an EMPTY بقایا cell still got a rectangle around it')
  } else {
    fail(`could not blank بقایا in the sample (still "${emptyVals.baqaya}") — the empty-cell rule is UNVERIFIED`)
  }

  // Where it actually LANDS. Not arithmetic on the settings — the real laid-out
  // rectangles read back out of the rendered page, because the thing that can
  // collide is the painted line box of the neighbouring value, and only the
  // browser knows how tall that is at this font size.
  const m = await measureBox(boxHtml)
  if (!m || !m.box) {
    fail('could not measure the rendered box')
  } else {
    console.log(`  box    centre ${bc.boxX},${bc.boxY} mm   size ${bc.boxW}x${bc.boxH} mm   line ${bc.boxPt} mm`)
    console.log(`  left   x ${round2(m.box.left)} → ${round2(m.box.right)} mm     y ${round2(m.box.top)} → ${round2(m.box.bottom)} mm`)
    console.log(`  right  x ${round2(m.boxR.left)} → ${round2(m.boxR.right)} mm   y ${round2(m.boxR.top)} → ${round2(m.boxR.bottom)} mm`)
    for (const [name, r] of [['ریٹ (y 77.5)', m.rate], ['بقایا (y 84)', m.baqaya], ['سونا دینا ہے (y 90)', m.point]]) {
      if (r) console.log(`  value  ${name.padEnd(22)} y ${round2(r.top)} → ${round2(r.bottom)} mm`)
    }
    const gapTop = m.rate ? m.box.top - m.rate.bottom : null
    const gapBot = m.point ? m.point.top - m.box.bottom : null
    console.log(`  gap    above (box top − ریٹ bottom)          ${round2(gapTop)} mm`)
    console.log(`  gap    below (سونا دینا ہے top − box bottom)  ${round2(gapBot)} mm`)
    ;(gapTop == null || gapTop > 0)
      ? pass(`top edge clears the «ریٹ» value by ${round2(gapTop)} mm`)
      : fail(`top edge overlaps the «ریٹ» value by ${round2(-gapTop)} mm`)
    ;(gapBot == null || gapBot > 0)
      ? pass(`bottom edge clears the «سونا دینا ہے» value by ${round2(gapBot)} mm`)
      : fail(`bottom edge overlaps the «سونا دینا ہے» value by ${round2(-gapBot)} mm`)
  }

  const boxRender = await render(boxHtml, bc, 'box')
  boxRender.pageCount === 1 ? pass('box ON still renders exactly one page')
    : fail(`box ON produced ${boxRender.pageCount} pages`)

  console.log(`\nartifacts -> ${OUT}`)
  console.log('  overlay-slip.pdf / .png     overlay-proof.pdf / .png     overlay-box.pdf / .png')
  console.log('\n*** DRY-RUN ONLY: this does not exercise the Windows driver. Run the proof')
  console.log('*** sheet (پروف شیٹ) on the target Canon before shipping.\n')
  if (!pdfPrint.available()) {
    console.log('NOTE: no PDF spooler binary found (vendor/pdfprint/SumatraPDF.exe).')
    console.log('      A real print would FALL BACK to the Windows driver path.\n')
  }
  app.exit(failures ? 1 : 0)
}

app.whenReady().then(main).catch((e) => { console.error(e); app.exit(1) })
