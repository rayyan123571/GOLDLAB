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

// ── Colour palette (matches the approved color_form_template.html) ───────────
const CLR = {
  gold1: '#e9b64d', gold2: '#d68a26', gold3: '#b5651a', // ornate gold outer frame
  banner1: '#1c4ea8', banner2: '#0e2f6e',               // blue header banner swirl
  titleEn: '#2e8b40',                                   // green English title
  name: '#e11d24',                                      // red Urdu shop name
  addr: '#ffd54a',                                      // gold address line
  rule: '#c62828',                                      // red table rules
  labelText: '#c62828', labelBg: '#fdf3f4',             // red labels on pink
  colHeaderBg: '#fdeef1',                               // pink column-header cells
  boxBorder: '#c62828', boxText: '#e11d24',             // بقایا رقم box (no fill)
  warnBg: '#c1272d',                                    // red warning bar
  noteBg: '#1a7a3c'                                     // green note box (white text)
}
// Per-unit colours for the weight-grid column-header labels (گرام…رتی), per the
// reference: گرام/ملی گرام pink, تولہ red, ماشہ/رتی blue.
const UNIT_COLOR = {
  'گرام': '#c2185b', 'ملی گرام': '#c2185b', 'تولہ': '#c62828', 'ماشہ': '#1565c0', 'رتی': '#1565c0'
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
  if (src) return `<img src="${src}" alt=""/>`
  // Inline gold-diamond SVG (from the approved template). No initials, so it
  // stays generic across shops; a shop that wants its own mark uploads a logo.
  return '<svg viewBox="0 0 100 100" aria-hidden="true">' +
    '<polygon points="50,6 94,40 50,94 6,40" fill="#ffd54a" stroke="#c9a227" stroke-width="3"/>' +
    '<polygon points="50,6 94,40 50,50 6,40" fill="#ffe89a"/>' +
    '<polygon points="6,40 50,50 50,94" fill="#e9b64d"/></svg>'
}

// ── Header banner (coloured) — driven entirely by the shop_* settings ────────
// Blue banner: gold diamond logo (top-start), green English title, red Urdu
// shop name, then owner / phones (LTR) / tagline / gold address — all from
// settings. Matches the approved color_form_template.html.
function headerHtml(shop, logo) {
  const s = shop || {}
  const g = (k) => escHtml(s[k])
  const name = g('shop_name')
  const tagline = g('shop_tagline')
  const owner = g('shop_owner')
  const phones = [g('shop_phone1'), g('shop_phone2'), g('shop_phone3')].filter((p) => p)
  const address = g('shop_address')
  let meta = ''
  if (owner) meta += `<div>${owner}</div>`
  if (phones.length) meta += `<div class="p">${phones.join(' &middot; ')}</div>`
  if (tagline) meta += `<div>${tagline}</div>`
  if (address) meta += `<div class="addr">${address}</div>`
  return '<div class="banner">' +
    `<div class="logo">${logoHtml(logo)}</div>` +
    '<div class="en">GOLD TEST LABORATORY</div>' +
    (name ? `<div class="name">${name}</div>` : '') +
    (meta ? `<div class="meta">${meta}</div>` : '') +
    '</div>'
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
    '*{-webkit-print-color-adjust:exact;print-color-adjust:exact;box-sizing:border-box;margin:0;padding:0}' +
    'html,body{background:#fff}' +
    `@page{size:${c.paperW}mm ${c.paperH}mm;margin:0}` +
    // ornate gold frame → white paper
    `.frame{width:${c.paperW}mm;height:${c.paperH}mm;padding:4mm;background:linear-gradient(135deg,${CLR.gold1},${CLR.gold2} 45%,${CLR.gold3})}` +
    `.paper{background:#fff;height:100%;padding:3.5mm 4mm 2.5mm;border:2px solid #7a3d0a;box-shadow:inset 0 0 0 2px ${CLR.gold1};display:flex;flex-direction:column;overflow:hidden}` +
    // Sections keep their natural height (never shrink to clip the banner's last
    // line); only the footer is elastic (margin-top:auto pins it to the bottom).
    '.banner,table.ct,.warn,.note{flex-shrink:0}' +
    // blue header banner
    `.banner{position:relative;border-radius:2mm;overflow:hidden;background:radial-gradient(120% 140% at 25% 10%,${CLR.banner1},${CLR.banner2});color:#fff;padding:2mm 3mm 2.4mm;text-align:center}` +
    `.banner .en{font-family:Georgia,'Times New Roman',serif;font-style:italic;font-weight:700;color:${CLR.titleEn};font-size:15pt;letter-spacing:.3px;text-shadow:0 1px 0 rgba(0,0,0,.35)}` +
    `.banner .name{font-family:${FONT_STACK};font-weight:700;color:${CLR.name};font-size:22pt;line-height:1.45;text-shadow:0 0 2px #fff,0 0 2px #fff,1px 1px 0 #fff}` +
    `.banner .meta{font-family:${FONT_STACK};font-size:9.5pt;line-height:1.55;margin-top:.6mm}` +
    `.banner .meta .p{direction:ltr;font-family:Georgia,serif;font-weight:700;letter-spacing:.3px}` +
    `.banner .meta .addr{color:${CLR.addr}}` +
    '.banner .logo{position:absolute;inset-inline-start:3mm;top:2.5mm;width:15mm;height:15mm}' +
    '.banner .logo svg,.banner .logo img{width:100%;height:100%;object-fit:contain;display:block}' +
    // tables (generic .ct — same cell loop the thermal path uses)
    `table.ct{border-collapse:collapse;width:100%;border:1.5px solid ${CLR.rule};margin-top:2mm}` +
    `table.ct td{border:1px solid ${CLR.rule};padding:1mm;text-align:center;font:700 11.5pt Arial;vertical-align:middle}` +
    `td.lbl{font-family:${FONT_STACK};font-weight:700;color:${CLR.labelText};background:${CLR.labelBg};white-space:nowrap}` +
    `td.colh{font-family:${FONT_STACK};font-weight:700;background:${CLR.colHeaderBg};white-space:nowrap}` +
    'td.val{color:#1a1a1a}' +
    `td.val.u{font-family:${FONT_STACK}}` +
    'td.val.wrap{white-space:normal;word-break:break-word}' +
    `.box{display:inline-block;border:1.5px solid ${CLR.boxBorder};border-radius:1mm;padding:.3mm 3mm;color:${CLR.boxText};font-weight:800}` +
    // warning + note + footer
    `.warn{background:${CLR.warnBg};color:#fff;font-family:${FONT_STACK};font-weight:700;font-size:10.5pt;line-height:1.9;padding:1.4mm 3mm;margin-top:2.2mm;text-align:center}` +
    `.note{background:${CLR.noteBg};color:#fff;font-family:${FONT_STACK};font-size:9pt;line-height:1.8;padding:1.4mm 3mm;margin-top:1.2mm;text-align:center}` +
    '.note b{color:#ffe14d}' +
    '.foot{margin-top:auto;padding-top:1.4mm}' +
    '.foot .ftr{text-align:center;font-family:Georgia,serif;font-size:8.5pt;color:#7a3d0a;letter-spacing:.3px}' +
    '.foot .brand{text-align:center;font-family:Arial,sans-serif;font-weight:800;font-size:10.5pt;color:#111;margin-top:1mm}'

  const note = (terms && terms.trim()) ? terms.trim() : ''
  // Prepend a gold "نوٹ:" label (as in the reference) unless the text already
  // opens with it, so a shop's own wording isn't doubled.
  const noteHtml = note
    ? (/^\s*نوٹ/.test(note) ? escHtml(note) : '<b>نوٹ:</b> ' + escHtml(note))
    : ''

  let body = '<div class="frame"><div class="paper">'
  body += headerHtml(shop, c.logo)
  body += renderTables(tables)
  if (warning && warning.trim()) body += `<div class="warn" dir="rtl">${escHtml(warning.trim())}</div>`
  if (noteHtml) body += `<div class="note" dir="rtl">${noteHtml}</div>`
  // Footer press line (optional) + the Rayyan branding line (as on the thermal
  // slip). margin-top:auto keeps it at the bottom of the sheet, never clipped.
  body += '<div class="foot"><div class="ftr">GoldLab Software</div>' +
    '<div class="brand">Rayyan&nbsp;&nbsp;0307-6965231</div></div>'
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
