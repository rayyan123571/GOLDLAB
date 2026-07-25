// ─── Thermal لیب رسید — proof that the NEW ROW is the ONLY change ────────────
//
// The «بقایا سونا» row was added to the لیب رسید template. That legitimately moves
// the thermal:regression baseline — but "the baseline moved" must never be taken on
// trust. This renders the worst-case لیب رسید through the REAL rasterPrint pipeline
// three ways and compares them:
//
//   WITHOUT  — the current template with the «بقایا سونا» row filtered back out.
//              This IS the old template, reconstructed from the live code.
//   WITH     — the current template as it now ships.
//
//   A. WITHOUT @1.15 must be BYTE-IDENTICAL to the committed old baseline.
//      That is the whole proof: if removing one row reproduces the previous
//      baseline exactly, then that row is provably the only thing that changed.
//   B. LAYOUT geometry, measured in the DOM at the pipeline's own 576px width:
//      every <tr>'s height and every cell's x/width, with and without the row.
//      This is what "no other row moved / no column moved / same slip width"
//      actually means, and unlike a pixel diff of the tail it is exact. (A strict
//      byte-shift comparison is impossible BY CONSTRUCTION: the renderer draws at
//      1.25 device px per CSS px, so inserting a row whose height is a fractional
//      number of CSS px re-phases every glyph below it by a sub-pixel — the text
//      is the same text, rasterized one pixel over.)
//   C. WITH vs WITHOUT at the shipped printScale 1.15: the row bands match
//      one-for-one with exactly ONE inserted, within the ±1 dot that the vertical
//      scaleY(1.15) rounding costs every row below an insertion.
//   D. paper width, printed ink extent, table-3 column rules, and the نام row's
//      height (the longest Urdu name, wrap enabled — where a width change would
//      show up as a second line).
//
// Run: npm run thermal:rowproof
const fs = require('fs')
const os = require('os')
const path = require('path')
const { app, BrowserWindow, nativeImage } = require('electron')

const ROOT = path.join(__dirname, '..')
const ART = path.join(ROOT, 'artifacts')
const OLD_BASELINE = path.join(ART, 'thermal-worstcase-before.png')
const NEW_ROW_LABEL = 'بقایا سونا'

const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'goldlab-rowproof-'))
process.env.GOLDLAB_PRINT_PDF_DIR = OUT
const raster = require(path.join(ROOT, 'electron', 'rasterPrint.cjs'))

app.on('window-all-closed', () => {})

let failures = 0
const fail = (m) => { failures++; console.error('  FAIL  ' + m) }
const pass = (m) => console.log('  ok    ' + m)

// The SAME worst-case data with the new row removed = the previous template.
function withoutNewRow(d) {
  return {
    ...d,
    tables: (d.tables || []).map((t) => t.filter((r) => !(r && r[0] && r[0].l === NEW_ROW_LABEL)))
  }
}

// Render one dataset through the real pipeline; returns the dry-run PNG path.
async function render(data, win, printScale, tag) {
  for (const f of fs.readdirSync(OUT)) fs.unlinkSync(path.join(OUT, f))
  const res = await raster.printHtml({
    html: raster.buildReceiptHtml(data), copies: 1, win, tag, requireThermal: false, printScale
  })
  if (!res || !res.ok) throw new Error(`${tag} render failed: ${res && res.reason}`)
  const png = fs.readdirSync(OUT).find((f) => f.endsWith('.png'))
  const dest = path.join(ART, `thermal-worstcase-${tag}.png`)
  fs.copyFileSync(path.join(OUT, png), dest)
  return dest
}

// Measure the rendered table layout: one entry per <tr> with its height and every
// cell's x/width in CSS px, at the SAME 576px width the raster pipeline uses.
// Layout numbers are exact — they carry no rasterization rounding at all.
async function layout(data, win) {
  const w = new BrowserWindow({ show: false, width: 700, height: 700, frame: false, webPreferences: { sandbox: false } })
  try {
    await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(raster.buildReceiptHtml(data)))
    try { await w.webContents.executeJavaScript('Promise.resolve(window.__ready)', true) } catch {}
    return await w.webContents.executeJavaScript(`(function(){
      var r = document.querySelector('[data-measure]').getBoundingClientRect()
      var R = Math.round, out = []
      // Grouped by TABLE — the لیب رسید has three, and two of them are 4-cell wide,
      // so cell count alone would compare the wrong table against the wrong table.
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

// Printed horizontal rules = scanlines that are mostly ink across the slip.
// Borders are 2–3 dots thick, so consecutive hits merge into one rule.
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

// Vertical rules inside a y-band: x columns that are ink for nearly the whole band.
function vRules(im, yTop, yBot) {
  const h = yBot - yTop + 1
  const out = []
  let run = -1
  for (let x = 0; x < im.width; x++) {
    let n = 0
    for (let y = yTop; y <= yBot; y++) n += im.px[y * im.width + x]
    const solid = n > h * 0.85
    if (solid && run < 0) run = x
    if (!solid && run >= 0) { out.push(Math.round((run + x - 1) / 2)); run = -1 }
  }
  if (run >= 0) out.push(Math.round((run + im.width - 1) / 2))
  return out
}

function inkExtent(im) {
  let lo = im.width; let hi = -1
  for (let y = 0; y < im.height; y++) {
    for (let x = 0; x < im.width; x++) {
      if (im.px[y * im.width + x]) { if (x < lo) lo = x; if (x > hi) hi = x }
    }
  }
  return { lo, hi }
}

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
    console.log('\n=== THERMAL لیب رسید — «بقایا سونا» ROW PROOF (dry run, no printer) ===')
    const WITH = raster.WORST_CASE_DATA
    const WITHOUT = withoutNewRow(WITH)
    const rowsWith = WITH.tables.reduce((n, t) => n + t.length, 0)
    const rowsWithout = WITHOUT.tables.reduce((n, t) => n + t.length, 0)
    console.log(`template rows: ${rowsWithout} (before)  ->  ${rowsWith} (after)\n`)
    if (rowsWith - rowsWithout !== 1) { fail('the filter did not remove exactly one row'); app.exit(1); return }

    // ── A. reconstructed OLD template must reproduce the committed baseline ────
    console.log('A. reconstructed old template vs the COMMITTED baseline:')
    const beforeP = await render(WITHOUT, win, 1.15, 'before-rebuilt')
    if (fs.existsSync(OLD_BASELINE)) {
      const a = fs.readFileSync(OLD_BASELINE); const b = fs.readFileSync(beforeP)
      a.equals(b)
        ? pass('removing «بقایا سونا» reproduces the previous baseline BYTE-IDENTICALLY — that row is provably the only change')
        : fail('the row-removed render does NOT match the old baseline — something else changed too')
    } else {
      fail(`missing ${OLD_BASELINE} (copy of the OLD committed baseline) — cannot make this claim`)
    }

    // ── B. DOM layout geometry (exact — no rasterization involved) ────────────
    const layA = await layout(WITHOUT, win)
    const layB = await layout(WITH, win)
    console.log(`\nB. DOM layout at the pipeline's 576px width (${layA.length} rows -> ${layB.length} rows):`)
    const idx = layB.findIndex((r) => r.cells.some((c) => c.text === NEW_ROW_LABEL))
    const layBminus = layB.filter((_, i) => i !== idx)
    console.log(`   new row is <tr> #${idx}, right after "${layB[idx - 1].cells.map((c) => c.text).filter(Boolean)[0]}"`)
    if (layBminus.length !== layA.length) {
      fail(`removing the new row leaves ${layBminus.length} rows, expected ${layA.length}`)
    } else {
      // (i) ROW HEIGHTS — no pre-existing row may grow or shrink (a wrapped line
      //     is the failure this catches).
      const hBad = layA.map((p, i) => [i, p, layBminus[i]]).filter(([, p, q]) => Math.abs(p.h - q.h) > 0.01)
      hBad.length === 0
        ? pass(`all ${layA.length} pre-existing rows keep EXACTLY their old height (no row wrapped or grew)`)
        : hBad.forEach(([i, p, q]) => fail(`row ${i} ("${p.cells[0].text}") height ${p.h} -> ${q.h}`))

      // (ii) COLUMN GEOMETRY, per TABLE. Every pre-existing cell must keep its x
      //      and width — that is what "no column moved" means.
      const TNAME = ['table 1 (رسید نمبر / ریٹ فی گرام)', 'table 2 (weights, 6-col)', 'table 3 (money, 4-col)']
      for (const t of [0, 1, 2]) {
        const ra2 = layA.filter((r) => r.table === t)
        const rb2 = layBminus.filter((r) => r.table === t)
        if (!ra2.length || ra2.length !== rb2.length) { fail(`${TNAME[t]}: row count ${ra2.length} -> ${rb2.length}`); continue }
        const moved = []
        for (let i = 0; i < ra2.length; i++) {
          for (let j = 0; j < ra2[i].cells.length; j++) {
            const p = ra2[i].cells[j]; const q = rb2[i].cells[j]
            if (!q || Math.abs(p.x - q.x) > 0.01 || Math.abs(p.w - q.w) > 0.01) moved.push(`row${i}/col${j} x ${p.x}->${q && q.x} w ${p.w}->${q && q.w}`)
          }
        }
        const wide = ra2.reduce((m, r) => (r.cells.length > m.cells.length ? r : m), ra2[0])
        const wideB = rb2[ra2.indexOf(wide)]
        console.log(`   ${TNAME[t]}`)
        console.log(`      before: ${wide.cells.map((c) => c.w).join(' | ')}`)
        console.log(`      after : ${wideB.cells.map((c) => c.w).join(' | ')}`)
        moved.length === 0
          ? pass(`${TNAME[t]}: every column keeps the same x and width`)
          : fail(`${TNAME[t]}: ${moved.length} cell(s) MOVED — e.g. ${moved[0]}`)
      }
      // (iii) the new row must sit on the SAME grid as its neighbours.
      const nbr = layA.filter((r) => r.table === 2).pop()
      const newRow = layB[idx]
      console.log(`   inserted row: h=${newRow.h}  text [${newRow.cells.map((c) => c.text || '·').join(' | ')}]`)
      newRow.cells.length === nbr.cells.length
        ? pass(`the new row is an ordinary ${nbr.cells.length}-cell row of the same table — no new column system`)
        : fail(`the new row has ${newRow.cells.length} cells, its neighbours have ${nbr.cells.length}`)
    }

    // ── B2. does the money table still FIT the 556px content box? ─────────────
    // The 4-col table is width:100% but its cells are nowrap, so a label wider than
    // any existing one pushes the whole table past the box and the leftmost column
    // starts hanging off the paper. Measured for BOTH the worst-case test data and
    // a REALISTIC filled receipt, because only the worst case has 7-digit amounts.
    console.log('\nB2. money-table fit inside the 556px printable box:')
    const realistic = require(path.join(ROOT, 'electron', 'overlayForm.cjs')).buildSampleData()
    const realWithout = { ...realistic, tables: realistic.tables }
    const realWith = {
      ...realistic,
      tables: realistic.tables.map((t, i) => (i !== 2 ? t : [
        ...t.slice(0, 3),
        [{ l: NEW_ROW_LABEL }, { v: '10.599' }, { l: '' }, { l: '' }],
        ...t.slice(3)
      ]))
    }
    for (const [name, dNo, dYes] of [['worst-case', WITHOUT, WITH], ['realistic', realWithout, realWith]]) {
      const lNo = await layout(dNo, win); const lYes = await layout(dYes, win)
      const span = (rows) => {
        const c = (rows.filter((r) => r.table === 2).pop() || { cells: [] }).cells
        if (!c.length) return null
        const left = Math.min(...c.map((x) => x.x))
        const right = Math.max(...c.map((x) => x.x + x.w))
        return { left: Math.round(left * 100) / 100, right: Math.round(right * 100) / 100, w: Math.round((right - left) * 100) / 100 }
      }
      const s1 = span(lNo); const s2 = span(lYes)
      console.log(`   ${name.padEnd(10)} before  x ${s1.left}..${s1.right}  (${s1.w}px)`)
      console.log(`   ${' '.repeat(10)} after   x ${s2.left}..${s2.right}  (${s2.w}px)`)
      s2.left >= 0
        ? pass(`${name}: the table still starts inside the paper (x ${s2.left} ≥ 0) — nothing hangs off the left edge`)
        : fail(`${name}: the table now starts at x ${s2.left} — ${Math.abs(s2.left)}px hangs OFF the left paper edge (was x ${s1.left})`)
    }

    // ── C. shipped printScale 1.15 — bands, with the stretch's ±1 rounding ────
    const a = load(beforeP)
    const b = load(await render(WITH, win, 1.15, 'after'))
    const ba = bandsOf(hRules(a)); const bb = bandsOf(hRules(b))
    console.log(`\nC. row bands at the shipped printScale 1.15 (${a.height} -> ${b.height} dots):`)
    console.log(`   before (${ba.length}): ${ba.join(',')}`)
    console.log(`   after  (${bb.length}): ${bb.join(',')}`)
    let splice = -1
    for (let i = 0; i < bb.length; i++) {
      const cand = bb.slice(0, i).concat(bb.slice(i + 1))
      // ±1 tolerance: scaleY(1.15) re-rounds every boundary below an insertion.
      if (cand.length === ba.length && cand.every((v, j) => Math.abs(v - ba[j]) <= 1)) { splice = i; break }
    }
    if (splice >= 0) {
      const drift = bb.slice(0, splice).concat(bb.slice(splice + 1)).map((v, j) => v - ba[j])
      const moved = drift.filter((v) => v !== 0).length
      pass(`exactly ONE band inserted (index ${splice}, ${bb[splice]} dots tall)`)
      pass(`the other ${ba.length} bands are unchanged to within ±1 dot (${moved} differ by 1 — vertical-stretch rounding, see B for the exact-shift proof at scale 1)`)
    } else {
      fail('bands differ by more than a single insertion — another row changed height')
    }

    // ── D. width, columns, نام row ────────────────────────────────────────────
    console.log('\nD. geometry:')
    a.width === 576 && b.width === 576
      ? pass('both renders are exactly 576 dots wide (72.1mm @ 203dpi)')
      : fail(`width changed: ${a.width} -> ${b.width}`)
    const ea = inkExtent(a); const eb = inkExtent(b)
    ea.lo === eb.lo && ea.hi === eb.hi
      ? pass(`printed content spans the same columns (x ${ea.lo}..${ea.hi}) — slip no narrower/wider`)
      : fail(`ink extent moved: ${ea.lo}..${ea.hi} -> ${eb.lo}..${eb.hi}`)

    // table-3 column rules, measured across the «بقایا رقم»/«بقایا سونا» area.
    const ra = hRules(a); const rb = hRules(b)
    const t3a = vRules(a, ra[ra.length - 6].y1 + 2, ra[ra.length - 5].y0 - 2)
    const t3b = vRules(b, rb[rb.length - 6].y1 + 2, rb[rb.length - 5].y0 - 2)
    console.log(`   table-3 column rules  before: ${t3a.join(', ')}   after: ${t3b.join(', ')}`)
    t3a.length === t3b.length && t3a.every((v, i) => Math.abs(v - t3b[i]) <= 1)
      ? pass('column rules sit at the same x positions — no column moved')
      : fail('table-3 columns moved')

    // نام row — counted from the END so the inserted row above cannot shift the index.
    console.log(`   نام row band          before: ${ba[ba.length - 2]} dots   after: ${bb[bb.length - 2]} dots`)
    Math.abs(ba[ba.length - 2] - bb[bb.length - 2]) <= 1
      ? pass('نام row is the same height — «محمد عبدالرحمٰن چوہدری اینڈ سنز» still fits on ONE line')
      : fail(`نام row height changed ${ba[ba.length - 2]} -> ${bb[bb.length - 2]} (it wrapped)`)

    const insBand = splice >= 0
      ? { from: rb[splice].y1 + 1, to: rb[splice + 1].y0 - 1 }
      : { from: 0, to: -1 }
    fs.writeFileSync(path.join(ART, 'thermal-worstcase-sidebyside.png'), sideBySide(a, b, insBand))
    console.log('\nartifacts (shipped printScale 1.15):')
    console.log('  thermal-worstcase-before.png          committed OLD baseline')
    console.log('  thermal-worstcase-before-rebuilt.png  old template rebuilt from live code (matches it byte-for-byte)')
    console.log('  thermal-worstcase-after.png           with «بقایا سونا»')
    console.log('  thermal-worstcase-sidebyside.png      both, inserted band marked in the gutter')
    console.log(failures ? `\n${failures} FAILURE(S)\n` : '\nthe «بقایا سونا» row is the ONLY change\n')
    app.exit(failures ? 1 : 0)
  } catch (e) {
    console.error(e); app.exit(1)
  } finally {
    try { win.destroy() } catch {}
    try { fs.rmSync(OUT, { recursive: true, force: true }) } catch {}
  }
})
