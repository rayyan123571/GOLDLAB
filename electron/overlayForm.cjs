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
const { DEFAULT_COORDS, FIELD_LABELS } = require('./overlayDefaults.cjs')

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
    fontPt: num(c.fontPt, 10) || 10,
    coords,
    bg: c.bg || '',
    deviceName: c.deviceName || ''
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
    'html,body{margin:0;background:#fff}' +
    `@page{size:${c.paperW}mm ${c.paperH}mm;margin:0}` +
    '*{-webkit-print-color-adjust:exact;print-color-adjust:exact}' +
    `.sheet{position:relative;width:${c.paperW}mm;height:${c.paperH}mm;overflow:hidden;background:#fff` +
      (withBg ? `;background-image:url('${c.bg}');background-size:100% 100%;background-repeat:no-repeat` : '') + '}' +
    // Global nudge (offset) + stretch (scale) of the WHOLE overlay, applied on top
    // of the per-field coordinates so a single control shifts every value together.
    `.cal{position:absolute;inset:0;transform:translate(${c.offsetX}mm,${c.offsetY}mm) scale(${c.scaleX},${c.scaleY});transform-origin:0 0}` +
    // Each value is anchored at (x,y) = its bottom-centre (≈ baseline-centre), so
    // calibration drags a value's centre onto the pre-printed cell.
    `.f{position:absolute;font:700 ${c.fontPt}pt Arial;color:#000;white-space:nowrap;transform:translate(-50%,-100%)}` +
    `.f.u{font-family:${FONT_STACK};font-weight:700}`

  return '<!doctype html><html><head><meta charset="utf-8"><style>' + css + '</style></head><body>' +
    `<div class="sheet"><div class="cal">${cells}</div></div>` +
    '<script>window.__ready=(async()=>{try{if(document.fonts&&document.fonts.ready){await document.fonts.ready}}catch(e){}' +
    'await new Promise(r=>setTimeout(r,80));return true})()</scr' + 'ipt>' +
    '</body></html>'
}

// ── Print through the Windows DRIVER at the custom sheet size (never ESC/POS) ─
function printOverlay({ data, cfg, win, copies = 1, html, tag = 'overlay' }) {
  const c = normalizeCfg(cfg)
  const pageHtml = html || (data ? buildOverlayHtml(data, cfg) : null) // print = values only (no bg)
  if (!pageHtml) return Promise.resolve({ ok: false, reason: 'no-data' })
  const n = Math.max(1, Math.min(5, parseInt(copies, 10) || 1))
  return (async () => {
    const w = new BrowserWindow({ show: false, width: 1000, height: 700, frame: false, webPreferences: { sandbox: false, backgroundThrottling: false } })
    try {
      await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(pageHtml))
      try { await w.webContents.executeJavaScript('Promise.resolve(window.__ready)', true) } catch {}
      if (process.env.GOLDLAB_PRINT_PDF_DIR) {
        const pdf = await w.webContents.printToPDF({
          printBackground: true,
          pageSize: { width: c.paperW / 25.4, height: c.paperH / 25.4 },
          margins: { top: 0, bottom: 0, left: 0, right: 0 },
          landscape: false
        })
        const file = path.join(process.env.GOLDLAB_PRINT_PDF_DIR, `overlay-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}.pdf`)
        fs.writeFileSync(file, pdf)
        // deviceName echoed so a dry-run can verify the routing target (the real
        // print passes it to webContents.print below).
        return { ok: true, reason: 'dry-run', file, deviceName: c.deviceName || null }
      }
      const res = await new Promise((resolve) => {
        let done = false
        const finish = (ok, reason) => { if (!done) { done = true; resolve({ ok, reason }) } }
        const timer = setTimeout(() => finish(false, 'timeout'), 60000)
        try {
          w.webContents.print({
            silent: true,
            color: true,
            printBackground: true,
            copies: n,
            margins: { marginType: 'none' },
            pageSize: { width: Math.round(c.paperW * 1000), height: Math.round(c.paperH * 1000) },
            ...(c.deviceName ? { deviceName: c.deviceName } : {})
          }, (success, failureReason) => { clearTimeout(timer); finish(!!success, success ? '' : (failureReason || 'print-failed')) })
        } catch (e) { clearTimeout(timer); finish(false, String(e && e.message || e)) }
      })
      return res
    } catch (e) {
      return { ok: false, reason: String(e && e.message || e) }
    } finally {
      try { w.destroy() } catch {}
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

module.exports = {
  buildOverlayHtml, printOverlay, overlayImageToClipboard,
  sampleFieldValues, buildSampleData, normalizeCfg, DEFAULT_COORDS, FIELD_LABELS, PAPERS
}
