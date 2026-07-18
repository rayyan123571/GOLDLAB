// ─── Laser "form overlay" printing (Canon LBP6030 etc.) ──────────────────────
// Second, PARALLEL print path next to rasterPrint.cjs — selected by the
// settings column print_mode = 'laser_form'. The customer's paper is a
// PRE-PRINTED colour form (header, shop info, terms and the empty boxes are
// already on it from the press), so this module prints ONLY the data values —
// weights, rates, totals, name, date, time — each at a precise (x_mm, y_mm)
// position so it lands inside its pre-printed box. One receipt per sheet.
//
// A laser printer cannot accept ESC/POS, so nothing here goes near the raw
// spooler: the page is rendered in a hidden BrowserWindow and printed through
// the Windows DRIVER (webContents.print), or captured with printToPDF when the
// GOLDLAB_PRINT_PDF_DIR dry-run hook is set — the same convention the thermal
// path uses, so everything is verifiable without the physical printer.
//
// The thermal pipeline (rasterPrint.cjs) is NOT imported and NOT touched.
const { BrowserWindow, screen, clipboard, nativeImage } = require('electron')
const path = require('path')
const fs = require('fs')

// Same Nastaliq stack the thermal slip uses — Urdu values (e.g. the رتی text)
// render in it; numbers/Latin stay in a plain sans font.
const FONT_STACK = "'Noto Nastaliq Urdu','Jameel Noori Nastaleeq','Segoe UI',Tahoma,sans-serif"

// ── Paper sizes (mm) ─────────────────────────────────────────────────────────
const PAPERS = {
  A5: { w: 148, h: 210 },
  A4: { w: 210, h: 297 },
  Letter: { w: 215.9, h: 279.4 }
}

// ── BASE COORDINATE TEMPLATE ────────────────────────────────────────────────
// One entry per printable field of the lab رسید, positioned on an A5 PORTRAIT
// sheet (148 × 210 mm) whose top ~48mm is assumed taken by the pre-printed
// header. Every position is a STARTING POINT: a given customer's press-printed
// form is matched by dialling form_offset_x_mm / form_offset_y_mm (whole-grid
// nudge) and form_scale_x / form_scale_y (whole-grid stretch) in settings — no
// code change, no rebuild.
//
//   key    — stable field id (what extractValues() fills)
//   x, y   — top-left of the value box, mm from the sheet's top-left corner
//   w      — box width, mm (value is centered in it; calibration draws it)
//   label  — Urdu field name, shown on the calibration sheet only
//   sample — example value, shown on the calibration sheet only
//
// Layout mirrors the lab رسید: receipt no / rate-per-gram line, then the
// 5-column weight grid (گرام | ملی گرام | تولہ | ماشہ | رتی — RTL form, so
// گرام is the LEFTMOST numeric column like on the thermal slip), then the
// money grid, then name/date/time.
const COL = { gram: 14, mg: 34, tola: 58, masha: 76, ratti: 94 } // weight-grid column x's
const ROW = { aamad: 66, malawat: 76, khalis: 86, mft: 96 }      // weight-grid row y's
const FIELDS = [
  { key: 'receipt_no',    x: 100, y: 52, w: 30, label: 'رسید نمبر',     sample: '1234' },
  { key: 'rate_per_gram', x: 18,  y: 52, w: 30, label: 'ریٹ فی گرام',   sample: '18,624' },

  // آمد وزن
  { key: 'aamad_gram',  x: COL.gram,  y: ROW.aamad, w: 18, label: 'آمد گرام',      sample: '11' },
  { key: 'aamad_mg',    x: COL.mg,    y: ROW.aamad, w: 20, label: 'آمد ملی گرام',  sample: '6640' },
  { key: 'aamad_tola',  x: COL.tola,  y: ROW.aamad, w: 14, label: 'آمد تولہ',      sample: '1' },
  { key: 'aamad_masha', x: COL.masha, y: ROW.aamad, w: 14, label: 'آمد ماشہ',      sample: '0' },
  { key: 'aamad_ratti', x: COL.ratti, y: ROW.aamad, w: 16, label: 'آمد رتی',       sample: '0.00' },
  // ملاوٹ وزن
  { key: 'malawat_gram',  x: COL.gram,  y: ROW.malawat, w: 18, label: 'ملاوٹ گرام',     sample: '1' },
  { key: 'malawat_mg',    x: COL.mg,    y: ROW.malawat, w: 20, label: 'ملاوٹ ملی گرام', sample: '0375' },
  { key: 'malawat_tola',  x: COL.tola,  y: ROW.malawat, w: 14, label: 'ملاوٹ تولہ',     sample: '0' },
  { key: 'malawat_masha', x: COL.masha, y: ROW.malawat, w: 14, label: 'ملاوٹ ماشہ',     sample: '1' },
  { key: 'malawat_ratti', x: COL.ratti, y: ROW.malawat, w: 16, label: 'ملاوٹ رتی',      sample: '1.07' },
  // خالص وزن
  { key: 'khalis_gram',  x: COL.gram,  y: ROW.khalis, w: 18, label: 'خالص گرام',     sample: '10' },
  { key: 'khalis_mg',    x: COL.mg,    y: ROW.khalis, w: 20, label: 'خالص ملی گرام', sample: '6265' },
  { key: 'khalis_tola',  x: COL.tola,  y: ROW.khalis, w: 14, label: 'خالص تولہ',     sample: '0' },
  { key: 'khalis_masha', x: COL.masha, y: ROW.khalis, w: 14, label: 'خالص ماشہ',     sample: '11' },
  { key: 'khalis_ratti', x: COL.ratti, y: ROW.khalis, w: 16, label: 'خالص رتی',      sample: '6.93' },
  // ملاوٹ فی تولہ (its 4th column is the fixed pre-printed "فی گرام" caption,
  // so only the per-gram VALUE is printed there)
  { key: 'mft_per_gram', x: COL.gram,  y: ROW.mft, w: 18, label: 'ملاوٹ فی گرام', sample: '0.0889' },
  { key: 'mft_tola',     x: COL.tola,  y: ROW.mft, w: 14, label: 'ملاوٹ ف تولہ',  sample: '0' },
  { key: 'mft_masha',    x: COL.masha, y: ROW.mft, w: 14, label: 'ملاوٹ ف ماشہ',  sample: '1' },
  { key: 'mft_ratti',    x: COL.ratti, y: ROW.mft, w: 16, label: 'ملاوٹ ف رتی',   sample: '0.85' },

  // money grid — two value columns like the slip (labels pre-printed)
  { key: 'keerat',        x: 96, y: 112, w: 30, label: 'کیرٹ',        sample: '21.16' },
  { key: 'rate_per_tola', x: 18, y: 112, w: 34, label: 'ریٹ فی تولہ', sample: '434,500' },
  { key: 'total_raqam',   x: 96, y: 124, w: 34, label: 'ٹوٹل رقم',    sample: '4,151,688' },
  { key: 'charges',       x: 18, y: 124, w: 30, label: 'چارجز',       sample: '1,100' },
  { key: 'baqaya_raqam',  x: 96, y: 136, w: 34, label: 'بقایا رقم',   sample: '4,150,588' },
  { key: 'point',         x: 18, y: 136, w: 30, label: 'پوائنٹ',      sample: '0.9111' },
  { key: 'naam',          x: 52, y: 150, w: 78, label: 'نام',          sample: 'محمد عبدالرحمٰن' },
  { key: 'ratti_text',    x: 18, y: 150, w: 30, label: 'رتی',          sample: '11.35 رتی' },
  { key: 'date',          x: 96, y: 162, w: 30, label: 'تاریخ',        sample: '18-07-26' },
  { key: 'time',          x: 18, y: 162, w: 30, label: 'وقت',          sample: '12:58 PM' }
]

// ── slipData → { fieldKey: value } ──────────────────────────────────────────
// The renderer's slipData is REUSED verbatim ({ title, showFee, tables } —
// the exact same object the thermal path renders), so nothing is recomputed
// here. Values are found by their Urdu LABEL cell, not by row index, so a
// cosmetic reshuffle of the slip tables can't silently misplace a value.
//   • a weight row (label in WEIGHT_ROWS) carries its 5 values in the slip's
//     fixed order: رتی, ماشہ, تولہ, ملی گرام, گرام
//   • everywhere else, a label cell followed by a value cell is a pair
// Labels that aren't in the maps (e.g. وصولی رسید-specific rows) are ignored —
// the pre-printed form is the lab رسید form.
const WEIGHT_ROWS = { 'آمد وزن': 'aamad', 'ملاوٹ وزن': 'malawat', 'خالص وزن': 'khalis' }
const PAIR_LABELS = {
  'رسید نمبر': 'receipt_no',
  'ریٹ فی گرام': 'rate_per_gram',
  'کیرٹ': 'keerat',
  'ریٹ فی تولہ': 'rate_per_tola',
  'ٹوٹل رقم': 'total_raqam',
  'چارجز': 'charges',
  'بقایا رقم': 'baqaya_raqam',
  'پوائنٹ': 'point',
  'نام': 'naam',
  'رتی': 'ratti_text',
  'تاریخ': 'date',
  'وقت': 'time'
}

function extractValues(data) {
  const out = {}
  const norm = (s) => String(s == null ? '' : s).trim()
  for (const table of (data && data.tables) || []) {
    for (const row of table || []) {
      if (!Array.isArray(row) || !row.length) continue
      const first = row[0] || {}
      const wPrefix = first.l !== undefined ? WEIGHT_ROWS[norm(first.l)] : null
      if (wPrefix) {
        // slip order after the label: رتی, ماشہ, تولہ, ملی گرام, گرام
        const keys = ['ratti', 'masha', 'tola', 'mg', 'gram']
        for (let i = 0; i < keys.length; i++) {
          const c = row[i + 1]
          if (c && c.v !== undefined) out[`${wPrefix}_${keys[i]}`] = c.v
        }
        continue
      }
      if (first.l !== undefined && norm(first.l) === 'ملاوٹ فی تولہ') {
        // رتی, ماشہ, تولہ, (fixed "فی گرام" caption — skip), per-gram value
        const c = (i) => row[i] && row[i].v !== undefined ? row[i].v : undefined
        if (c(1) !== undefined) out.mft_ratti = c(1)
        if (c(2) !== undefined) out.mft_masha = c(2)
        if (c(3) !== undefined) out.mft_tola = c(3)
        if (c(5) !== undefined) out.mft_per_gram = c(5)
        continue
      }
      for (let i = 0; i < row.length - 1; i++) {
        const lc = row[i]
        const vc = row[i + 1]
        if (!lc || lc.l === undefined || !vc || vc.v === undefined) continue
        const key = PAIR_LABELS[norm(lc.l)]
        if (key && out[key] === undefined) out[key] = vc.v
      }
    }
  }
  return out
}

// ── Settings → normalized config ─────────────────────────────────────────────
function normalizeCfg(cfg) {
  const c = cfg || {}
  const num = (v, d) => (v != null && Number.isFinite(Number(v)) ? Number(v) : d)
  let paper = PAPERS[c.form_paper] || null
  if (!paper && c.form_paper === 'custom') {
    paper = { w: num(c.form_paper_w_mm, PAPERS.A5.w), h: num(c.form_paper_h_mm, PAPERS.A5.h) }
  }
  if (!paper) paper = PAPERS.A5
  return {
    paperW: Math.max(50, paper.w),
    paperH: Math.max(50, paper.h),
    offsetX: num(c.form_offset_x_mm, 0),
    offsetY: num(c.form_offset_y_mm, 0),
    scaleX: Math.min(2, Math.max(0.5, num(c.form_scale_x, 1))),
    scaleY: Math.min(2, Math.max(0.5, num(c.form_scale_y, 1))),
    fontPt: Math.min(24, Math.max(6, num(c.form_font_pt, 11))),
    template: c.form_template || 'default',
    deviceName: c.deviceName || ''
  }
}

const escHtml = (v) => String(v == null ? '' : v)
  .replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]))
const isUrdu = (v) => /[؀-ۿ]/.test(String(v == null ? '' : v))

// Field position with the whole-grid calibration transform applied: scale
// stretches the POSITION grid about the sheet origin, offset then nudges it.
// The glyph size itself stays form_font_pt — stretching the text would defeat
// the point of a numeric font setting.
const posOf = (f, cfg) => ({
  x: f.x * cfg.scaleX + cfg.offsetX,
  y: f.y * cfg.scaleY + cfg.offsetY,
  w: f.w * cfg.scaleX
})

function pageShell(cfg, body) {
  return '<!doctype html><html><head><meta charset="utf-8"><style>' +
    `@page{size:${cfg.paperW}mm ${cfg.paperH}mm;margin:0}` +
    'html,body{margin:0;padding:0;background:#fff;color:#000}' +
    '</style></head><body>' +
    `<div style="position:relative;width:${cfg.paperW}mm;height:${cfg.paperH}mm;overflow:hidden">` +
    body +
    '</div>' +
    // fonts settled before print/printToPDF is invoked (awaited by printOverlay)
    '<script>window.__ready=(async()=>{try{if(document.fonts&&document.fonts.ready){await document.fonts.ready}}catch(e){}' +
    'await new Promise(r=>setTimeout(r,80));return true})()</scr' + 'ipt>' +
    '</body></html>'
}

// ── The printed page: value spans ONLY ──────────────────────────────────────
// No borders, no header, no title bar, no terms — all pre-printed on the form.
function buildOverlayHtml(data, cfg) {
  const c = normalizeCfg(cfg)
  const values = extractValues(data)
  let spans = ''
  for (const f of FIELDS) {
    const v = values[f.key]
    if (v == null || String(v).trim() === '') continue // empty field → box stays blank
    const p = posOf(f, c)
    const urdu = isUrdu(v)
    spans += `<span dir="${urdu ? 'rtl' : 'ltr'}" style="position:absolute;left:${p.x}mm;top:${p.y}mm;width:${p.w}mm;` +
      `text-align:center;white-space:nowrap;font:700 ${c.fontPt}pt ${urdu ? FONT_STACK : 'Arial,sans-serif'}">` +
      escHtml(v) + '</span>'
  }
  return pageShell(c, spans)
}

// ── Calibration sheet ────────────────────────────────────────────────────────
// Same paper + same transform, but every field draws a LABELLED OUTLINE BOX
// (field name above, sample value inside). The operator prints it on plain
// paper, holds it over the pre-printed form against the light, and dials
// offset/scale in settings until the boxes sit inside the form's boxes.
function overlayCalibrationHtml(cfg) {
  const c = normalizeCfg(cfg)
  let body =
    `<div style="position:absolute;left:2mm;top:2mm;font:9pt Arial">GoldLab form calibration &middot; ` +
    `${c.paperW}&times;${c.paperH}mm &middot; offset ${c.offsetX}/${c.offsetY}mm &middot; scale ${c.scaleX}/${c.scaleY} &middot; ${c.fontPt}pt</div>`
  for (const f of FIELDS) {
    const p = posOf(f, c)
    body += `<div style="position:absolute;left:${p.x}mm;top:${p.y}mm;width:${p.w}mm;box-sizing:border-box;` +
      `border:0.3mm dashed #000;text-align:center;white-space:nowrap;font:700 ${c.fontPt}pt Arial,sans-serif">` +
      escHtml(f.sample) + '</div>' +
      `<div dir="rtl" style="position:absolute;left:${p.x}mm;top:${p.y - 3.4}mm;width:${p.w}mm;text-align:center;` +
      `white-space:nowrap;font:6pt ${FONT_STACK}">` + escHtml(f.label) + '</div>'
  }
  return pageShell(c, body)
}

// ── Print through the Windows DRIVER (never ESC/POS, never RAW) ─────────────
// Returns { ok, reason } shaped like rasterPrint's printHtml. With
// GOLDLAB_PRINT_PDF_DIR set, writes a paper-exact PDF instead of spooling.
function printOverlay({ data, cfg, win, copies = 1, html, tag = 'slip' }) {
  const c = normalizeCfg(cfg)
  const pageHtml = html || (data ? buildOverlayHtml(data, c) : null)
  if (!pageHtml) return Promise.resolve({ ok: false, reason: 'no-data' })
  const n = Math.max(1, Math.min(5, parseInt(copies, 10) || 1))
  return (async () => {
    const w = new BrowserWindow({
      show: false,
      width: 800,
      height: 1100,
      frame: false,
      webPreferences: { sandbox: false, backgroundThrottling: false }
    })
    try {
      await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(pageHtml))
      try { await w.webContents.executeJavaScript('Promise.resolve(window.__ready)', true) } catch {}
      if (process.env.GOLDLAB_PRINT_PDF_DIR) {
        // Dry-run: exact paper size, zero margins — mirror of main.cjs 'print-page'.
        const pdf = await w.webContents.printToPDF({
          printBackground: true,
          pageSize: { width: c.paperW / 25.4, height: c.paperH / 25.4 },
          margins: { top: 0, bottom: 0, left: 0, right: 0 }
        })
        const file = path.join(process.env.GOLDLAB_PRINT_PDF_DIR,
          `overlay-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}.pdf`)
        fs.writeFileSync(file, pdf)
        return { ok: true, reason: 'dry-run', file }
      }
      // Driver path. pageSize is in MICRONS for webContents.print. Default
      // printer unless a specific deviceName is configured. Watchdog resolves
      // even if Chromium never fires the callback (same quirk print-page guards).
      const res = await new Promise((resolve) => {
        let done = false
        const finish = (ok, reason) => { if (!done) { done = true; resolve({ ok, reason }) } }
        const timer = setTimeout(() => finish(false, 'timeout'), 60000)
        try {
          w.webContents.print({
            silent: true,
            printBackground: true,
            copies: n,
            margins: { marginType: 'none' },
            pageSize: { width: Math.round(c.paperW * 1000), height: Math.round(c.paperH * 1000) },
            ...(c.deviceName ? { deviceName: c.deviceName } : {})
          }, (success, failureReason) => {
            clearTimeout(timer)
            finish(!!success, success ? '' : (failureReason || 'print-failed'))
          })
        } catch (e) {
          clearTimeout(timer)
          finish(false, String(e && e.message || e))
        }
      })
      return res
    } catch (e) {
      return { ok: false, reason: String(e && e.message || e) }
    } finally {
      try { w.destroy() } catch {}
    }
  })()
}

// ── WhatsApp share image (laser_form mode) ──────────────────────────────────
// In laser mode the WhatsApp picture must show what the CANON prints — the
// values-only overlay page — not the thermal-style slip card. The page is
// rendered in an OFFSCREEN window (same software-bitmap technique as
// rasterPrint's renderBitmap: frames arrive via 'paint', keep the LATEST
// full frame and resolve once painting goes quiet), captured as a PNG and
// placed on the SYSTEM CLIPBOARD, so the existing auto-paste-into-WhatsApp
// flow works unchanged. Returns { ok, reason?, file? } — `file` only in the
// GOLDLAB_PRINT_PDF_DIR dry-run, where the PNG is also written to disk so the
// share image can be verified without WhatsApp.
const SHARE_PX_PER_MM = 8 // ≈203dpi — crisp on WhatsApp, A5 ⇒ 1184×1680 px
function overlayImageToClipboard({ data, cfg }) {
  const c = normalizeCfg(cfg)
  if (!data) return Promise.resolve({ ok: false, reason: 'no-data' })
  const html = buildOverlayHtml(data, c)
  return (async () => {
    // Offscreen frames come out at (DIP size × desktop scale) physical px, so
    // size/zoom are divided by the desktop scale to land the frame at the
    // target pixel size regardless of the machine's DPI setting.
    const scale = (screen.getPrimaryDisplay() && screen.getPrimaryDisplay().scaleFactor) || 1
    const targetW = Math.ceil(c.paperW * SHARE_PX_PER_MM)
    const targetH = Math.ceil(c.paperH * SHARE_PX_PER_MM)
    // A window CONSTRUCTED taller than the screen is clamped to the work area
    // (A5 @ 8px/mm is taller than any laptop screen), so — same technique as
    // rasterPrint's renderBitmap — start small and setContentSize AFTER the
    // paint listener is armed; offscreen resizes past the screen are honoured.
    const w = new BrowserWindow({
      show: false,
      width: 800,
      height: 600,
      frame: false,
      webPreferences: { offscreen: { useSharedTexture: false }, backgroundThrottling: false, sandbox: false }
    })
    try {
      w.webContents.setFrameRate(30)
      await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
      // CSS mm renders at 96dpi (3.7795 px/mm); zoom up to SHARE_PX_PER_MM.
      w.webContents.setZoomFactor((SHARE_PX_PER_MM / (96 / 25.4)) / scale)
      try { await w.webContents.executeJavaScript('Promise.resolve(window.__ready)', true) } catch {}
      // Tiles paint progressively — keep the LATEST full-size frame, resolve
      // after painting goes quiet, then crop to exactly the target page.
      const frame = await new Promise((resolve, reject) => {
        let best = null
        let quietTimer = null
        const bail = setTimeout(() => { best ? resolve(best) : reject(new Error('no-frame')) }, 8000)
        w.webContents.on('paint', (_e, _dirty, image) => {
          const s = image.getSize()
          if (s.width >= targetW && s.height >= targetH) {
            best = { width: s.width, height: s.height, buf: image.toBitmap() } // snapshot NOW
          }
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
        for (let y = 0; y < targetH; y++) {
          frame.buf.copy(bgra, y * targetW * 4, y * frame.width * 4, y * frame.width * 4 + targetW * 4)
        }
      }
      const png = nativeImage.createFromBitmap(bgra, { width: targetW, height: targetH }).toPNG()
      clipboard.writeImage(nativeImage.createFromBuffer(png))
      if (process.env.GOLDLAB_PRINT_PDF_DIR) {
        const file = path.join(process.env.GOLDLAB_PRINT_PDF_DIR,
          `overlay-share-${Date.now()}-${Math.floor(Math.random() * 1e6)}.png`)
        fs.writeFileSync(file, png)
        return { ok: true, reason: 'dry-run', file }
      }
      return { ok: true }
    } catch (e) {
      return { ok: false, reason: String(e && e.message || e) }
    } finally {
      try { w.destroy() } catch {}
    }
  })()
}

module.exports = { buildOverlayHtml, printOverlay, overlayCalibrationHtml, overlayImageToClipboard, extractValues, normalizeCfg, PAPERS }
