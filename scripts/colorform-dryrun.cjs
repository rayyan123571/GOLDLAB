// One-shot dry-run proof for the colour form — ONE render per Electron launch
// (offscreen BrowserWindow.loadURL only works once per process here). MODE env:
//   preview-png : the settings LIVE PREVIEW image (colorFormPreviewImage → the SAME
//                 content-height PNG Canon prints / WhatsApp shares) — decoded from
//                 its data URL. Proves the preview shows the full parchi, un-clipped.
//   print-pdf   : the colour PDF (print dry-run) on A5.
//   print-png   : the FULL A5 sheet rasterised (content top-aligned, blank below) —
//                 proves both left/right edges have margin and nothing is cut.
//   custom-png  : content-height PNG with 2 theme colours + shop_name + warning
//                 changed — proves theme + text still drive the output.
// Run: GOLDLAB_PRINT_PDF_DIR=... MODE=preview-png node scripts/run-electron.cjs scripts/colorform-dryrun.cjs
const { app, BrowserWindow, screen, nativeImage } = require('electron')
const fs = require('fs')
const path = require('path')
const cf = require('../electron/colorFormPrint.cjs')
const ov = require('../electron/overlayForm.cjs')

const OUT = process.env.GOLDLAB_PRINT_PDF_DIR
const MODE = process.env.MODE || 'preview-png'
if (!OUT) { console.error('set GOLDLAB_PRINT_PDF_DIR'); process.exit(1) }
fs.mkdirSync(OUT, { recursive: true })

const shop = {
  shop_name: 'امتیاز گولڈ ٹیسٹ لیبارٹری',
  shop_owner: 'Prop: Arslan Imtiaz',
  shop_phone1: '061-4506693',
  shop_phone2: '0321-6307957',
  shop_address: 'بلال مارکیٹ صرافہ بازار ملتان'
}
const terms = 'سونا ٹیسٹ کرنے کی فیس 100 روپے، خالص سونا یا رقم پر 50 روپے فی گرام مزدوری۔ رزلٹ کے بعد سونا لینے کا دکاندار پابند نہیں۔'
const data = { ...cf.buildSampleData(), shop, terms }
const WARN = 'رزلٹ کے بعد سونا لینے یا نہ لینے کا دکاندار پابند نہیں ہوگا۔ چوری کا سونا نکلنے پر ہم ذمہ دار نہ ہوں گے۔'
const CFG = { form_paper: 'A5', warning: WARN, shop, style: 'bw' }        // default black-and-white
const COLOR_CFG = { form_paper: 'A5', warning: WARN, shop, style: 'color' } // colour option
const CUSTOM_CFG = {
  form_paper: 'A5',
  warning: 'ٹیسٹ: نئی سرخ وارننگ لائن یہاں دکھتی ہے',
  theme: JSON.stringify({ banner: '#0b6e4f', frame: '#8e44ad' }),
  shop: { ...shop, shop_name: 'ٹیسٹ: بدلا ہوا نام' }
}

// Full-A5-sheet offscreen raster (test-only) — shows the whole printed page.
function fullSheetPng(html, paperW, paperH) {
  const PX = 8
  const targetW = Math.ceil(paperW * PX)
  const targetH = Math.ceil(paperH * PX)
  return new Promise((resolve, reject) => {
    const scale = (screen.getPrimaryDisplay() && screen.getPrimaryDisplay().scaleFactor) || 1
    const w = new BrowserWindow({ show: false, width: 800, height: 600, frame: false,
      webPreferences: { offscreen: { useSharedTexture: false }, backgroundThrottling: false, sandbox: false } })
    ;(async () => {
      try {
        w.webContents.setFrameRate(30)
        await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
        try { await w.webContents.executeJavaScript('Promise.resolve(window.__ready)', true) } catch {}
        w.webContents.setZoomFactor((PX / (96 / 25.4)) / scale)
        const frame = await new Promise((res, rej) => {
          let best = null, qt = null
          const bail = setTimeout(() => best ? res(best) : rej(new Error('no-frame')), 8000)
          w.webContents.on('paint', (_e, _d, image) => {
            const s = image.getSize()
            if (s.width >= targetW && s.height >= targetH) best = { width: s.width, buf: image.toBitmap() }
            if (qt) clearTimeout(qt)
            qt = setTimeout(() => { if (best) { clearTimeout(bail); res(best) } }, 500)
          })
          w.setContentSize(Math.ceil(targetW / scale) + 1, Math.ceil(targetH / scale) + 1)
          setTimeout(() => { try { w.webContents.invalidate() } catch {} }, 30)
          setTimeout(() => { try { w.webContents.invalidate() } catch {} }, 1200)
        })
        const bgra = Buffer.alloc(targetW * targetH * 4)
        for (let y = 0; y < targetH; y++) frame.buf.copy(bgra, y * targetW * 4, y * frame.width * 4, y * frame.width * 4 + targetW * 4)
        resolve(nativeImage.createFromBitmap(bgra, { width: targetW, height: targetH }).toPNG())
      } catch (e) { reject(e) } finally { try { w.destroy() } catch {} }
    })()
  })
}

;(async () => {
  await app.whenReady()
  try {
    if (MODE === 'preview-png') {
      const r = await cf.colorFormPreviewImage({ data: { ...data, shop }, cfg: CFG })
      if (r.ok) {
        const b64 = r.dataUrl.split(',')[1]
        const file = path.join(OUT, `preview-${Date.now()}.png`)
        fs.writeFileSync(file, Buffer.from(b64, 'base64'))
        console.log('preview-png', JSON.stringify({ ok: true, file, width: r.width, height: r.height }))
      } else console.log('preview-png', JSON.stringify(r))
    } else if (MODE === 'print-pdf') {
      console.log('print-pdf', JSON.stringify(await cf.printColorForm({ data: { ...data, shop }, cfg: CFG, tag: 'a5' })))
    } else if (MODE === 'print-png') {
      const html = cf.buildColorFormHtml({ ...data, shop }, CFG)
      const png = await fullSheetPng(html, 148, 210)
      const file = path.join(OUT, `a5-bw-sheet-${Date.now()}.png`)
      fs.writeFileSync(file, png)
      console.log('print-png', JSON.stringify({ ok: true, file }))
    } else if (MODE === 'color-preview') {
      const r = await cf.colorFormPreviewImage({ data: { ...data, shop }, cfg: COLOR_CFG })
      if (r.ok) {
        const file = path.join(OUT, `color-${Date.now()}.png`)
        fs.writeFileSync(file, Buffer.from(r.dataUrl.split(',')[1], 'base64'))
        console.log('color-preview', JSON.stringify({ ok: true, file }))
      } else console.log('color-preview', JSON.stringify(r))
    } else if (MODE === 'overlay-pdf') {
      console.log('overlay-pdf', JSON.stringify(await ov.printOverlay({ data: cf.buildSampleData(), cfg: { overlay_paper: 'halfletter_landscape', rightDX: 108 }, tag: 'a5' })))
    } else if (MODE === 'overlay-png') {
      // Full-sheet raster of the VALUES-ONLY overlay (white bg) at 215.9×139.7.
      const html = ov.buildOverlayHtml(cf.buildSampleData(), { overlay_paper: 'halfletter_landscape', rightDX: 108 })
      const png = await fullSheetPng(html, 215.9, 139.7)
      const file = path.join(OUT, `overlay-values-${Date.now()}.png`)
      fs.writeFileSync(file, png)
      console.log('overlay-png', JSON.stringify({ ok: true, file }))
    } else if (MODE === 'overlay-shifted-png') {
      // Right copy shifted independently (rightDX 100, rightDY 6) — proves the
      // right slip moves alone.
      const html = ov.buildOverlayHtml(cf.buildSampleData(), { overlay_paper: 'halfletter_landscape', rightDX: 100, rightDY: 6 })
      const png = await fullSheetPng(html, 215.9, 139.7)
      const file = path.join(OUT, `overlay-shifted-${Date.now()}.png`)
      fs.writeFileSync(file, png)
      console.log('overlay-shifted-png', JSON.stringify({ ok: true, file }))
    } else if (MODE === 'route-lab') {
      // LAB in overlay mode → the overlay print call targets the Canon.
      const { routeFor } = require('../electron/printRouting.cjs')
      const r = routeFor({ printMode: 'overlay_form', receipt: 'lab', printerThermal: 'ThermalPOS-80', printerCanon: 'Canon LBP6030' })
      const res = await ov.printOverlay({ data: cf.buildSampleData(), cfg: { overlay_paper: 'halfletter_landscape', deviceName: r.deviceName }, tag: 'route-lab' })
      console.log('LAB overlay engine:', r.engine, '→ print call deviceName:', JSON.stringify(res.deviceName), '(want Canon LBP6030)')
    } else if (MODE === 'route-naqad') {
      // NAQAD (even while overlay mode is selected) → the thermal print call targets
      // the thermal printer. Real 576-dot slip render so the dry-run echoes deviceName.
      const { routeFor } = require('../electron/printRouting.cjs')
      const raster = require('../electron/rasterPrint.cjs')
      const r = routeFor({ printMode: 'overlay_form', receipt: 'naqad', printerThermal: 'ThermalPOS-80', printerCanon: 'Canon LBP6030' })
      const res = await raster.printHtml({ html: raster.buildReceiptHtml(cf.buildSampleData()), tag: 'route-naqad', requireThermal: false, deviceName: r.deviceName })
      console.log('NAQAD engine:', r.engine, '→ print call deviceName:', JSON.stringify(res.deviceName), '(want ThermalPOS-80)')
    } else if (MODE === 'custom-png') {
      const r = await cf.colorFormPreviewImage({ data: { ...data, shop: CUSTOM_CFG.shop }, cfg: CUSTOM_CFG })
      if (r.ok) {
        const file = path.join(OUT, `custom-${Date.now()}.png`)
        fs.writeFileSync(file, Buffer.from(r.dataUrl.split(',')[1], 'base64'))
        console.log('custom-png', JSON.stringify({ ok: true, file }))
      } else console.log('custom-png', JSON.stringify(r))
    }
  } catch (e) {
    console.error('ERROR', e)
  } finally {
    app.quit()
  }
})()
