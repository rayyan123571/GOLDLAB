// ─── Direct thermal raster printing (ESC/POS) ────────────────────────────────
// Why this exists: printing receipts through the Windows driver (HTML → Chromium
// print → spooler → driver raster) leaves TWO things outside our control:
//   1. Geometry — the driver decides where the 72.1mm printable band sits on the
//      80mm roll, so oversized/misanchored content clips left on one machine and
//      right on another.
//   2. Sharpness — the driver anti-aliases + halftones 203dpi output, turning
//      crisp glyph edges into grey fuzz on a 1-bit thermal head.
// This module bypasses all of it: the receipt is rendered ONCE, at its FINAL
// size — exactly 576 device pixels wide (72.1mm × 8 dots/mm @ 203dpi) — in an
// offscreen window (scale factor 1, no DPI interference), hard-thresholded to
// pure 1-bit black/white (no dithering, no grey), packed as ESC/POS raster
// (GS v 0), and written RAW to the spooler (datatype RAW → the driver passes
// bytes straight through). Dot column 0 always lands on head dot 0, so left/
// right drift is structurally impossible, and every dot is either full black
// or nothing — the same technique the "sharp" competitor softwares use.
const { BrowserWindow, nativeImage, screen } = require('electron')
const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs')
const os = require('os')

const DOTS = 576                     // printable width in dots: 72.1mm × 8
const BYTES_PER_ROW = DOTS / 8       // 72 bytes per raster row
const MAX_ROWS = 2376                // 297mm × 8 — printer's max receipt length
// Hard 1-bit threshold (0-255). Below = black dot. 170 keeps bold Urdu strokes
// solid while light greys/yellows (screen-only shading) drop to white.
const THRESHOLD = Math.min(250, Math.max(60, parseInt(process.env.GOLDLAB_RASTER_THRESHOLD, 10) || 170))

// ── Render HTML at its final size in an offscreen window ────────────────────
// Offscreen windows paint at deviceScaleFactor 1 regardless of the desktop's
// DPI scaling, so 1 CSS px == 1 captured px == 1 printer dot. The page should
// define `window.__ready` resolving to its content height in px (after fonts);
// otherwise scrollHeight is used.
async function renderBitmap(html) {
  // OSR frames come out at (window DIP size × desktop scale factor) physical
  // pixels — and the page rasters at that same physical resolution. To get a
  // frame of EXACTLY 576 physical px on any DPI setting, size the window to
  // 576/scale DIPs and zoom the page by 1/scale: layout still sees a ~576px
  // viewport, glyphs rasterize once at effective scale 1.0 (zoom × DPI = 1),
  // and the frame lands at 576(+rounding) px which we CROP — never resize —
  // to exactly 576.
  const scale = (screen.getPrimaryDisplay() && screen.getPrimaryDisplay().scaleFactor) || 1
  const dipW = Math.ceil(DOTS / scale)
  const w = new BrowserWindow({
    show: false,
    width: dipW,
    height: 600,
    frame: false,
    // useSharedTexture:false → frames arrive as plain software bitmaps in the
    // 'paint' event (the GPU shared-texture mode delivers no NativeImage).
    webPreferences: { offscreen: { useSharedTexture: false }, backgroundThrottling: false, sandbox: false }
  })
  try {
    w.webContents.setFrameRate(30)
    await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
    if (scale !== 1) w.webContents.setZoomFactor(1 / scale)
    let h = 0
    try {
      h = await w.webContents.executeJavaScript(
        'Promise.resolve(window.__ready).then((v) => v || Math.ceil(document.documentElement.scrollHeight))', true)
    } catch {
      h = await w.webContents.executeJavaScript('Math.ceil(document.documentElement.scrollHeight)', true)
    }
    const rowsWanted = Math.min(Math.max(Math.ceil(h) || 8, 8), MAX_ROWS) // in page px == printer dots
    const dipH = Math.ceil(rowsWanted / scale) + 1
    // Offscreen windows don't support capturePage (empty image) — the
    // compositor delivers frames through 'paint' events instead. Tiles paint
    // PROGRESSIVELY: the first full-size frame can still have blank (not yet
    // rasterized) bottom tiles, so never take the first frame — keep the
    // LATEST full-size frame and resolve only after painting goes quiet.
    const frame = await new Promise((resolve, reject) => {
      let best = null      // latest full-coverage frame, copied out immediately
      let anySize = ''     // last seen frame size (diagnostics)
      let quietTimer = null
      const QUIET_MS = 500 // no new paints for this long → frame is final
      const onPaint = (_e, _dirty, image) => {
        const s = image.getSize()
        anySize = s.width + 'x' + s.height
        // snapshot NOW — the NativeImage's backing store may be reused after
        // the callback returns
        if (s.width >= DOTS && s.height >= rowsWanted) {
          best = { width: s.width, height: s.height, buf: image.toBitmap() }
        }
        if (quietTimer) clearTimeout(quietTimer)
        quietTimer = setTimeout(() => { if (best) { done(); resolve(best) } }, QUIET_MS)
      }
      const done = () => {
        try { w.webContents.removeListener('paint', onPaint) } catch {}
        clearTimeout(nudge1); clearTimeout(nudge2); clearTimeout(bail)
        if (quietTimer) clearTimeout(quietTimer)
      }
      // nudges force full repaints in case the compositor idles early
      const nudge1 = setTimeout(() => { try { w.webContents.invalidate() } catch {} }, 400)
      const nudge2 = setTimeout(() => { try { w.webContents.invalidate() } catch {} }, 1500)
      const bail = setTimeout(() => {
        done()
        if (best) resolve(best)
        else reject(new Error('no offscreen frame at ' + DOTS + 'px (got ' + (anySize || 'none') + ')'))
      }, 8000)
      w.webContents.on('paint', onPaint)
      w.setContentSize(dipW, dipH)
      setTimeout(() => { try { w.webContents.invalidate() } catch {} }, 30)
    })
    const rows = Math.min(rowsWanted, frame.height)
    if (frame.width === DOTS && frame.height === rows) return { buf: frame.buf, width: DOTS, height: rows }
    // Crop (top-left DOTS × rows) — pure byte copy, zero resampling.
    const buf = Buffer.alloc(DOTS * rows * 4)
    for (let y = 0; y < rows; y++) {
      frame.buf.copy(buf, y * DOTS * 4, y * frame.width * 4, y * frame.width * 4 + DOTS * 4)
    }
    return { buf, width: DOTS, height: rows }
  } finally {
    try { w.destroy() } catch {}
  }
}

// ── Hard threshold to 1-bit + pack as ESC/POS raster bands ──────────────────
// One render → one threshold, at the SAME size. Returns the full byte stream
// for one receipt: init, raster bands, feed clear of the tear bar, cut.
function toEscPos({ buf, width, height }) {
  const bpr = width >> 3
  const bits = Buffer.alloc(bpr * height) // 1 = black dot
  for (let y = 0; y < height; y++) {
    const rowOff = y * bpr
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4 // BGRA
      const lum = 0.299 * buf[i + 2] + 0.587 * buf[i + 1] + 0.114 * buf[i]
      if (lum < THRESHOLD) bits[rowOff + (x >> 3)] |= (0x80 >> (x & 7))
    }
  }
  const chunks = [Buffer.from([0x1b, 0x40])] // ESC @ — reset
  const BAND = 512 // rows per GS v 0 block — small bands keep clone printers happy
  for (let y0 = 0; y0 < height; y0 += BAND) {
    const bh = Math.min(BAND, height - y0)
    chunks.push(Buffer.from([0x1d, 0x76, 0x30, 0x00, bpr & 0xff, (bpr >> 8) & 0xff, bh & 0xff, (bh >> 8) & 0xff]))
    chunks.push(bits.subarray(y0 * bpr, (y0 + bh) * bpr))
  }
  chunks.push(Buffer.from([0x1b, 0x64, 0x05]))      // ESC d 5 — feed past the tear bar
  chunks.push(Buffer.from([0x1d, 0x56, 0x42, 0x14])) // GS V B 20 — partial cut (ignored without cutter)
  return { bytes: Buffer.concat(chunks), bits, bpr }
}

// ── RAW spool via winspool (PowerShell P/Invoke) ─────────────────────────────
// Datatype RAW hands our bytes to the printer untouched — no driver rendering.
const RAW_PS =
  "param([string]$PrinterName,[string]$File)\n" +
  "$ErrorActionPreference = 'Stop'\n" +
  "$sig = @'\n" +
  "using System; using System.Runtime.InteropServices;\n" +
  "public class RawPrn {\n" +
  "  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Ansi)]\n" +
  "  public struct DOCINFOA { [MarshalAs(UnmanagedType.LPStr)] public string pDocName; [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile; [MarshalAs(UnmanagedType.LPStr)] public string pDataType; }\n" +
  "  [DllImport(\"winspool.Drv\", EntryPoint=\"OpenPrinterA\", SetLastError=true, CharSet=CharSet.Ansi)] public static extern bool OpenPrinter(string p, out IntPtr h, IntPtr pd);\n" +
  "  [DllImport(\"winspool.Drv\", SetLastError=true)] public static extern bool ClosePrinter(IntPtr h);\n" +
  "  [DllImport(\"winspool.Drv\", EntryPoint=\"StartDocPrinterA\", SetLastError=true, CharSet=CharSet.Ansi)] public static extern bool StartDocPrinter(IntPtr h, int level, ref DOCINFOA di);\n" +
  "  [DllImport(\"winspool.Drv\", SetLastError=true)] public static extern bool EndDocPrinter(IntPtr h);\n" +
  "  [DllImport(\"winspool.Drv\", SetLastError=true)] public static extern bool StartPagePrinter(IntPtr h);\n" +
  "  [DllImport(\"winspool.Drv\", SetLastError=true)] public static extern bool EndPagePrinter(IntPtr h);\n" +
  "  [DllImport(\"winspool.Drv\", SetLastError=true)] public static extern bool WritePrinter(IntPtr h, byte[] b, int n, out int w);\n" +
  "  public static void Send(string printer, byte[] bytes) {\n" +
  "    IntPtr h; if (!OpenPrinter(printer, out h, IntPtr.Zero)) throw new Exception(\"OpenPrinter \" + Marshal.GetLastWin32Error());\n" +
  "    try {\n" +
  "      var di = new DOCINFOA { pDocName = \"GoldLab Receipt\", pDataType = \"RAW\" };\n" +
  "      if (!StartDocPrinter(h, 1, ref di)) throw new Exception(\"StartDocPrinter \" + Marshal.GetLastWin32Error());\n" +
  "      try {\n" +
  "        if (!StartPagePrinter(h)) throw new Exception(\"StartPagePrinter \" + Marshal.GetLastWin32Error());\n" +
  "        int w; if (!WritePrinter(h, bytes, bytes.Length, out w) || w != bytes.Length) throw new Exception(\"WritePrinter \" + Marshal.GetLastWin32Error());\n" +
  "        EndPagePrinter(h);\n" +
  "      } finally { EndDocPrinter(h); }\n" +
  "    } finally { ClosePrinter(h); }\n" +
  "  }\n" +
  "}\n" +
  "'@\n" +
  "Add-Type -TypeDefinition $sig\n" +
  "[RawPrn]::Send($PrinterName, [System.IO.File]::ReadAllBytes($File))\n" +
  "Write-Output 'RAW-OK'\n"

function rawSpool(printerName, bytes) {
  return new Promise((resolve, reject) => {
    try {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'goldlab-raw-'))
      const ps1 = path.join(dir, 'rawprint.ps1')
      const bin = path.join(dir, 'receipt.bin')
      fs.writeFileSync(ps1, RAW_PS)
      fs.writeFileSync(bin, bytes)
      const p = spawn('powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1, '-PrinterName', printerName, '-File', bin],
        { windowsHide: true })
      let out = '', err = ''
      p.stdout.on('data', (d) => { out += d })
      p.stderr.on('data', (d) => { err += d })
      const cleanup = () => { try { fs.rmSync(dir, { recursive: true, force: true }) } catch {} }
      const timer = setTimeout(() => { try { p.kill() } catch {}; cleanup(); reject(new Error('spool timeout')) }, 30000)
      p.on('error', (e) => { clearTimeout(timer); cleanup(); reject(e) })
      p.on('close', (code) => {
        clearTimeout(timer); cleanup()
        if (code === 0 && out.includes('RAW-OK')) resolve()
        else reject(new Error((err || out || ('exit ' + code)).trim().slice(0, 300)))
      })
    } catch (e) { reject(e) }
  })
}

// Default system printer. RAW ESC/POS on a non-thermal printer (office laser as
// default) would print pages of garbage — only auto-use the raw path when the
// default printer LOOKS like a thermal/receipt printer. Test prints (explicit
// user action from settings) skip the guard. GOLDLAB_FORCE_RAW=1 also skips it.
const THERMAL_RX = /(thermal|receipt|\bpos\b|pos-?\d|80\s?mm|58\s?mm|\btm[- ]?\w|xp[- ]?\d|rp[- ]?\d|zj[- ]?\d|gp[- ]?\d|rongta|goojprt|hoin|sprt|black\s?copper|bixolon|citizen\s?ct|star\s?tsp|panda|zebra\s?zd|epos|xprinter)/i
async function defaultPrinter(win) {
  const list = await win.webContents.getPrintersAsync()
  return list.find((p) => p.isDefault) || null
}
function looksThermal(p) {
  if (process.env.GOLDLAB_FORCE_RAW === '1') return true
  const hay = `${p.name} ${p.displayName || ''} ${p.description || ''}`
  return THERMAL_RX.test(hay)
}

// Dry-run support (GOLDLAB_PRINT_PDF_DIR): write the ESC/POS bytes + a PNG of
// the EXACT 1-bit bitmap instead of spooling, so the whole pipeline (render →
// threshold → pack) can be verified on any machine without printing paper.
function dryRunDump({ bits, bpr, width, height, bytes, tag }) {
  const dir = process.env.GOLDLAB_PRINT_PDF_DIR
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
  const bgra = Buffer.alloc(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const black = (bits[y * bpr + (x >> 3)] >> (7 - (x & 7))) & 1
      const v = black ? 0 : 255
      const o = (y * width + x) * 4
      bgra[o] = v; bgra[o + 1] = v; bgra[o + 2] = v; bgra[o + 3] = 255
    }
  }
  const png = nativeImage.createFromBitmap(bgra, { width, height }).toPNG()
  const pngPath = path.join(dir, `raster-${tag}-${stamp}.png`)
  const binPath = path.join(dir, `raster-${tag}-${stamp}.bin`)
  fs.writeFileSync(pngPath, png)
  fs.writeFileSync(binPath, bytes)
  return { pngPath, binPath }
}

// ── Print an HTML document through the raster pipeline ──────────────────────
// Returns { ok:true, printer, widthDots, heightDots } or { ok:false, reason }.
// The caller decides what to do on failure (receipts fall back to the driver).
// The renderer serializes the app stylesheet itself when CSSOM allows it; in
// packaged builds (file://) that can be blocked, so it sends a marker and we
// splice the built stylesheet in from disk instead.
let appCssCache = null
function loadAppCss() {
  if (appCssCache != null) return appCssCache
  try {
    const assets = path.join(__dirname, '..', 'dist', 'assets')
    const cssFile = fs.readdirSync(assets).find((f) => f.endsWith('.css'))
    appCssCache = cssFile ? fs.readFileSync(path.join(assets, cssFile), 'utf8') : ''
  } catch { appCssCache = '' }
  return appCssCache
}

async function printHtml({ html, copies = 1, win, tag = 'slip', requireThermal = true }) {
  if (!html) return { ok: false, reason: 'no-html' }
  if (html.includes('/*__APP_CSS__*/')) {
    const css = loadAppCss()
    if (!css) return { ok: false, reason: 'app-css-unavailable' }
    html = html.replace('/*__APP_CSS__*/', css)
  }
  let rendered
  try { rendered = await renderBitmap(html) } catch (e) { return { ok: false, reason: 'render: ' + (e.message || e) } }
  if (rendered.width !== DOTS) return { ok: false, reason: 'render-width-mismatch: ' + rendered.width + 'px (expected ' + DOTS + ')' }
  const { bytes, bits, bpr } = toEscPos(rendered)
  const n = Math.max(1, Math.min(5, parseInt(copies, 10) || 1))
  const payload = n === 1 ? bytes : Buffer.concat(Array.from({ length: n }, () => bytes))
  if (process.env.GOLDLAB_PRINT_PDF_DIR) {
    try {
      const dump = dryRunDump({ bits, bpr, width: rendered.width, height: rendered.height, bytes: payload, tag })
      return { ok: true, reason: 'dry-run', widthDots: rendered.width, heightDots: rendered.height, ...dump }
    } catch (e) { return { ok: false, reason: 'dry-run: ' + (e.message || e) } }
  }
  let printer
  try { printer = await defaultPrinter(win) } catch (e) { return { ok: false, reason: 'printer-list: ' + (e.message || e) } }
  if (!printer) return { ok: false, reason: 'no-default-printer' }
  if (requireThermal && !looksThermal(printer)) return { ok: false, reason: 'default-printer-not-thermal: ' + printer.name }
  try {
    await rawSpool(printer.name, payload)
    return { ok: true, printer: printer.name, widthDots: rendered.width, heightDots: rendered.height }
  } catch (e) {
    return { ok: false, reason: 'spool: ' + (e.message || e) }
  }
}

// ── Test pages (Phase-3 verification harness) ────────────────────────────────
const FONT_STACK = "'Noto Nastaliq Urdu','Jameel Noori Nastaleeq','Segoe UI',Tahoma,sans-serif"
const READY_SCRIPT =
  '<script>window.__ready=(async()=>{try{if(document.fonts&&document.fonts.ready){await document.fonts.ready}}catch(e){}' +
  'await new Promise(r=>setTimeout(r,80));' +
  'var el=document.querySelector("[data-measure]")||document.body;' +
  'var h=Math.ceil(el.getBoundingClientRect().height)+2;document.body.style.height=h+"px";return h})()</scr' + 'ipt>'

// Calibration receipt: full-576 border, a tick every 48px (6mm) labelled in mm,
// LEFT-EDGE / RIGHT-EDGE flush text, an 80×80px (10×10mm) reference square.
// On paper: both edge texts fully visible + complete border + square measuring
// exactly 10mm ⇒ 1:1 dot mapping, no scaling, no clipping.
function calibrationHtml() {
  let ticks = ''
  for (let px = 0; px <= DOTS; px += 48) {
    const x = px >= DOTS ? DOTS - 2 : px
    ticks += '<div style="position:absolute;left:' + x + 'px;top:0;width:2px;height:26px;background:#000"></div>'
    const mm = px / 8
    if (px > 0 && px < DOTS) {
      ticks += '<div style="position:absolute;left:' + (x - 15) + 'px;top:27px;width:32px;text-align:center;font:700 12px Arial">' + mm + '</div>'
    }
  }
  return '<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:#fff;color:#000}</style></head><body>' +
    '<div data-measure style="width:576px;box-sizing:border-box;border:3px solid #000;position:relative;padding:0 0 10px">' +
    '<div style="position:relative;height:46px;margin-top:4px">' + ticks + '</div>' +
    '<div style="display:flex;justify-content:space-between;font:700 20px Arial;padding:2px 0">' +
    '<span>&#9668;LEFT-EDGE</span><span>RIGHT-EDGE&#9658;</span></div>' +
    '<div style="height:8px;background:#000;margin:6px 0"></div>' +
    '<div style="display:flex;align-items:center;gap:14px;padding:8px 10px">' +
    '<div style="width:80px;height:80px;border:3px solid #000;box-sizing:border-box"></div>' +
    '<div style="font:700 18px Arial">10mm &times; 10mm<br>(80&times;80 dots)</div></div>' +
    '<div dir="rtl" style="font:700 26px ' + FONT_STACK.replace(/"/g, '&quot;') + ';text-align:center;padding:6px 8px">چوہدری گولڈ لیبارٹری — ملاوٹ فی تولہ</div>' +
    '<div dir="ltr" style="font:700 24px Arial;text-align:center;letter-spacing:1px">0123456789 , . 433,000 151,688</div>' +
    '<div style="font:14px Arial;text-align:center;padding-top:8px">GoldLab calibration &middot; 576 dots = 72.1mm @ 203dpi &middot; threshold ' + THRESHOLD + '</div>' +
    '</div>' + READY_SCRIPT + '</body></html>'
}

// Worst-case receipt: the lab-receipt structure at native 576px with every
// field at its maximum plausible length — proves the real template survives
// full-width Urdu labels + 7-digit amounts without overflow or blur.
// Typography per the layout spec: body ~27-28px REGULAR/medium (bold small
// text bleeds at 203dpi; size carries readability), bordered classic header,
// 3px outer / 2px inner table rules, bold only on the boxed بقایا رقم.
function worstCaseHtml() {
  // 27px overflowed the 556px content box by ~10px (RTL tables spill LEFT off
  // the paper) — per spec, stepped down until the widest row fits: 26px values
  // / 25px labels with 4-5px cell padding keeps both tables inside 556.
  const td = (v, extra) => '<td style="border:2px solid #000;padding:4px 5px;font:500 26px Arial;text-align:center;white-space:nowrap;' + (extra || '') + '">' + v + '</td>'
  const th = (v) => '<td style="border:2px solid #000;padding:3px 5px;font:500 25px ' + FONT_STACK + ';text-align:center;white-space:nowrap">' + v + '</td>'
  // dir=rtl table: FIRST cell lands on the RIGHT — labels lead each row so the
  // label column sits rightmost like the real receipt, values run leftwards.
  const row = (label, cells) =>
    '<tr>' + th(label) + cells.map((c) => td(c)).join('') + '</tr>'
  return '<!doctype html><html><head><meta charset="utf-8"><style>' +
    'html,body{margin:0;padding:0;background:#fff;color:#000}' +
    'table{border-collapse:collapse;width:100%;border:3px solid #000}' +
    '.u{font-family:' + FONT_STACK + ';font-weight:500}' +
    '</style></head><body>' +
    '<div data-measure dir="rtl" style="width:576px;box-sizing:border-box;padding:2px 10px 0">' +
    // ── bordered classic header: name / double rule / tagline / phones / address strip
    '<div class="u" style="border:3px solid #000;text-align:center;padding:5px 6px 0">' +
    '<div style="font-size:42px;font-weight:800;line-height:1.55">چوہدری گولڈ لیبارٹری</div>' +
    '<div style="border-top:3px solid #000;border-bottom:2px solid #000;height:5px;margin:2px 10px 5px"></div>' +
    '<div style="font-size:20px;line-height:1.9">خالص سونے کی لین دین ۔ ہول سیل جیولری کا مرکز (جیولری چوڑی میکر)</div>' +
    '<div style="font-size:22px;font-weight:600;line-height:1.8">چوہدری ایم رمضان آرائیں&nbsp;&nbsp;<span dir="ltr">0300-7301839</span></div>' +
    '<div style="font:600 23px Arial;line-height:1.6"><span dir="ltr">0302-7330000</span>&nbsp;&nbsp;&nbsp;&nbsp;<span dir="ltr">0302-3334440</span></div>' +
    '<div style="border-top:2px solid #000;margin-top:5px;padding:3px 0 6px;font-size:20px;line-height:1.8">نزد موسیٰ پاک دربار صرافہ بازار ملتان</div>' +
    '</div>' +
    '<div class="u" style="font-size:28px;font-weight:600;text-align:center;border:3px solid #000;border-top:none;background:#000;color:#fff;padding:3px 0">لیب رسید — ورسٹ کیس ٹیسٹ</div>' +
    '<table style="margin-top:8px">' +
    '<tr>' + ['', 'رتی', 'ماشہ', 'تولہ', 'ملی گرام', 'گرام'].map((h) => th(h)).join('') + '</tr>' +
    row('آمد وزن', ['8.88', '11', '99', '9999', '9999']) +
    row('ملاوٹ وزن', ['8.88', '11', '99', '9999', '9999']) +
    row('خالص وزن', ['8.88', '11', '99', '9999', '9999']) +
    row('ملاوٹ فی تولہ', ['8.88', '11', '99', 'فی گرام', '0.9999']) +
    '</table>' +
    '<table style="margin-top:8px">' +
    '<tr>' + th('کیرٹ') + td('21.16') + th('ریٹ فی تولہ') + td('434,500') + '</tr>' +
    '<tr>' + th('ٹوٹل رقم') + td('9,151,688') + th('چارجز') + td('433,000') + '</tr>' +
    '<tr>' + th('بقایا رقم') + td('<span style="border:3px solid #000;padding:2px 14px;display:inline-block;font-weight:700">9,151,126</span>') + th('پوائنٹ') + td('0.8818') + '</tr>' +
    '<tr>' + th('نام') + td('محمد عبدالرحمٰن چوہدری اینڈ سنز', 'font-family:' + FONT_STACK + ';white-space:normal') + th('رتی') + td('11.35 رتی', 'font-family:' + FONT_STACK) + '</tr>' +
    '<tr>' + th('تاریخ') + td('05-07-26') + th('وقت') + td('12:58 PM') + '</tr>' +
    '</table>' +
    '<div class="u" dir="rtl" style="font-size:20px;line-height:2.1;border:2px solid #000;padding:5px 9px;margin-top:9px;text-align:right">' +
    'سونا ٹیسٹ کرنے کی فیس 100 روپے اور خالص سونا یا رقم لینے کی صورت میں 40 روپے فی گرام مزدوری ہو گی۔ رزلٹ کے بعد سونا لینے یا رقم لینے کا اندر کا کارندہ پابند نہیں ہو گا۔ سونا صرف رتی کی صورت میں چیک کیا جاتا ہے۔ یہاں خالص سونے کا لین دین کیا جاتا ہے۔</div>' +
    '<div class="u" style="font-size:20px;text-align:center;border-top:3px solid #000;margin-top:9px;padding-top:7px;line-height:1.9">لیبارٹری، کاسٹنگ سنٹر، ہول سیل شاپ، جیولری شاپ، چوڑی کڑے اور کارخانے کے سوفٹ ویئر دستیاب ہیں۔</div>' +
    '<div style="font:800 23px Arial;text-align:center;padding:2px 0 10px">Rayyan&nbsp;&nbsp;0307-6965231</div>' +
    '</div>' + READY_SCRIPT + '</body></html>'
}

async function testPrint({ kind, win }) {
  const html = kind === 'worstcase' ? worstCaseHtml() : calibrationHtml()
  // explicit user action from settings — skip the thermal-name guard so the
  // operator can test whatever printer is set as default
  return printHtml({ html, copies: 1, win, tag: kind || 'calibration', requireThermal: false })
}

module.exports = { printHtml, testPrint, DOTS }
