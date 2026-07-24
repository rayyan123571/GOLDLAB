// ─── Overlay printing for PRE-PRINTED colour slips (values-only) ─────────────
// A THIRD print path (print_mode = 'overlay_form'), for the LAB رسید ONLY. This
// customer already has professionally pre-printed colour slips (header, labels,
// borders, terms all on the paper). The printer only drops the VALUES into the
// blank cells — so this renderer draws NOTHING but absolutely-positioned value
// spans on a blank white page, printed through the Windows/Canon driver (never
// ESC/POS). Everything else on the sheet is pre-printed.
//
// Sheet: 8.5in × 5.5in LANDSCAPE (215.9×139.7mm), 2-up — LEFT = customer copy,
// RIGHT = shop copy, BOTH get the SAME values. The right copy = left copy shifted
// by cfg.rightDX (default 108mm) / cfg.rightDY (default 0).
//
// Values come from the SAME slipData the thermal lab receipt renders (data.tables)
// — never recomputed. Coordinates start from imtiaz_overlay_coordinates.md and are
// then fine-tuned by the shop with the in-app calibration tool (drag against their
// own blank-form scan + a couple of test prints); the tuned map persists in
// settings.overlay_coords. The thermal path (rasterPrint.cjs) is NOT touched.
const { BrowserWindow, screen, clipboard, nativeImage } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')
const { DEFAULT_COORDS, FIELD_LABELS } = require('./overlayDefaults.cjs')
const pdfPrint = require('./pdfPrint.cjs')

// A realistic filled lab رسید (same slipData shape Receipts.jsx builds), for the
// calibration chips + overlay test print. Self-contained here so nothing depends on
// the removed colour-form module.
function buildSampleData() {
  const L = (l, o) => Object.assign({ l }, o || {})
  const V = (v, o) => Object.assign({ v }, o || {})
  return {
    title: 'لیب رسید',
    showFee: true,
    selectiveBold: true,
    tables: [
      [[L('رسید نمبر'), V('157'), L('ریٹ فی گرام'), V('37,244')]],
      [
        [L(''), L('رتی'), L('ماشہ'), L('تولہ'), L('ملی گرام'), L('گرام')],
        [L('آمد وزن'), V('0.00'), V('0'), V('1'), V('6640'), V('11')],
        [L('ملاوٹ وزن'), V('1.07'), V('1'), V('0'), V('0375'), V('1')],
        [L('خالص وزن'), V('6.93'), V('11'), V('0'), V('6265'), V('10')],
        [L('ملاوٹ فی تولہ'), V('0.85'), V('1'), V('0'), V('فی گرام'), V('0.0889')]
      ],
      [
        [L('کیرٹ'), V('21.16'), L('ریٹ فی تولہ'), V('434,500')],
        [L('ٹوٹل رقم'), V('4,151,688'), L('چارجز'), V('1,100')],
        [L('بقایا رقم'), V('4,150,588', { box: true }), L('پوائنٹ'), V('0.9111')],
        [L('نام'), V('محمد عبدالرحمٰن چوہدری', { wrap: true }), L('رتی'), V('11.35 رتی', { u: true })],
        [L('تاریخ'), V('18-07-26'), L('وقت'), V('12:58 PM')]
      ]
    ]
  }
}

// Same Nastaliq stack the slip uses — Urdu values (نام) render in it; numbers stay
// in a plain sans.
const FONT_STACK = "'Noto Nastaliq Urdu','Jameel Noori Nastaleeq','Segoe UI',Tahoma,sans-serif"

// Only sheet the pre-printed form uses (for now). Landscape half-letter.
const PAPERS = { halfletter_landscape: { w: 215.9, h: 139.7 } }

// The per-field coordinate map (LEFT slip, mm) + Urdu labels now live in the shared
// electron/overlayDefaults.cjs (the shop's CALIBRATED map, so a fresh install is
// pre-aligned). The tuned settings.overlay_coords still overrides per field.
const escHtml = (v) => String(v == null ? '' : v)
  .replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]))
const isUrdu = (v) => /[؀-ۿ]/.test(String(v == null ? '' : v))
const isNum4 = (v) => /^\d{1,4}$/.test(String(v == null ? '' : v).trim())

// ── Extract the lab values from data.tables (the SAME slipData the thermal lab
// receipt uses) — by LABEL, so it survives minor row re-ordering. Never recomputes.
function labVals(tables) {
  const rows = [].concat(...(tables || []))
  // label→value from adjacent {l},{v} pairs (rate row + money block).
  const kv = {}
  for (const row of rows) {
    for (let i = 0; i < (row || []).length - 1; i++) {
      const c = row[i]; const nxt = row[i + 1]
      if (c && c.l !== undefined && nxt && nxt.v !== undefined && kv[c.l] === undefined) kv[c.l] = nxt.v
    }
  }
  // A weight row is [label, رتی, ماشہ, تولہ, ملی گرام, گرام] (see LabReceipt.wRow).
  const wrow = (label) => {
    const r = rows.find((x) => x && x[0] && x[0].l === label)
    if (!r) return {}
    return { ratti: r[1] && r[1].v, masha: r[2] && r[2].v, tola: r[3] && r[3].v, mg: r[4] && r[4].v, gram: r[5] && r[5].v }
  }
  return { kv, aamad: wrow('آمد وزن'), milawat: wrow('ملاوٹ وزن'), khalis: wrow('خالص وزن'), mpt: wrow('ملاوٹ فی تولہ') }
}

// The single decimal the pre-printed decimal column expects, e.g. gram 11 + mg
// "6640" → "11.6640". When the mg cell is not a 4-digit number (the ملاوٹ فی تولہ
// row carries "فی گرام" there and the per-gram value in the gram cell), the gram
// cell already IS the decimal, so it is used as-is.
const decOf = (w) => {
  if (!w || w.gram == null || w.gram === '') return ''
  return isNum4(w.mg) ? `${w.gram}.${w.mg}` : String(w.gram)
}

// field key → printed string, from the extracted lab values.
function fieldValues(tables) {
  const v = labVals(tables)
  const k = v.kv
  return {
    aamad_dec: decOf(v.aamad), aamad_tola: v.aamad.tola, aamad_masha: v.aamad.masha, aamad_ratti: v.aamad.ratti,
    milawat_dec: decOf(v.milawat), milawat_tola: v.milawat.tola, milawat_masha: v.milawat.masha, milawat_ratti: v.milawat.ratti,
    khalis_dec: decOf(v.khalis), khalis_tola: v.khalis.tola, khalis_masha: v.khalis.masha, khalis_ratti: v.khalis.ratti,
    mpt_dec: decOf(v.mpt), mpt_tola: v.mpt.tola, mpt_masha: v.mpt.masha, mpt_ratti: v.mpt.ratti,
    rate: k['ریٹ فی تولہ'], keerat: k['کیرٹ'],
    baqaya: k['بقایا رقم'], charges: k['چارجز'], total: k['ٹوٹل رقم'],
    point: k['پوائنٹ'], time: k['وقت'], date: k['تاریخ'], naam: k['نام']
  }
}

// A realistic filled sample (the settings calibration tool + test print) — reuses
// the colour form's lab sample, whose table shape IS the real lab slipData.
function sampleFieldValues() {
  return fieldValues(buildSampleData().tables)
}

// ── Settings → normalized config ─────────────────────────────────────────────
function normalizeCfg(cfg) {
  const c = cfg || {}
  const num = (v, d) => (v != null && Number.isFinite(Number(v)) ? Number(v) : d)
  const paper = PAPERS[c.overlay_paper] || PAPERS.halfletter_landscape
  let coords = {}
  if (c.coords) { try { coords = typeof c.coords === 'string' ? JSON.parse(c.coords) : c.coords } catch { coords = {} } }
  if (!coords || typeof coords !== 'object') coords = {}
  return {
    paperW: paper.w,
    paperH: paper.h,
    offsetX: num(c.offsetX, 0),
    offsetY: num(c.offsetY, 0),
    scaleX: num(c.scaleX, 1) || 1,
    scaleY: num(c.scaleY, 1) || 1,
    rightDX: num(c.rightDX, 108),
    rightDY: num(c.rightDY, 0),
    fontPt: num(c.fontPt, 11) || 11,
    coords,
    bg: c.bg || '',
    deviceName: c.deviceName || '',
    // ── Geometry/engine controls (settings columns overlay_landscape /
    // overlay_rotate180 / overlay_engine). The sheet is already described as a
    // WIDE custom page (215.9 × 139.7), so landscape stays FALSE by default —
    // asking the driver to rotate on top of that is what produced the sideways
    // print. rotate180 is the escape hatch for a sheet fed the other way round.
    landscape: !!c.landscape,
    rotate180: !!c.rotate180,
    // 'pdf' = render an exact-size PDF and spool it with scaling disabled
    // (deterministic). 'driver' = hand the page to webContents.print and hope the
    // driver behaves; kept only as a fallback / escape hatch.
    engine: c.engine === 'driver' ? 'driver' : 'pdf'
  }
}

// ── Build the values-only overlay page ───────────────────────────────────────
// opts.withBg embeds the uploaded blank-form scan as a full-sheet background —
// used ONLY for the on-screen preview / WhatsApp composite so the picture looks
// like the finished slip. The ACTUAL PRINT never embeds it (the paper is already
// pre-printed), so withBg is false there.
function buildOverlayHtml(data, cfg, opts = {}) {
  const c = normalizeCfg(cfg)
  const withBg = !!opts.withBg && !!c.bg
  const vals = fieldValues((data && data.tables) || [])
  const coords = { ...DEFAULT_COORDS, ...c.coords }

  const spanFor = (key, dx, dy) => {
    const co = coords[key]
    if (!co) return ''
    const text = vals[key]
    if (text == null || String(text) === '' || String(text) === '-') return ''
    const x = Number(co.x) + dx
    const y = Number(co.y) + dy
    const u = isUrdu(text) ? ' u' : ''
    return `<span class="f${u}" style="left:${x}mm;top:${y}mm">${escHtml(text)}</span>`
  }

  let cells = ''
  for (const key of Object.keys(coords)) {
    cells += spanFor(key, 0, 0)               // LEFT (customer) slip
    cells += spanFor(key, c.rightDX, c.rightDY) // RIGHT (shop) slip — same values
  }

  const css =
    '*{box-sizing:border-box;margin:0;padding:0}' +
    // html/body clamped to the sheet with overflow hidden: a single stray pixel of
    // content past the page box makes Chromium emit a SECOND page, and every such
    // page eats another expensive pre-printed slip. .sheet is 0.2mm shorter than
    // the paper for the same reason (rounding at the bottom edge must not spill).
    `html,body{margin:0;padding:0;background:#fff;width:${c.paperW}mm;height:${c.paperH}mm;overflow:hidden}` +
    `@page{size:${c.paperW}mm ${c.paperH}mm;margin:0}` +
    '*{-webkit-print-color-adjust:exact;print-color-adjust:exact}' +
    // rotate180 turns the FINISHED sheet about its own centre — the escape hatch
    // for a slip fed into the tray the other way round. It sits on .sheet, not on
    // .cal, so the calibration transform below keeps its 0 0 origin and every
    // existing offx/offy/scalex/scaley value keeps meaning exactly what it did.
    `.sheet{position:relative;width:${c.paperW}mm;height:calc(${c.paperH}mm - 0.2mm);overflow:hidden;background:#fff` +
      (c.rotate180 ? ';transform:rotate(180deg);transform-origin:center center' : '') +
      (withBg ? `;background-image:url('${c.bg}');background-size:100% 100%;background-repeat:no-repeat` : '') + '}' +
    // Global nudge (offset) + stretch (scale) of the WHOLE overlay, applied on top
    // of the per-field coordinates so a single control shifts every value together.
    `.cal{position:absolute;inset:0;transform:translate(${c.offsetX}mm,${c.offsetY}mm) scale(${c.scaleX},${c.scaleY});transform-origin:0 0}` +
    // Each value is anchored at (x,y) = its bottom-centre (≈ baseline-centre), so
    // calibration drags a value's centre onto the pre-printed cell.
    // Weight 700 + a uniform text stroke — the same trick rasterPrint.cjs's STROKE
    // uses to survive a printer's own thinning. The client's reference print is
    // noticeably heavier than plain bold; on a 600dpi mono laser 0.3px of stroke
    // is what closes that gap without smearing the digits together.
    `.f{position:absolute;font:700 ${c.fontPt}pt Arial;color:#000;white-space:nowrap;transform:translate(-50%,-100%);-webkit-text-stroke:0.3px #000}` +
    `.f.u{font-family:${FONT_STACK};font-weight:700;-webkit-text-stroke:0.3px #000}`

  return '<!doctype html><html><head><meta charset="utf-8"><style>' + css + '</style></head><body>' +
    `<div class="sheet"><div class="cal">${cells}</div></div>` +
    '<script>window.__ready=(async()=>{try{if(document.fonts&&document.fonts.ready){await document.fonts.ready}}catch(e){}' +
    'await new Promise(r=>setTimeout(r,80));return true})()</scr' + 'ipt>' +
    '</body></html>'
}

// ── PROOF SHEET (پروف شیٹ) — printed on PLAIN paper ─────────────────────────
// Pre-printed slips cost money, so the shop must never burn one to find out what
// the driver did. This sheet goes through the EXACT same pipeline as a real slip
// (same page size, same engine, same transforms), and carries its own ruler:
//
//   • a 10mm grid over the whole 215.9×139.7 sheet, labelled in mm on both axes
//   • registration crosshairs at the four inset corners (10,10) … (205.9,129.7)
//   • a 100mm horizontal and a 100mm vertical measuring bar
//   • the real sample values at their real coordinates
//   • a footer stating the exact settings that produced this sheet
//
// Measure the two 100mm bars with a ruler: if they are not 100mm, the driver
// scaled the page (and the ratio is the scale to enter). If the bars swapped
// orientation, it rotated it. Neither can be seen from an on-screen preview.
function buildProofHtml(cfg, opts = {}) {
  const c = normalizeCfg(cfg)
  const W = c.paperW
  const H = c.paperH
  const vals = sampleFieldValues()
  const coords = { ...DEFAULT_COORDS, ...c.coords }

  let grid = ''
  for (let x = 0; x <= Math.floor(W); x += 10) {
    grid += `<div class="v" style="left:${x}mm"></div><div class="lx" style="left:${x}mm">${x}</div>`
  }
  for (let y = 0; y <= Math.floor(H); y += 10) {
    grid += `<div class="h" style="top:${y}mm"></div><div class="ly" style="top:${y}mm">${y}</div>`
  }

  // Crosshairs: the TOP-LEFT one at (10,10) is the calibration reference the
  // operator measures from the sheet's physical edges.
  const cross = (x, y, label) =>
    `<div class="x" style="left:${x}mm;top:${y}mm"></div>` +
    `<div class="xl" style="left:${x}mm;top:${y + 4}mm">${label}</div>`
  const crosses =
    cross(10, 10, '10,10') + cross(W - 10, 10, `${round1(W - 10)},10`) +
    cross(10, H - 10, `10,${round1(H - 10)}`) + cross(W - 10, H - 10, `${round1(W - 10)},${round1(H - 10)}`)

  // The two rulers the operator physically measures. Both live in the RIGHT half:
  // the proof draws only the LEFT slip's values (they stop around x≈100mm), so the
  // bars stay clear of them and of the four crosshairs — a ruler laid across
  // printed digits is hard to read, and this sheet exists to be measured.
  const bars =
    `<div class="bar hbar" style="left:110mm;top:28mm"></div>` +
    '<div class="barlbl" style="left:160mm;top:26mm">افقی 100 mm</div>' +
    `<div class="bar vbar" style="left:130mm;top:35mm"></div>` +
    '<div class="barlbl rot" style="left:135mm;top:85mm">عمودی 100 mm</div>'

  // Real values at real coordinates (LEFT slip only — the right copy is the same
  // map shifted, and printing both would clutter the grid).
  let cells = ''
  for (const key of Object.keys(coords)) {
    const co = coords[key]
    const text = vals[key]
    if (!co || text == null || String(text) === '' || String(text) === '-') continue
    const u = isUrdu(text) ? ' u' : ''
    cells += `<span class="f${u}" style="left:${Number(co.x)}mm;top:${Number(co.y)}mm">${escHtml(text)}</span>`
  }

  // engineUsed (optional) is the engine that ACTUALLY prints this proof, resolved
  // by the caller's preflight — so the photographed footer shows 'pdf' or
  // 'driver' truthfully, not just the configured preference. Falls back to the
  // configured engine when the caller doesn't pass one.
  const engineShown = opts.engineUsed || c.engine
  const foot = [
    `engine=${engineShown}`, `printer=${c.deviceName || '(default)'}`,
    `paper=${W}x${H}mm`, `landscape=${c.landscape ? 1 : 0}`, `rotate180=${c.rotate180 ? 1 : 0}`,
    'scaleFactor=100', `offX=${c.offsetX} offY=${c.offsetY}`,
    `scaleX=${c.scaleX} scaleY=${c.scaleY}`, `fontPt=${c.fontPt}`
  ].join('  |  ')

  const css =
    '*{box-sizing:border-box;margin:0;padding:0}' +
    `html,body{margin:0;padding:0;background:#fff;width:${W}mm;height:${H}mm;overflow:hidden}` +
    `@page{size:${W}mm ${H}mm;margin:0}` +
    '*{-webkit-print-color-adjust:exact;print-color-adjust:exact}' +
    `.sheet{position:relative;width:${W}mm;height:calc(${H}mm - 0.2mm);overflow:hidden;background:#fff` +
      (c.rotate180 ? ';transform:rotate(180deg);transform-origin:center center' : '') + '}' +
    `.cal{position:absolute;inset:0;transform:translate(${c.offsetX}mm,${c.offsetY}mm) scale(${c.scaleX},${c.scaleY});transform-origin:0 0}` +
    // Hairlines: 0.1mm keeps the grid readable without eating toner.
    `.v{position:absolute;top:0;height:${H}mm;width:0.1mm;background:#999}` +
    `.h{position:absolute;left:0;width:${W}mm;height:0.1mm;background:#999}` +
    // 5pt: the smallest that stays legible from a 600dpi laser on plain paper.
    '.lx{position:absolute;top:0.5mm;font:400 5pt Arial;color:#444;transform:translateX(1px)}' +
    '.ly{position:absolute;left:0.5mm;font:400 5pt Arial;color:#444;transform:translateY(1px)}' +
    // Crosshair = 6mm cross drawn with two hairlines, centred on the point.
    '.x{position:absolute;width:6mm;height:6mm;margin-left:-3mm;margin-top:-3mm;' +
      'background:linear-gradient(#000,#000) center/100% 0.2mm no-repeat,linear-gradient(#000,#000) center/0.2mm 100% no-repeat}' +
    '.xl{position:absolute;font:700 5pt Arial;color:#000;transform:translate(-50%,0)}' +
    '.bar{position:absolute;background:#000}' +
    '.hbar{width:100mm;height:0.6mm}' +
    '.vbar{width:0.6mm;height:100mm}' +
    `.barlbl{position:absolute;font:700 7pt ${FONT_STACK};color:#000;transform:translate(-50%,-100%)}` +
    '.barlbl.rot{transform:translate(-50%,-50%) rotate(-90deg)}' +
    `.f{position:absolute;font:700 ${c.fontPt}pt Arial;color:#000;white-space:nowrap;transform:translate(-50%,-100%);-webkit-text-stroke:0.3px #000}` +
    `.f.u{font-family:${FONT_STACK};font-weight:700;-webkit-text-stroke:0.3px #000}` +
    `.foot{position:absolute;left:3mm;top:${H - 4}mm;font:400 6pt Arial;color:#000;white-space:nowrap}`

  return '<!doctype html><html><head><meta charset="utf-8"><style>' + css + '</style></head><body>' +
    `<div class="sheet"><div class="cal">${grid}${crosses}${bars}${cells}` +
    `<div class="foot">${escHtml(foot)}</div></div></div>` +
    '<script>window.__ready=(async()=>{try{if(document.fonts&&document.fonts.ready){await document.fonts.ready}}catch(e){}' +
    'await new Promise(r=>setTimeout(r,80));return true})()</scr' + 'ipt>' +
    '</body></html>'
}

const round1 = (n) => Math.round(Number(n) * 10) / 10

// ── Is this printer actually installed? ──────────────────────────────────────
// An unset/renamed/removed Canon used to mean webContents.print quietly used the
// WINDOWS DEFAULT printer instead — i.e. a values-only overlay sprayed onto
// whatever paper happened to be in the office laser, with no error shown. The
// overlay path must fail loudly instead. Returns { ok, name } | { ok:false, reason }.
// A printer list that cannot be read at all is treated as "cannot verify" and the
// configured name is allowed through: refusing to print because an enumeration
// call failed would be worse than trying.
async function validateDevice(webContents, name) {
  const want = String(name || '').trim()
  if (!want) return { ok: false, reason: 'canon-printer-not-set' }
  try {
    const list = await webContents.getPrintersAsync()
    if (!Array.isArray(list) || !list.length) return { ok: false, reason: 'no-printers-installed' }
    const hit = list.find((p) => p.name === want) ||
      list.find((p) => String(p.name).toLowerCase() === want.toLowerCase()) ||
      list.find((p) => String(p.displayName || '').toLowerCase() === want.toLowerCase())
    if (!hit) return { ok: false, reason: 'canon-printer-missing' }
    return { ok: true, name: hit.name }
  } catch {
    return { ok: true, name: want, unverified: true }
  }
}

// ── Hardened webContents.print fallback ──────────────────────────────────────
// Every geometry-relevant option is now stated EXPLICITLY instead of left to
// Chromium/driver defaults, because each default was contributing to the broken
// print:
//   landscape      — was absent (=false) while a 215.9×139.7 page was requested
//   scaleFactor    — was absent, so the driver was free to "fit to page"
//   color:false    — was `true` into a MONO laser, which made the Canon halftone
//                    the text grey instead of emitting solid black
//   dpi 600        — the LBP6030's native resolution; avoids driver resampling
//   pageRanges 0-0 — belt-and-braces against a stray second page
function driverPrint(webContents, c, n) {
  return new Promise((resolve) => {
    let done = false
    const finish = (ok, reason) => { if (!done) { done = true; resolve({ ok, reason }) } }
    const timer = setTimeout(() => finish(false, 'timeout'), 60000)
    try {
      webContents.print({
        silent: true,
        color: false,
        printBackground: true,
        copies: n,
        landscape: c.landscape,
        scaleFactor: 100,
        dpi: { horizontal: 600, vertical: 600 },
        pageRanges: [{ from: 0, to: 0 }],
        margins: { marginType: 'none' },
        // Electron takes a custom pageSize in MICRONS.
        pageSize: { width: Math.round(c.paperW * 1000), height: Math.round(c.paperH * 1000) },
        ...(c.deviceName ? { deviceName: c.deviceName } : {})
      }, (success, failureReason) => {
        clearTimeout(timer)
        finish(!!success, success ? '' : (failureReason || 'print-failed'))
      })
    } catch (e) { clearTimeout(timer); finish(false, String(e && e.message || e)) }
  })
}

// ── Render the sheet to an EXACT-SIZE PDF ────────────────────────────────────
// preferCSSPageSize honours the `@page{size:215.9mm 139.7mm;margin:0}` rule the
// HTML declares, so the PDF's MediaBox is the physical sheet — not Chromium's
// default Letter. That is what lets the spooler print at 1:1 with nothing to
// "fit". pageSize is passed as well (inches) as a belt-and-braces fallback for
// the case where the CSS rule is somehow not applied.
async function renderOverlayPdf(webContents, c) {
  return webContents.printToPDF({
    printBackground: true,
    preferCSSPageSize: true,
    landscape: c.landscape,
    pageSize: { width: c.paperW / 25.4, height: c.paperH / 25.4 },
    margins: { top: 0, bottom: 0, left: 0, right: 0 }
  })
}

// ── Print the overlay sheet ──────────────────────────────────────────────────
// Two stages, because handing the page straight to the Canon driver is exactly
// what broke: it had no matching custom form, fell back to its own default
// paper, then auto-rotated and shrank the job (values printed sideways, some off
// the sheet entirely).
//   1. printToPDF at the exact sheet size (above).
//   2. Spool that PDF with scaling explicitly disabled (electron/pdfPrint.cjs).
// If stage 2 is unavailable (helper binary missing) or fails, fall back to the
// hardened webContents.print path below and say LOUDLY which path ran and why —
// a silent switch back to the broken path is how this bug survived unnoticed.
// `log` is printLog.log from main.cjs (optional; never allowed to throw).
//
// allowFallback: for a REAL slip this is FALSE. When engine==='pdf' but the
// spooler binary is missing, printing a real slip through the Windows driver
// would destroy an expensive pre-printed form with the same rotated/shrunken
// output that started all this — so instead it returns
// { ok:false, reason:'pdf-engine-unavailable' } and prints NOTHING. Proof/test
// prints on plain paper pass allowFallback:true (a wasted plain sheet is fine),
// and stamp the engine they actually used into the footer.
function printOverlay({ data, cfg, win, copies = 1, html, tag = 'overlay', log, allowFallback = false }) {
  const c = normalizeCfg(cfg)
  const pageHtml = html || (data ? buildOverlayHtml(data, cfg) : null) // print = values only (no bg)
  if (!pageHtml) return Promise.resolve({ ok: false, reason: 'no-data' })
  const n = Math.max(1, Math.min(5, parseInt(copies, 10) || 1))
  const note = (event, fields) => { try { if (log) log(event, fields) } catch {} }
  const geom = {
    paper: `${c.paperW}x${c.paperH}mm`, landscape: c.landscape, rotate180: c.rotate180,
    scaleX: c.scaleX, scaleY: c.scaleY, offX: c.offsetX, offY: c.offsetY, fontPt: c.fontPt,
    engine: c.engine, device: c.deviceName, copies: n, tag
  }
  return (async () => {
    const w = new BrowserWindow({ show: false, width: 1000, height: 700, frame: false, webPreferences: { sandbox: false, backgroundThrottling: false } })
    // Loaded from a TEMP FILE, not a data: URL. The proof sheet's 10mm grid makes
    // the document ~10x bigger than a slip, and at that size Chromium refuses the
    // data: navigation outright (ERR_FAILED) — caught by the dry-run, and it would
    // have made the proof print fail on the shop's machine too. A file:// page has
    // no such limit and behaves identically for printToPDF/print.
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'goldlab-overlay-'))
    const htmlFile = path.join(tmpDir, `${tag}.html`)
    try {
      fs.writeFileSync(htmlFile, pageHtml, 'utf8')
      await w.loadFile(htmlFile)
      try { await w.webContents.executeJavaScript('Promise.resolve(window.__ready)', true) } catch {}

      // Printer check BEFORE any rendering work — and before the dry-run branch is
      // skipped — so a wrong printer name is reported as itself instead of turning
      // into a mystery blank sheet from the office laser.
      if (!process.env.GOLDLAB_PRINT_PDF_DIR) {
        const dev = await validateDevice(w.webContents, c.deviceName)
        if (!dev.ok) {
          note('overlay-print-FAILED', { ...geom, reason: dev.reason })
          return { ok: false, reason: dev.reason }
        }
        // Use the name exactly as Windows spells it (case can differ from settings).
        c.deviceName = dev.name
        geom.device = dev.name
        if (dev.unverified) note('overlay-device-unverified', { device: dev.name, note: 'printer list unreadable — proceeding with the configured name' })
      }

      // STAGE 1 — exact-size PDF (also the dry-run artifact).
      const pdf = await renderOverlayPdf(w.webContents, c)
      const pageCount = pdfPrint.countPages(pdf)
      note('overlay-render', { ...geom, pageCount: pageCount == null ? 'unknown' : pageCount })
      // A second page means a second pre-printed slip is consumed on every single
      // print — worth shouting about even when the print itself succeeds.
      if (pageCount != null && pageCount !== 1) {
        note('overlay-WARN', { pageCount, warn: 'sheet is not exactly 1 page — each print would eat an extra pre-printed slip' })
      }

      if (process.env.GOLDLAB_PRINT_PDF_DIR) {
        const file = path.join(process.env.GOLDLAB_PRINT_PDF_DIR, `overlay-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}.pdf`)
        fs.writeFileSync(file, pdf)
        // DRY-RUN ONLY. printToPDF never reaches the Windows driver, so this file
        // proves geometry and page count — it proves NOTHING about whether the
        // Canon rotates or scales the job. Only the proof sheet does that.
        return { ok: true, reason: 'dry-run', file, pageCount, deviceName: c.deviceName || null, engine: 'dry-run' }
      }

      // STAGE 2 — spool the PDF at 1:1.
      if (c.engine !== 'driver') {
        // The DANGEROUS case: engine is 'pdf' but the spooler binary is absent.
        // For a REAL slip (allowFallback:false) we must STOP here — silently
        // dropping to the driver would print the broken rotated/shrunken output
        // onto a pre-printed slip, destroying it with no warning. Proof/test
        // prints (allowFallback:true) are on plain paper, so they may fall back.
        if (!pdfPrint.available() && !allowFallback) {
          note('overlay-print-FAILED', { ...geom, reason: 'pdf-engine-unavailable', note: 'PDF spooler missing; refusing to risk a pre-printed slip on the driver path' })
          return { ok: false, engine: 'pdf', reason: 'pdf-engine-unavailable', pageCount }
        }
        if (pdfPrint.available()) {
          const spool = await pdfPrint.printPdfBuffer({ buf: pdf, deviceName: c.deviceName, copies: n, tag })
          if (spool.ok) {
            note('overlay-print-OK', { ...geom, via: 'pdf-spooler', exe: path.basename(spool.exe || ''), from: spool.source, pageCount })
            return { ok: true, engine: 'pdf', pageCount, printer: c.deviceName }
          }
          note('overlay-pdf-spool-failed', { ...geom, reason: spool.reason, next: spool.mayHavePrinted ? 'STOP (job may already be queued)' : (allowFallback ? 'falling back to driver print' : 'STOP (real slip — no driver fallback)') })
          // Same no-double-print rule as the thermal path: if the job may already
          // be in the Windows queue, a driver retry would print a second sheet.
          if (spool.mayHavePrinted) return { ok: false, engine: 'pdf', reason: spool.reason, mayHavePrinted: true, pageCount }
          // A real slip must NOT silently fall through to the driver after a
          // spooler error either — surface it so the operator decides.
          if (!allowFallback) return { ok: false, engine: 'pdf', reason: spool.reason, pageCount }
        }
      }

      // FALLBACK — hand the page to the driver (hardened in driverPrint below).
      // Reached only for engine==='driver', or a proof/test print (allowFallback).
      const res = await driverPrint(w.webContents, c, n)
      note(res.ok ? 'overlay-print-OK' : 'overlay-print-FAILED', { ...geom, via: 'windows-driver', reason: res.reason, pageCount })
      return { ...res, engine: 'driver', pageCount, printer: c.deviceName }
    } catch (e) {
      note('overlay-print-FAILED', { ...geom, threw: String(e && e.message || e) })
      return { ok: false, reason: String(e && e.message || e) }
    } finally {
      try { w.destroy() } catch {}
      try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch {}
    }
  })()
}

// ── WhatsApp / preview composite image (values ON TOP of the blank-form scan) ─
// The shared picture must look like the finished slip, so it embeds the bg scan.
const PX_PER_MM = 6 // landscape sheet is wide; 6px/mm ≈ 152dpi keeps the PNG sane
function overlayImageToClipboard({ data, cfg, toClipboard = true }) {
  if (!data) return Promise.resolve({ ok: false, reason: 'no-data' })
  const c = normalizeCfg(cfg)
  const html = buildOverlayHtml(data, cfg, { withBg: true })
  const targetW = Math.ceil(c.paperW * PX_PER_MM)
  const targetH = Math.ceil(c.paperH * PX_PER_MM)
  return (async () => {
    const scale = (screen.getPrimaryDisplay() && screen.getPrimaryDisplay().scaleFactor) || 1
    const w = new BrowserWindow({ show: false, width: 900, height: 640, frame: false, webPreferences: { offscreen: { useSharedTexture: false }, backgroundThrottling: false, sandbox: false } })
    try {
      w.webContents.setFrameRate(30)
      await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
      w.webContents.setZoomFactor((PX_PER_MM / (96 / 25.4)) / scale)
      try { await w.webContents.executeJavaScript('Promise.resolve(window.__ready)', true) } catch {}
      const frame = await new Promise((resolve, reject) => {
        let best = null; let quietTimer = null
        const bail = setTimeout(() => { best ? resolve(best) : reject(new Error('no-frame')) }, 8000)
        w.webContents.on('paint', (_e, _d, image) => {
          const s = image.getSize()
          if (s.width >= targetW && s.height >= targetH) best = { width: s.width, height: s.height, buf: image.toBitmap() }
          if (quietTimer) clearTimeout(quietTimer)
          quietTimer = setTimeout(() => { if (best) { clearTimeout(bail); resolve(best) } }, 500)
        })
        w.setContentSize(Math.ceil(targetW / scale) + 1, Math.ceil(targetH / scale) + 1)
        setTimeout(() => { try { w.webContents.invalidate() } catch {} }, 30)
        setTimeout(() => { try { w.webContents.invalidate() } catch {} }, 1200)
      })
      let bgra = frame.buf
      if (frame.width !== targetW || frame.height !== targetH) {
        bgra = Buffer.alloc(targetW * targetH * 4)
        for (let y = 0; y < targetH; y++) frame.buf.copy(bgra, y * targetW * 4, y * frame.width * 4, y * frame.width * 4 + targetW * 4)
      }
      const png = nativeImage.createFromBitmap(bgra, { width: targetW, height: targetH }).toPNG()
      if (toClipboard) clipboard.writeImage(nativeImage.createFromBuffer(png))
      if (process.env.GOLDLAB_PRINT_PDF_DIR) {
        const file = path.join(process.env.GOLDLAB_PRINT_PDF_DIR, `overlay-share-${Date.now()}-${Math.floor(Math.random() * 1e6)}.png`)
        fs.writeFileSync(file, png)
        return { ok: true, reason: 'dry-run', file, dataUrl: 'data:image/png;base64,' + png.toString('base64') }
      }
      return { ok: true, dataUrl: 'data:image/png;base64,' + png.toString('base64') }
    } catch (e) {
      return { ok: false, reason: String(e && e.message || e) }
    } finally {
      try { w.destroy() } catch {}
    }
  })()
}

// Which engine a print with this cfg would ACTUALLY use, given the spooler's
// presence. 'pdf' only when engine is pdf AND the binary exists; otherwise
// 'driver'. Used to stamp the proof footer and to build the Defaults badge.
function resolveEngine(cfg) {
  const c = normalizeCfg(cfg)
  if (c.engine === 'pdf' && pdfPrint.available()) return 'pdf'
  return 'driver'
}

module.exports = {
  buildOverlayHtml, buildProofHtml, printOverlay, overlayImageToClipboard, validateDevice,
  resolveEngine, sampleFieldValues, buildSampleData, normalizeCfg, DEFAULT_COORDS, FIELD_LABELS, PAPERS
}
