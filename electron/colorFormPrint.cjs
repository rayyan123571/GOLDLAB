// ─── Colour "form" printing (Canon LBP6030 / any office colour laser) ────────
// Second, PARALLEL print path next to rasterPrint.cjs — selected by the settings
// column print_mode = 'color_form'. Unlike the thermal path (which spools raw
// ESC/POS to an 80mm roll), this SOFTWARE-DRAWS THE ENTIRE RECEIPT in colour —
// coloured header + logo, coloured column headers, a bordered weight/money table
// with the values filled in, a red warning bar, a green note box and a footer —
// and prints it on PLAIN paper through the normal Windows/Canon driver. No
// pre-printed forms, no coordinates, no calibration: the software owns the whole
// layout. The design cleanly reproduces the Imtiaz Gold Test Lab colour form
// (not its ornate floral art / watermark).
//
// It consumes the SAME `slipData` the thermal path renders ({ title, showFee,
// tables }) so no value is ever recomputed — the tables are drawn exactly as
// rasterPrint's buildReceiptHtml draws them (dir=rtl, same cell semantics, same
// column order → گرام ends up leftmost, matching the form), only in colour.
//
// A colour laser cannot accept ESC/POS, so nothing here goes near the raw
// spooler: the page renders in a hidden BrowserWindow and prints through the
// driver (webContents.print, color:true), or is captured with printToPDF when
// the GOLDLAB_PRINT_PDF_DIR dry-run hook is set — the same convention the thermal
// path uses, so everything is verifiable without the physical printer.
//
// The thermal pipeline (rasterPrint.cjs) is NOT imported and NOT touched.
const { BrowserWindow, screen, clipboard, nativeImage } = require('electron')
const path = require('path')
const fs = require('fs')

// Same Nastaliq stack the thermal slip uses — every Urdu label/value renders in
// it; numbers/Latin stay in a plain sans font.
const FONT_STACK = "'Noto Nastaliq Urdu','Jameel Noori Nastaleeq','Segoe UI',Tahoma,sans-serif"

// ── Paper sizes (mm) ─────────────────────────────────────────────────────────
const PAPERS = {
  A5: { w: 148, h: 210 },
  A4: { w: 210, h: 297 },
  Letter: { w: 215.9, h: 279.4 }
}

// ── Colour palette (clean reproduction of the Imtiaz form's scheme) ──────────
const CLR = {
  frameA: '#d4880f', frameB: '#f0c778', frameC: '#b5670a', // gold/orange outer frame
  headerLine: '#123f8f',   // blue header frame / phones / tagline
  titleEn: '#1b7d3e',      // green English title band
  name: '#b3121b',         // red/maroon Urdu shop name
  tableRule: '#c1121f',    // red table borders
  labelText: '#123f8f', labelBg: '#eef4fc', // blue labels on light-blue
  colHeaderBg: '#fdeef1',  // pink column-header cells
  boxBorder: '#c1121f', boxBg: '#fff8d6', boxText: '#b3121b', // بقایا رقم box
  warnBg: '#c62828',       // red warning bar
  noteBorder: '#2e7d32', noteBg: '#eaf7ec', noteText: '#1b5e20' // green note box
}
// Per-unit colours for the weight-grid column headers (گرام…رتی).
const UNIT_COLOR = {
  'گرام': '#b3121b', 'ملی گرام': '#c2185b', 'تولہ': '#123f8f', 'ماشہ': '#1b7d3e', 'رتی': '#6a1b9a'
}
const WEIGHT_UNITS = Object.keys(UNIT_COLOR)

const escHtml = (v) => String(v == null ? '' : v)
  .replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]))
const isUrdu = (v) => /[؀-ۿ]/.test(String(v == null ? '' : v))

// ── Settings → normalized config ─────────────────────────────────────────────
// Only what the colour form needs: the sheet size, the red-warning + green-note
// text, the shop identity block and an optional logo. (The old overlay
// offset/scale/font columns are intentionally ignored.)
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
    warning: c.warning != null ? String(c.warning) : '',
    terms: c.terms != null ? String(c.terms) : '',
    shop: c.shop || null,
    logo: c.logo || '',
    deviceName: c.deviceName || ''
  }
}

// A logo stored as a data URL is used directly; a file path is read + base64'd.
// Anything unreadable → '' (the caller then draws a CSS gem instead).
function resolveLogo(logo) {
  const s = String(logo || '')
  if (!s) return ''
  if (s.startsWith('data:')) return s
  try {
    if (fs.existsSync(s)) {
      const ext = path.extname(s).toLowerCase().replace('.', '')
      const mime = (ext === 'jpg' || ext === 'jpeg') ? 'image/jpeg'
        : ext === 'gif' ? 'image/gif' : ext === 'webp' ? 'image/webp' : 'image/png'
      return `data:${mime};base64,` + fs.readFileSync(s).toString('base64')
    }
  } catch { /* fall through to gem */ }
  return ''
}

function logoHtml(logo) {
  const src = resolveLogo(logo)
  if (src) return `<img src="${src}" style="height:15mm;width:auto;max-width:26mm;object-fit:contain;display:block"/>`
  return '<div class="gem"></div>' // CSS diamond gem fallback
}

// ── Header (coloured) — driven entirely by the shop_* settings ───────────────
function headerHtml(shop, logo) {
  const s = shop || {}
  const g = (k) => escHtml(s[k])
  const name = g('shop_name')
  const tagline = g('shop_tagline')
  const owner = g('shop_owner')
  const phones = [g('shop_phone1'), g('shop_phone2'), g('shop_phone3')].filter((p) => p)
  const address = g('shop_address')
  let h = '<div class="hdr">'
  h += '<div class="hdr-en">GOLD TEST LABORATORY</div>'
  h += '<div class="hdr-main">'
  h += `<div class="hdr-logo">${logoHtml(logo)}</div>`
  if (name) h += `<div class="hdr-name">${name}</div>`
  h += '</div>'
  if (owner) h += `<div class="hdr-owner">${owner}</div>`
  if (phones.length) h += '<div class="hdr-ph">' + phones.map((p) => `<span>${p}</span>`).join('') + '</div>'
  if (tagline) h += `<div class="hdr-tag">${tagline}</div>`
  if (address) h += `<div class="hdr-addr">${address}</div>`
  h += '</div>'
  return h
}

// ── Table cell rendering — mirrors rasterPrint's buildReceiptHtml semantics ──
// A cell is EITHER a label {l,s?} or a value {v,box?,wrap?,u?,s?}. In an RTL
// table the first cell of a row lands rightmost, so a leading label puts the
// label column on the right — exactly like the thermal slip and the Imtiaz form.
function isColHeaderRow(row) {
  return row.length && row.every((c) => c && c.l !== undefined) &&
    row.some((c) => WEIGHT_UNITS.includes(String(c.l).trim()))
}
function renderCell(c, colHeader) {
  if (!c) c = { v: '' }
  const span = c.s ? ` colspan="${c.s}"` : ''
  if (c.l !== undefined) {
    const lbl = c.l == null ? '' : String(c.l)
    if (colHeader) {
      const color = UNIT_COLOR[lbl.trim()] || CLR.labelText
      return `<td${span} class="colh" style="color:${color}">${escHtml(lbl)}</td>`
    }
    return `<td${span} class="lbl">${escHtml(lbl)}</td>`
  }
  const val = (c.v == null || c.v === '') ? '-' : c.v
  const u = (c.u || isUrdu(val)) ? ' u' : ''
  const wrap = c.wrap ? ' wrap' : ''
  const inner = c.box ? `<span class="box">${escHtml(val)}</span>` : escHtml(val)
  return `<td${span} class="val${u}${wrap}">${inner}</td>`
}
function renderTables(tables) {
  return (tables || []).map((tbl) =>
    '<table class="ct">' + (tbl || []).map((row) => {
      const colh = isColHeaderRow(row)
      return '<tr>' + (row || []).map((c) => renderCell(c, colh)).join('') + '</tr>'
    }).join('') + '</table>'
  ).join('')
}

// ── The full colour page ─────────────────────────────────────────────────────
// data = the slipData ({ title, showFee, tables, shop?, terms? }); cfg carries
// paper + warning + (fallback) shop/terms + logo. shop/terms prefer the slip's
// own values (sent with every real print) and fall back to cfg (the test print).
function buildColorFormHtml(data, cfg) {
  const c = normalizeCfg(cfg)
  const shop = (data && data.shop) || c.shop || {}
  const terms = (data && data.terms != null) ? String(data.terms) : c.terms
  const warning = c.warning
  const tables = (data && data.tables) || []

  const css =
    '*{-webkit-print-color-adjust:exact;print-color-adjust:exact;box-sizing:border-box}' +
    'html,body{margin:0;padding:0;background:#fff}' +
    `@page{size:${c.paperW}mm ${c.paperH}mm;margin:0}` +
    `.frame{width:${c.paperW}mm;height:${c.paperH}mm;padding:3.5mm;` +
    `background:linear-gradient(135deg,${CLR.frameA} 0%,${CLR.frameB} 22%,${CLR.frameC} 50%,${CLR.frameB} 78%,${CLR.frameA} 100%)}` +
    '.sheet{width:100%;height:100%;background:#fff;border-radius:1mm;padding:3mm;overflow:hidden;display:flex;flex-direction:column}' +
    // header
    `.hdr{text-align:center;border:0.6mm solid ${CLR.headerLine};border-radius:1.5mm;padding:1.6mm 2mm;background:linear-gradient(#eef4ff,#ffffff)}` +
    `.hdr-en{color:${CLR.titleEn};font:800 italic 13pt Georgia,'Times New Roman',serif;letter-spacing:.4px}` +
    '.hdr-main{display:flex;align-items:center;justify-content:center;gap:3mm;margin-top:.6mm}' +
    `.hdr-name{color:${CLR.name};font-family:${FONT_STACK};font-weight:800;font-size:21pt;line-height:1.5}` +
    `.gem{width:11mm;height:11mm;transform:rotate(45deg);background:linear-gradient(135deg,#3b82f6,#0b2f7a);border:.5mm solid #0b2f7a;box-shadow:inset 0 0 2mm rgba(255,255,255,.6)}` +
    `.hdr-owner{color:${CLR.headerLine};font-family:${FONT_STACK};font-weight:700;font-size:11pt;margin-top:.8mm}` +
    `.hdr-ph{color:${CLR.headerLine};font:700 10.5pt Arial;margin-top:.6mm;display:flex;gap:4mm;justify-content:center;flex-wrap:wrap;direction:ltr}` +
    `.hdr-tag{color:${CLR.headerLine};font-family:${FONT_STACK};font-weight:600;font-size:10.5pt;margin-top:.8mm}` +
    `.hdr-addr{color:${CLR.headerLine};font-family:${FONT_STACK};font-weight:600;font-size:10pt;margin-top:.3mm}` +
    // tables
    `table.ct{border-collapse:collapse;width:100%;border:0.7mm solid ${CLR.tableRule};margin-top:2.2mm}` +
    `table.ct td{border:0.4mm solid ${CLR.tableRule};padding:1.3mm 1mm;text-align:center;font:700 11pt Arial;vertical-align:middle}` +
    `td.lbl{font-family:${FONT_STACK};font-weight:700;color:${CLR.labelText};background:${CLR.labelBg};white-space:nowrap}` +
    `td.colh{font-family:${FONT_STACK};font-weight:800;background:${CLR.colHeaderBg};white-space:nowrap}` +
    'td.val{color:#111}' +
    `td.val.u{font-family:${FONT_STACK}}` +
    'td.val.wrap{white-space:normal;word-break:break-word}' +
    `.box{display:inline-block;border:.6mm solid ${CLR.boxBorder};background:${CLR.boxBg};color:${CLR.boxText};padding:.4mm 3mm;font-weight:800}` +
    // warning + note + footer
    `.warn{background:${CLR.warnBg};color:#fff;font-family:${FONT_STACK};font-weight:700;font-size:9.5pt;line-height:1.9;padding:1.6mm 3mm;margin-top:2.2mm;border-radius:1mm;text-align:center}` +
    `.note{border:.6mm solid ${CLR.noteBorder};background:${CLR.noteBg};color:${CLR.noteText};font-family:${FONT_STACK};font-weight:700;font-size:9pt;line-height:2;padding:1.6mm 3mm;margin-top:2.2mm;border-radius:1mm;text-align:right}` +
    `.spacer{flex:1 1 auto;min-height:1mm}` +
    `.ftr{text-align:center;color:${CLR.headerLine};font:700 8pt Arial;margin-top:2mm;padding-top:1mm;border-top:.3mm solid ${CLR.headerLine}}`

  let body = '<div class="frame"><div class="sheet">'
  body += headerHtml(shop, c.logo)
  body += renderTables(tables)
  if (warning && warning.trim()) body += `<div class="warn" dir="rtl">${escHtml(warning.trim())}</div>`
  if (terms && terms.trim()) body += `<div class="note" dir="rtl">${escHtml(terms.trim())}</div>`
  body += '<div class="spacer"></div>'
  body += '<div class="ftr">Software: GoldLab &middot; Rayyan 0307-6965231</div>'
  body += '</div></div>'

  return '<!doctype html><html><head><meta charset="utf-8"><style>' + css + '</style></head><body>' +
    body +
    // fonts settled before print/printToPDF/capture (awaited by the callers)
    '<script>window.__ready=(async()=>{try{if(document.fonts&&document.fonts.ready){await document.fonts.ready}}catch(e){}' +
    'await new Promise(r=>setTimeout(r,80));return true})()</scr' + 'ipt>' +
    '</body></html>'
}

// A realistic filled lab رسید, for the settings "پیش نظارہ / ٹیسٹ" button. Same
// slipData shape Receipts.jsx builds, so the preview exercises the real path.
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

// ── Print through the Windows DRIVER (never ESC/POS, never RAW) ─────────────
// Returns { ok, reason } shaped like rasterPrint's printHtml. With
// GOLDLAB_PRINT_PDF_DIR set, writes a paper-exact colour PDF instead of spooling.
function printColorForm({ data, cfg, win, copies = 1, html, tag = 'slip' }) {
  const c = normalizeCfg(cfg)
  const pageHtml = html || (data ? buildColorFormHtml(data, cfg) : null)
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
        // Dry-run: exact paper size, backgrounds ON (the colours are the point).
        const pdf = await w.webContents.printToPDF({
          printBackground: true,
          pageSize: { width: c.paperW / 25.4, height: c.paperH / 25.4 },
          margins: { top: 0, bottom: 0, left: 0, right: 0 }
        })
        const file = path.join(process.env.GOLDLAB_PRINT_PDF_DIR,
          `colorform-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}.pdf`)
        fs.writeFileSync(file, pdf)
        return { ok: true, reason: 'dry-run', file }
      }
      // Driver path. pageSize is in MICRONS for webContents.print. color:true so
      // the Canon prints in colour. Default printer unless a deviceName is set.
      // Watchdog resolves even if Chromium never fires the callback.
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

// ── WhatsApp share image (color_form mode) ──────────────────────────────────
// In colour mode the WhatsApp picture must show what the Canon prints — the full
// colour receipt — not the thermal-style slip card. The page renders OFFSCREEN
// (frames via 'paint', keep the LATEST full frame, resolve once painting goes
// quiet), is captured as a PNG and placed on the SYSTEM CLIPBOARD so the existing
// auto-paste-into-WhatsApp flow works unchanged. Returns { ok, reason?, file? }
// — `file` only under the GOLDLAB_PRINT_PDF_DIR dry-run.
const SHARE_PX_PER_MM = 8 // ≈203dpi — crisp on WhatsApp
function colorFormImageToClipboard({ data, cfg }) {
  if (!data) return Promise.resolve({ ok: false, reason: 'no-data' })
  const c = normalizeCfg(cfg)
  const html = buildColorFormHtml(data, cfg)
  return (async () => {
    const scale = (screen.getPrimaryDisplay() && screen.getPrimaryDisplay().scaleFactor) || 1
    const targetW = Math.ceil(c.paperW * SHARE_PX_PER_MM)
    const targetH = Math.ceil(c.paperH * SHARE_PX_PER_MM)
    // Start small; setContentSize AFTER the paint listener is armed so an
    // offscreen size taller than the screen is honoured (not clamped).
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
      w.webContents.setZoomFactor((SHARE_PX_PER_MM / (96 / 25.4)) / scale)
      try { await w.webContents.executeJavaScript('Promise.resolve(window.__ready)', true) } catch {}
      const frame = await new Promise((resolve, reject) => {
        let best = null
        let quietTimer = null
        const bail = setTimeout(() => { best ? resolve(best) : reject(new Error('no-frame')) }, 8000)
        w.webContents.on('paint', (_e, _dirty, image) => {
          const s = image.getSize()
          if (s.width >= targetW && s.height >= targetH) {
            best = { width: s.width, height: s.height, buf: image.toBitmap() }
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
          `colorform-share-${Date.now()}-${Math.floor(Math.random() * 1e6)}.png`)
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

module.exports = { buildColorFormHtml, printColorForm, colorFormImageToClipboard, buildSampleData, normalizeCfg, PAPERS }
