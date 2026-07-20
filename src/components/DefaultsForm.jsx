import React, { useEffect, useRef, useState } from 'react'
import { useApp } from '../state/store.jsx'
import { buildSlipHeader, buildSlipTerms, SHOP_FIELDS, SLIP_DESIGN_W } from '../logic/slipHeader.js'

const INPUT =
  'w-full bg-white border border-gray-300 rounded-md text-[14px] leading-relaxed ' +
  'px-3 py-2 text-start tabular-nums cursor-text transition-colors ' +
  'focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500'

// Hard character caps for the printed header. The slip is only 576 dots wide, so
// a long line does not wrap — it OVERFLOWS the header box and gets clipped on
// paper. These caps are sized to what fits each line at its font size, and the
// real Chaudhary values sit comfortably inside them (the longest, the tagline, is
// ~63 of its 70). The <input maxLength> makes overflow impossible to type; the
// live preview below shows the true printed width either way.
const SHOP_MAX = {
  shop_name: 26,
  shop_tagline: 70,
  shop_owner: 30,
  shop_phone1: 15,
  shop_phone2: 15,
  shop_phone3: 15,
  shop_address: 46
}

const SHOP_LABEL = {
  shop_name: 'دکان کا نام',
  shop_tagline: 'تعارف',
  shop_owner: 'مالک کا نام',
  shop_phone1: 'فون 1',
  shop_phone2: 'فون 2',
  shop_phone3: 'فون 3',
  shop_address: 'پتہ'
}

const IS_PHONE = (f) => f === 'shop_phone1' || f === 'shop_phone2' || f === 'shop_phone3'

// Row helper at module scope so inputs never remount on keystroke (keeps focus).
function Row({ label, children, alignTop }) {
  return (
    <div className={`grid grid-cols-[140px_1fr] gap-3 ${alignTop ? 'items-start' : 'items-center'}`}>
      <label className={`urdu font-bold text-[13px] text-gray-700 text-right ${alignTop ? 'pt-2' : ''}`}>{label}</label>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

// ڈیفالٹ سیٹنگز — rate / charges / parchi / slip-print settings, saved to the
// settings table via the store's saveRates (which also refreshes the live UI).
export default function DefaultsForm({ open, onClose }) {
  const { rates, saveRates, hasApi } = useApp()
  const [form, setForm] = useState({
    rate_tezabi_tola: '', fc_per_gram: '', parchi_charges: '', slip_count: '1', raw_print_mode: 'auto', print_scale: 1.15,
    print_mode: 'thermal',
    shop_name: '', shop_tagline: '', shop_owner: '', shop_phone1: '', shop_phone2: '', shop_phone3: '', shop_address: '',
    slip_terms: '',
    // Overlay (pre-printed slip) geometry.
    overlay_offx: '0', overlay_offy: '0', overlay_scalex: '1', overlay_scaley: '1',
    overlay_right_dx: '108', overlay_right_dy: '0', overlay_font_pt: '10',
    overlay_bg_path: '', overlay_coords: null,
    // Dual-printer device names.
    printer_thermal: '', printer_canon: ''
  })
  const [printers, setPrinters] = useState([]) // installed printers for the two pickers
  const [saved, setSaved] = useState(false)
  const [testMsg, setTestMsg] = useState('')
  const [testBusy, setTestBusy] = useState(false)
  const [overlayMeta, setOverlayMeta] = useState(null)       // {defaultCoords, fieldLabels, sample} for the calibration canvas
  const [ovSel, setOvSel] = useState(null)                   // selected overlay field key (for nudge buttons)
  const [ovMsg, setOvMsg] = useState('')                     // overlay test-print status
  const ovCanvasRef = useRef(null)                           // calibration canvas element (px↔mm)
  const ovDrag = useRef(null)                                // active drag {key,startX,startY,ox,oy}
  const savedTimer = useRef(null)
  const saveTimer = useRef(null)
  const previewRef = useRef(null)
  const termsPreviewRef = useRef(null)

  // Load current values from the DB (fall back to the store's rates) on open.
  useEffect(() => {
    if (!open) return
    setSaved(false)
    let cancelled = false
    const seed = (r) => {
      const src = r || rates || {}
      if (cancelled) return
      const shop = {}
      for (const f of SHOP_FIELDS) shop[f] = src[f] != null ? String(src[f]) : ''
      setForm({
        rate_tezabi_tola: src.rate_tezabi_tola ?? '',
        fc_per_gram: src.fc_per_gram ?? '',
        parchi_charges: src.parchi_charges ?? '',
        slip_count: src.slip_count != null ? String(src.slip_count) : '1',
        raw_print_mode: src.raw_print_mode === 'force' ? 'force' : 'auto',
        print_scale: src.print_scale != null ? Number(src.print_scale) : 1.15,
        // Only thermal + overlay remain; a legacy 'color_form' loads as thermal.
        print_mode: src.print_mode === 'overlay_form' ? 'overlay_form' : 'thermal',
        ...shop,
        slip_terms: src.slip_terms != null ? String(src.slip_terms) : '',
        overlay_offx: src.overlay_offx != null ? String(src.overlay_offx) : '0',
        overlay_offy: src.overlay_offy != null ? String(src.overlay_offy) : '0',
        overlay_scalex: src.overlay_scalex != null ? String(src.overlay_scalex) : '1',
        overlay_scaley: src.overlay_scaley != null ? String(src.overlay_scaley) : '1',
        overlay_right_dx: src.overlay_right_dx != null ? String(src.overlay_right_dx) : '108',
        overlay_right_dy: src.overlay_right_dy != null ? String(src.overlay_right_dy) : '0',
        overlay_font_pt: src.overlay_font_pt != null ? String(src.overlay_font_pt) : '10',
        overlay_bg_path: src.overlay_bg_path != null ? String(src.overlay_bg_path) : '',
        overlay_coords: (() => { try { return src.overlay_coords ? JSON.parse(src.overlay_coords) : null } catch { return null } })(),
        printer_thermal: src.printer_thermal != null ? String(src.printer_thermal) : '',
        printer_canon: src.printer_canon != null ? String(src.printer_canon) : ''
      })
    }
    if (hasApi) window.api.getRates().then(seed)
    else seed(rates)
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // ── Live print preview ──────────────────────────────────────────────────────
  // Re-drawn on EVERY keystroke from the CURRENT (unsaved) form values, using the
  // very same buildSlipHeader() the printer path calls — so what the shopkeeper
  // sees here is, by construction, what comes out of the printer. Clearing a
  // field drops its line here exactly as it drops it on paper.
  useEffect(() => {
    const box = previewRef.current
    if (!open || !box) return
    box.innerHTML = ''
    try { box.appendChild(buildSlipHeader(form)) } catch { /* preview only — never break the form */ }
  }, [open, form])

  // ── Live terms preview ────────────────────────────────────────────────────────
  // Same construction as the header preview, drawn with the SAME buildSlipTerms()
  // the printer path uses. A blank field returns null → the box vanishes here just
  // as it vanishes from the printed لیب رسید.
  useEffect(() => {
    const box = termsPreviewRef.current
    if (!open || !box) return
    box.innerHTML = ''
    try {
      const node = buildSlipTerms(form.slip_terms)
      if (node) box.appendChild(node)
    } catch { /* preview only — never break the form */ }
  }, [open, form])

  // Installed printers for the two device-name pickers (dual-printer routing).
  useEffect(() => {
    if (!open || !hasApi || !window.api.listPrinters) return
    let cancelled = false
    window.api.listPrinters().then((r) => {
      if (!cancelled && r && r.ok) setPrinters(r.printers || [])
    }).catch(() => {})
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Fetch the overlay calibration metadata (default coords, labels, sample values)
  // once when overlay mode is selected — the canvas draws draggable chips from it.
  useEffect(() => {
    if (!open || form.print_mode !== 'overlay_form' || !hasApi || !window.api.overlayMeta || overlayMeta) return
    let cancelled = false
    window.api.overlayMeta().then((r) => {
      if (!cancelled && r && r.ok) setOverlayMeta(r)
    }).catch(() => {})
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, form.print_mode])

  useEffect(() => () => {
    if (savedTimer.current) clearTimeout(savedTimer.current)
    if (saveTimer.current) clearTimeout(saveTimer.current)
  }, [])

  if (!open) return null

  // ── Overlay calibration helpers ─────────────────────────────────────────────
  const SHEET_W_MM = 215.9
  const SHEET_H_MM = 139.7
  // The live per-field map = default coords with any saved/edited overrides on top.
  const ovCoords = () => ({ ...(overlayMeta?.defaultCoords || {}), ...(form.overlay_coords || {}) })
  const ovRightDX = Number(form.overlay_right_dx) || 0
  const ovRightDY = Number(form.overlay_right_dy) || 0
  // Write a field's new {x,y} (mm, snapped to 0.5) into the map and persist
  // (debounced via commit). Merges over any existing per-field overrides.
  const setFieldCoord = (key, x, y) => {
    const clampedX = Math.max(0, Math.min(SHEET_W_MM, Math.round(x * 2) / 2))
    const clampedY = Math.max(0, Math.min(SHEET_H_MM, Math.round(y * 2) / 2))
    commit({ ...form, overlay_coords: { ...(form.overlay_coords || {}), [key]: { x: clampedX, y: clampedY } } })
  }
  // Nudge the selected field by ±0.5mm.
  const nudge = (dx, dy) => {
    if (!ovSel) return
    const c = ovCoords()[ovSel] || { x: 0, y: 0 }
    setFieldCoord(ovSel, Number(c.x) + dx, Number(c.y) + dy)
  }
  // Drag a LEFT-slip chip (pointer). The RIGHT slip follows via right DX/DY.
  const onChipDown = (key) => (e) => {
    e.preventDefault()
    setOvSel(key)
    const box = ovCanvasRef.current
    if (!box) return
    const rect = box.getBoundingClientRect()
    const pxPerMmX = rect.width / SHEET_W_MM
    const pxPerMmY = rect.height / SHEET_H_MM
    const move = (ev) => {
      const mx = (ev.clientX - rect.left) / pxPerMmX
      const my = (ev.clientY - rect.top) / pxPerMmY
      setFieldCoord(key, mx, my)
    }
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  // Blank-form scan upload → base64 data URL in overlay_bg_path (calibration bg +
  // WhatsApp composite). Capped so the DB stays small.
  const onOverlayBgUpload = (e) => {
    const file = e.target.files && e.target.files[0]
    e.target.value = ''
    if (!file || !/^image\//.test(file.type)) return
    if (file.size > 4 * 1024 * 1024) { setOvMsg('اسکین بہت بڑا ہے (4MB سے کم رکھیں)'); return }
    const reader = new FileReader()
    reader.onload = () => commit({ ...form, overlay_bg_path: String(reader.result || '') })
    reader.readAsDataURL(file)
  }
  // ری سیٹ — snap coords + offsets back to the hardcoded defaults (recovery). Only
  // writes on this explicit click, like every other overlay control.
  const resetOverlay = () => {
    const dc = overlayMeta?.defaultCoords
    if (!dc) return
    const d = overlayMeta?.defaultOffsets || {}
    const s = (v, fallback) => String(v != null ? v : fallback)
    commit({
      ...form,
      overlay_coords: { ...dc },
      overlay_offx: s(d.overlay_offx, '0'), overlay_offy: s(d.overlay_offy, '0'),
      overlay_scalex: s(d.overlay_scalex, '1'), overlay_scaley: s(d.overlay_scaley, '1'),
      overlay_right_dx: s(d.overlay_right_dx, '108'), overlay_right_dy: s(d.overlay_right_dy, '0'),
      overlay_font_pt: s(d.overlay_font_pt, '10')
    })
    setOvSel(null)
    setOvMsg('ڈیفالٹ پر واپس ✓')
    if (savedTimer.current) clearTimeout(savedTimer.current)
    savedTimer.current = setTimeout(() => setOvMsg(''), 4000)
  }

  // ٹیسٹ پرنٹ — print the values-only overlay with the CURRENT (unsaved) calibration.
  const runOverlayTest = async () => {
    if (!hasApi || !window.api.overlayTestPrint || testBusy) return
    setTestBusy(true); setOvMsg('ٹیسٹ پرنٹ ہو رہا ہے…')
    try {
      const res = await window.api.overlayTestPrint({
        offsetX: Number(form.overlay_offx) || 0, offsetY: Number(form.overlay_offy) || 0,
        scaleX: Number(form.overlay_scalex) || 1, scaleY: Number(form.overlay_scaley) || 1,
        rightDX: ovRightDX, rightDY: ovRightDY,
        fontPt: Number(form.overlay_font_pt) || 10,
        coords: ovCoords(), bg: form.overlay_bg_path
      })
      setOvMsg(res && res.ok ? 'ٹیسٹ پرنٹ ہو گیا ✓' : `ناکام: ${res && res.reason ? res.reason : 'نامعلوم مسئلہ'}`)
    } catch (e) { setOvMsg(`ناکام: ${e && e.message ? e.message : e}`) }
    finally {
      setTestBusy(false)
      if (savedTimer.current) clearTimeout(savedTimer.current)
      savedTimer.current = setTimeout(() => setOvMsg(''), 6000)
    }
  }

  // Persist the given form snapshot to the DB + store, and flash the saved tick.
  const persist = async (next) => {
    // Shop fields go through as TEXT, trimmed — including '' when the shopkeeper
    // clears one, which is what removes that line from the printed header.
    const shop = {}
    for (const f of SHOP_FIELDS) shop[f] = String(next[f] ?? '').trim()
    await saveRates({
      rate_tezabi_tola: Number(next.rate_tezabi_tola) || 0,
      fc_per_gram: Number(next.fc_per_gram) || 0,
      parchi_charges: Number(next.parchi_charges) || 0,
      slip_count: Math.max(1, parseInt(next.slip_count, 10) || 1),
      raw_print_mode: next.raw_print_mode === 'force' ? 'force' : 'auto',
      print_scale: Number(next.print_scale) || 1.15,
      // Only thermal + overlay remain; anything else is stored as thermal.
      print_mode: next.print_mode === 'overlay_form' ? 'overlay_form' : 'thermal',
      // Overlay (pre-printed slip) geometry + the calibrated coordinate map + scan.
      overlay_paper: 'halfletter_landscape',
      overlay_offx: Number(next.overlay_offx) || 0,
      overlay_offy: Number(next.overlay_offy) || 0,
      overlay_scalex: Number(next.overlay_scalex) || 1,
      overlay_scaley: Number(next.overlay_scaley) || 1,
      overlay_right_dx: Number.isFinite(Number(next.overlay_right_dx)) ? Number(next.overlay_right_dx) : 108,
      overlay_right_dy: Number(next.overlay_right_dy) || 0,
      overlay_font_pt: Number(next.overlay_font_pt) || 10,
      overlay_bg_path: String(next.overlay_bg_path ?? ''),
      overlay_coords: next.overlay_coords ? JSON.stringify(next.overlay_coords) : undefined,
      // Dual-printer device names ('' clears → Windows default).
      printer_thermal: String(next.printer_thermal ?? ''),
      printer_canon: String(next.printer_canon ?? ''),
      ...shop,
      slip_terms: String(next.slip_terms ?? '').trim()
    })
    setSaved(true)
    if (savedTimer.current) clearTimeout(savedTimer.current)
    savedTimer.current = setTimeout(() => setSaved(false), 1200)
  }

  // Auto-save: update the field, then debounce a write ~500ms after typing stops.
  const commit = (next) => {
    setForm(next)
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => persist(next), 500)
  }

  // Accept digits and a single decimal point only.
  const numField = (field) => (e) => {
    const v = e.target.value.replace(/[^\d.]/g, '')
    commit({ ...form, [field]: v })
  }
  // Slip print: integer only.
  const onSlip = (e) => {
    const v = e.target.value.replace(/[^\d]/g, '')
    commit({ ...form, slip_count: v })
  }

  // Shop header fields. maxLength on the input is the real guard (typing past the
  // cap is simply refused); the slice here is belt-and-braces for a PASTE, which
  // some browsers let through. Phones additionally accept only digits, spaces and
  // dashes, so a stray letter can never reach the printed header.
  const shopField = (field) => (e) => {
    let v = e.target.value
    if (IS_PHONE(field)) v = v.replace(/[^\d\s-]/g, '')
    commit({ ...form, [field]: v.slice(0, SHOP_MAX[field]) })
  }

  // لیب رسید terms paragraph. Same commit()/debounce as the header fields; the
  // slice mirrors the textarea's maxLength (belt-and-braces for a paste).
  const termsField = (e) => commit({ ...form, slip_terms: e.target.value.slice(0, 400) })

  // Direct-thermal test pages (کیلیبریشن / ورسٹ کیس) — print via the raw
  // ESC/POS raster path to the DEFAULT printer so the paper itself proves the
  // geometry: full border, mm ticks, 10mm reference square, edge texts.
  const runTest = async (kind, label) => {
    if (!hasApi || !window.api.rasterTestPrint || testBusy) return
    setTestBusy(true)
    setTestMsg(`${label} پرنٹ ہو رہا ہے…`)
    try {
      const res = await window.api.rasterTestPrint(kind)
      setTestMsg(res && res.ok
        ? `${label} پرنٹ ہو گیا ✓${res.printer ? ` (${res.printer})` : ''}`
        : `ناکام: ${res && res.reason ? res.reason : 'نامعلوم مسئلہ'}`)
    } catch (e) {
      setTestMsg(`ناکام: ${e && e.message ? e.message : e}`)
    } finally {
      setTestBusy(false)
      if (savedTimer.current) clearTimeout(savedTimer.current)
      savedTimer.current = setTimeout(() => setTestMsg(''), 6000)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/50 flex items-start justify-center p-4 pt-[8vh]"
      onClick={onClose}
    >
      <div
        dir="rtl"
        className="relative bg-gray-50 border border-gray-300 rounded-lg shadow-2xl w-[480px] max-w-[95vw] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Title bar */}
        <div className="flex items-center justify-between bg-gradient-to-b from-slate-100 to-slate-200 border-b border-gray-300 px-4 py-2.5">
          <div className="flex items-center gap-3">
            <h2 className="urdu font-bold text-[16px] text-gray-800">ڈیفالٹ سیٹنگز</h2>
            {/* subtle auto-save indicator — no button, just feedback */}
            <span className={`urdu flex items-center gap-1 text-[12px] font-medium text-emerald-600 transition-opacity duration-300 ${saved ? 'opacity-100' : 'opacity-0'}`}>
              محفوظ ہو گیا ✓
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            title="بند کریں"
            className="w-7 h-7 flex items-center justify-center rounded-md text-gray-600 hover:bg-red-500 hover:text-white transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Body — scrolls: the shop-header block + its print preview make this
            taller than a short screen. */}
        <div className="p-5 flex flex-col gap-4 max-h-[78vh] overflow-y-auto">
          <Row label="ریٹ">
            <input dir="ltr" className={INPUT} value={form.rate_tezabi_tola} onChange={numField('rate_tezabi_tola')} inputMode="decimal" placeholder="0" />
          </Row>

          <Row label="چارجز فی گرام">
            <input dir="ltr" className={INPUT} value={form.fc_per_gram} onChange={numField('fc_per_gram')} inputMode="decimal" placeholder="0" />
          </Row>

          <Row label="چارج پرچی">
            <input dir="ltr" className={INPUT} value={form.parchi_charges} onChange={numField('parchi_charges')} inputMode="decimal" placeholder="0" />
          </Row>

          <Row label="سلپ پرنٹ">
            <input
              dir="ltr"
              className={`${INPUT} w-28`}
              value={form.slip_count}
              onChange={onSlip}
              inputMode="numeric"
              min={1}
              placeholder="1"
            />
          </Row>

          {/* تھرمل پرنٹر پر براہِ راست (raw ESC/POS) — when ON, every default
              printer is treated as thermal and uses the raw path (bypasses the
              name check). Leave OFF to auto-detect by printer name. */}
          <Row label="تھرمل پرنٹر پر براہِ راست پرنٹ">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                className="w-4 h-4 cursor-pointer"
                checked={form.raw_print_mode === 'force'}
                onChange={(e) => commit({ ...form, raw_print_mode: e.target.checked ? 'force' : 'auto' })}
              />
              <span className="urdu text-[12px] text-gray-600">
                {form.raw_print_mode === 'force' ? 'ہر پرنٹر پر براہِ راست (فورس)' : 'خودکار (پرنٹر کے نام سے پہچان)'}
              </span>
            </label>
          </Row>

          {/* پرنٹ سائز — thermal render magnification 1.00–1.35 (bigger/longer slip). */}
          <Row label="پرنٹ سائز">
            <select
              className={`${INPUT} w-28`}
              value={Number(form.print_scale).toFixed(2)}
              onChange={(e) => commit({ ...form, print_scale: Number(e.target.value) })}
            >
              {['1.00', '1.05', '1.10', '1.15', '1.20', '1.25', '1.30', '1.35'].map((v) => (
                <option key={v} value={v}>{v}×</option>
              ))}
            </select>
          </Row>

          {/* ── پرنٹر کی قسم — Thermal (80mm ESC/POS رول، جوں کا توں) یا Canon کلر:
              سافٹ ویئر پوری رنگین رسید خود بنا کر سادہ کاغذ پر چھاپتا ہے۔ ایک ہی
              سیٹنگ، ایک ہی بلڈ — ہر دکان اپنا موڈ اور ہیڈر/وارننگ خود چنتی ہے۔ */}
          <div className="mt-1 pt-4 border-t border-gray-200 flex flex-col gap-4">
            <div className="urdu font-bold text-[14px] text-gray-800">پرنٹر کی قسم</div>
            <div className="flex flex-col gap-2">
              {[
                { v: 'thermal', label: 'تھرمل (80mm رول)' },
                { v: 'overlay_form', label: 'اوورلے (پہلے سے چھپی پرچی — صرف لیب رسید)' }
              ].map((o) => (
                <label key={o.v} className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="radio"
                    name="print_mode"
                    className="w-4 h-4 cursor-pointer"
                    checked={form.print_mode === o.v}
                    onChange={() => commit({ ...form, print_mode: o.v })}
                  />
                  <span className="urdu text-[13px] text-gray-700">{o.label}</span>
                </label>
              ))}
            </div>

            {/* ── دو پرنٹر (تھرمل + کینن) — کمپیوٹر پر دونوں لگے ہیں؛ ہر جاب خودکار
                درست پرنٹر پر جائے۔ ایک بار منتخب کریں. */}
            <div className="flex flex-col gap-2">
              <div className="urdu font-bold text-[13px] text-gray-700">پرنٹر منتخب کریں (دو پرنٹر)</div>
              {[
                ['printer_thermal', 'تھرمل پرنٹر (رسیدیں)'],
                ['printer_canon', 'کینن پرنٹر (فارم/اوورلے)']
              ].map(([f, label]) => (
                <Row key={f} label={label}>
                  <select
                    className={`${INPUT}`}
                    value={form[f] || ''}
                    onChange={(e) => commit({ ...form, [f]: e.target.value })}
                  >
                    <option value="">— ونڈوز ڈیفالٹ —</option>
                    {printers.map((p) => (
                      <option key={p.name} value={p.name}>{p.displayName || p.name}{p.isDefault ? ' (ڈیفالٹ)' : ''}</option>
                    ))}
                  </select>
                </Row>
              ))}
              {form.print_mode === 'overlay_form' && !form.printer_canon && (
                <div className="urdu text-[11px] text-red-600">اوورلے کے لیے «کینن پرنٹر» منتخب کرنا ضروری ہے۔</div>
              )}
            </div>


            {/* ── اوورلے (پہلے سے چھپی پرچی) — LAB رسید only. VALUES ONLY over the
                pre-printed 2-up slip. Calibrate visually against the shop's own scan. */}
            {form.print_mode === 'overlay_form' && (() => {
              const ovNum = (field) => (e) => commit({ ...form, [field]: e.target.value.replace(/[^\d.\-]/g, '') })
              const coords = ovCoords()
              const sample = overlayMeta?.sample || {}
              const labels = overlayMeta?.fieldLabels || {}
              const keys = Object.keys(coords)
              return (
                <div className="flex flex-col gap-4">
                  <div className="urdu text-[11px] text-gray-500">
                    یہ صرف <b>لیب رسید</b> کے لیے ہے۔ سافٹ ویئر آپ کی پہلے سے چھپی پرچی کے خالی خانوں میں صرف
                    ویلیوز چھاپتا ہے (2 کاپیاں — بائیں گاہک، دائیں دکان). ادھار/نقد تھرمل ہی رہیں گی۔ نیچے اپنی
                    خالی پرچی کا اسکین لگا کر ہر ویلیو کو اس کے خانے پر گھسیٹیں، پھر ٹیسٹ پرنٹ نکال کر ملا لیں۔
                  </div>

                  {/* Blank-form scan */}
                  <Row label="خالی پرچی کا اسکین" alignTop>
                    <div className="flex flex-col gap-2">
                      {form.overlay_bg_path
                        ? <img src={form.overlay_bg_path} alt="scan" className="max-h-20 w-auto object-contain border border-gray-200 rounded bg-white p-1" />
                        : <span className="urdu text-[11px] text-gray-500">اسکین نہیں — کیلیبریشن کے لیے لگائیں</span>}
                      <div className="flex gap-2">
                        <label className="urdu text-[12px] font-bold text-white bg-slate-600 rounded-md px-3 py-1.5 cursor-pointer hover:bg-slate-700">
                          اسکین منتخب کریں
                          <input type="file" accept="image/*" className="hidden" onChange={onOverlayBgUpload} />
                        </label>
                        {form.overlay_bg_path && (
                          <button type="button" onClick={() => commit({ ...form, overlay_bg_path: '' })}
                            className="urdu text-[12px] font-bold text-gray-700 bg-gray-200 rounded-md px-3 py-1.5 hover:bg-gray-300">ہٹا دیں</button>
                        )}
                      </div>
                    </div>
                  </Row>

                  {/* Global geometry */}
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                    {[
                      ['overlay_offx', 'آفسیٹ X (mm)'], ['overlay_offy', 'آفسیٹ Y (mm)'],
                      ['overlay_scalex', 'اسکیل X'], ['overlay_scaley', 'اسکیل Y'],
                      ['overlay_right_dx', 'دائیں کاپی X (mm)'], ['overlay_right_dy', 'دائیں کاپی Y (mm)'],
                      ['overlay_font_pt', 'فونٹ (pt)']
                    ].map(([f, label]) => (
                      <label key={f} className="flex items-center justify-between gap-2">
                        <span className="urdu text-[12px] text-gray-700 truncate">{label}</span>
                        <input dir="ltr" inputMode="decimal" value={form[f]} onChange={ovNum(f)}
                          className={`${INPUT} w-20 py-1`} />
                      </label>
                    ))}
                  </div>

                  {/* Calibration canvas — drag each value onto its pre-printed cell */}
                  {overlayMeta ? (
                    <div className="flex flex-col gap-2">
                      <div className="urdu font-bold text-[13px] text-gray-700">کیلیبریشن (ہر ویلیو کو اس کے خانے پر گھسیٹیں)</div>
                      <div
                        ref={ovCanvasRef}
                        className="relative w-full border border-gray-400 overflow-hidden select-none"
                        style={{ aspectRatio: `${SHEET_W_MM} / ${SHEET_H_MM}`, background: form.overlay_bg_path ? `#fff url('${form.overlay_bg_path}') center/100% 100% no-repeat` : '#fafafa', touchAction: 'none' }}
                      >
                        {/* centre split guide */}
                        <div className="absolute top-0 bottom-0" style={{ left: '50%', borderLeft: '1px dashed #999' }} />
                        {keys.map((key) => {
                          const co = coords[key]; const val = sample[key]
                          if (co == null || val == null || val === '' || val === '-') return null
                          const chip = (slip, x, y) => {
                            const selected = slip === 'L' && ovSel === key
                            return (
                              <span
                                key={key + slip}
                                onPointerDown={slip === 'L' ? onChipDown(key) : undefined}
                                onClick={() => slip === 'L' && setOvSel(key)}
                                title={labels[key] || key}
                                className="absolute whitespace-nowrap px-0.5 leading-none"
                                style={{
                                  left: `${(x / SHEET_W_MM) * 100}%`, top: `${(y / SHEET_H_MM) * 100}%`,
                                  transform: 'translate(-50%,-100%)', fontSize: 9,
                                  fontWeight: 700, color: '#111',
                                  cursor: slip === 'L' ? 'move' : 'default',
                                  background: selected ? 'rgba(37,99,235,.25)' : 'rgba(255,255,0,.35)',
                                  outline: selected ? '1px solid #2563eb' : '1px solid rgba(0,0,0,.15)',
                                  opacity: slip === 'L' ? 1 : 0.55
                                }}
                              >{String(val)}</span>
                            )
                          }
                          return [
                            chip('L', Number(co.x), Number(co.y)),
                            chip('R', Number(co.x) + ovRightDX, Number(co.y) + ovRightDY)
                          ]
                        })}
                      </div>
                      {/* selected field + nudge */}
                      <div className="flex items-center justify-between gap-2">
                        <span className="urdu text-[12px] text-gray-600">
                          {ovSel ? `منتخب: ${labels[ovSel] || ovSel}` : 'ایک ویلیو منتخب کریں (کلک/ڈریگ)'}
                        </span>
                        <div className="flex items-center gap-1">
                          <button type="button" disabled={!ovSel} onClick={() => nudge(-0.5, 0)} className="w-7 h-7 border border-gray-300 rounded bg-white hover:bg-gray-100 disabled:opacity-40">◀</button>
                          <button type="button" disabled={!ovSel} onClick={() => nudge(0, -0.5)} className="w-7 h-7 border border-gray-300 rounded bg-white hover:bg-gray-100 disabled:opacity-40">▲</button>
                          <button type="button" disabled={!ovSel} onClick={() => nudge(0, 0.5)} className="w-7 h-7 border border-gray-300 rounded bg-white hover:bg-gray-100 disabled:opacity-40">▼</button>
                          <button type="button" disabled={!ovSel} onClick={() => nudge(0.5, 0)} className="w-7 h-7 border border-gray-300 rounded bg-white hover:bg-gray-100 disabled:opacity-40">▶</button>
                        </div>
                      </div>
                      <div className="urdu text-[10px] text-gray-400">پیلے چپس بائیں (گاہک) کاپی — انہیں گھسیٹیں۔ دھندلے چپس دائیں کاپی — وہ «دائیں کاپی X/Y» سے حرکت کرتے ہیں۔</div>
                    </div>
                  ) : (
                    <div className="urdu text-[12px] text-gray-500">کیلیبریشن لوڈ ہو رہی ہے…</div>
                  )}

                  <div className="flex flex-wrap items-center gap-3">
                    <button type="button" disabled={testBusy} onClick={runOverlayTest}
                      className="urdu text-[13px] font-bold text-white bg-slate-700 rounded-md px-3 py-2 hover:bg-slate-800 active:bg-slate-900 transition-colors disabled:opacity-50">
                      ٹیسٹ پرنٹ (ویلیوز)
                    </button>
                    {/* Snap the whole calibration (coords + offsets) back to the
                        hardcoded defaults — recovery if a drag goes wrong. */}
                    <button type="button" onClick={resetOverlay}
                      className="urdu text-[13px] font-bold text-gray-700 bg-gray-200 rounded-md px-3 py-2 hover:bg-gray-300 transition-colors">
                      ری سیٹ / ڈیفالٹ پر واپس
                    </button>
                    {ovMsg && <span className="urdu text-[12px] text-emerald-600 break-all">{ovMsg}</span>}
                  </div>
                </div>
              )
            })()}
          </div>

          {/* Header / terms / thermal-test belong to the THERMAL and full-form Canon
              paths (the printed slip header, the lab terms box, the thermal printer
              test). In OVERLAY mode the pre-printed slip already carries all of that,
              so hide the whole block — the fields stay in the DB and keep applying to
              thermal / full-form modes. Overlay shows ONLY scan/calibration/offset/
              font/test (above). */}
          {form.print_mode !== 'overlay_form' && (<>
          {/* ── پرچی ہیڈر — the shop identity printed at the top of every slip.
              Each field is capped (SHOP_MAX) so a long line can never overflow
              the 576-dot header box and get clipped on paper. Empty a field and
              its line vanishes — from the preview and from the printout alike. */}
          <div className="mt-1 pt-4 border-t border-gray-200 flex flex-col gap-4">
            <div className="urdu font-bold text-[14px] text-gray-800">پرچی ہیڈر (دکان کی معلومات)</div>

            {SHOP_FIELDS.map((f) => (
              <Row key={f} label={SHOP_LABEL[f]}>
                <input
                  dir={IS_PHONE(f) ? 'ltr' : 'rtl'}
                  className={`${INPUT} ${IS_PHONE(f) ? '' : 'urdu'}`}
                  value={form[f]}
                  onChange={shopField(f)}
                  maxLength={SHOP_MAX[f]}
                  inputMode={IS_PHONE(f) ? 'tel' : 'text'}
                  placeholder={IS_PHONE(f) ? '0300-0000000' : ''}
                />
              </Row>
            ))}

            {/* Live preview — the SAME buildSlipHeader() the printer uses, drawn
                from the current (unsaved) values on every keystroke, at the slip's
                real design width. White paper, black ink, so it reads as the slip.
                THERMAL MODE ONLY (overlay prints values onto a pre-printed slip). */}
            {form.print_mode === 'thermal' && (
              <div className="flex flex-col gap-2">
                <div className="urdu font-bold text-[13px] text-gray-700">پرنٹ پیش منظر</div>
                <div className="flex justify-center">
                  {/* The paper's edge (border + padding) is the OUTER box. The inner
                      box the header renders into is EXACTLY SLIP_DESIGN_W — padding
                      here would narrow it, and the preview would then wrap a long
                      line one word earlier than the printer actually does. */}
                  <div className="border border-gray-300 rounded-sm shadow-sm p-2 bg-white">
                    <div
                      ref={previewRef}
                      dir="rtl"
                      style={{ width: SLIP_DESIGN_W, background: '#fff', color: '#000' }}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ── پرچی کی شرائط — the لیب رسید terms/fee paragraph printed in a
              bordered box on lab receipts only. A paragraph, so a <textarea>.
              Clearing it removes the box from the slip (buildSlipTerms → null). */}
          <div className="mt-1 pt-4 border-t border-gray-200 flex flex-col gap-4">
            <div className="urdu font-bold text-[14px] text-gray-800">پرچی کی شرائط (لیب رسید)</div>

            <textarea
              dir="rtl"
              className={`${INPUT} urdu resize-none leading-loose`}
              rows={4}
              maxLength={400}
              value={form.slip_terms}
              onChange={termsField}
            />
            <div className="urdu text-[11px] text-gray-500">خالی چھوڑنے پر یہ باکس پرچی سے ہٹ جائے گا۔</div>

            {/* Live preview — same buildSlipTerms() the printer uses, redrawn on
                every keystroke at the slip's real design width. Empty when blank,
                matching the box vanishing from paper. THERMAL MODE ONLY (in Canon
                mode the terms show inside the colour-form preview above). */}
            {form.print_mode === 'thermal' && (
              <div className="flex flex-col gap-2">
                <div className="urdu font-bold text-[13px] text-gray-700">پرنٹ پیش منظر</div>
                <div className="flex justify-center">
                  <div className="border border-gray-300 rounded-sm shadow-sm p-2 bg-white">
                    <div
                      ref={termsPreviewRef}
                      dir="rtl"
                      style={{ width: SLIP_DESIGN_W, background: '#fff', color: '#000' }}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Direct-thermal printer test pages: calibration sheet (border, mm
              ticks, 10mm square, edge texts) + worst-case receipt. Paper-level
              proof that width/sharpness are correct on THIS shop's printer. */}
          <div className="mt-1 pt-4 border-t border-gray-200">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="urdu font-bold text-[13px] text-gray-700">پرنٹر ٹیسٹ (ڈائریکٹ تھرمل)</div>
                {testMsg
                  ? <div className="urdu text-[12px] text-emerald-600 break-all">{testMsg}</div>
                  : <div className="urdu text-[11px] text-gray-500">چوڑائی اور صفائی جانچنے کے لیے ٹیسٹ پرچی نکالیں</div>}
              </div>
              <div className="flex gap-2 shrink-0">
                <button
                  type="button"
                  disabled={testBusy}
                  onClick={() => runTest('calibration', 'کیلیبریشن')}
                  className="urdu text-[13px] font-bold text-white bg-slate-700 rounded-md px-3 py-2 hover:bg-slate-800 active:bg-slate-900 transition-colors disabled:opacity-50"
                >
                  کیلیبریشن
                </button>
                <button
                  type="button"
                  disabled={testBusy}
                  onClick={() => runTest('worstcase', 'ورسٹ کیس')}
                  className="urdu text-[13px] font-bold text-white bg-slate-700 rounded-md px-3 py-2 hover:bg-slate-800 active:bg-slate-900 transition-colors disabled:opacity-50"
                >
                  ورسٹ کیس
                </button>
              </div>
            </div>
          </div>
          </>)}

        </div>
      </div>
    </div>
  )
}
