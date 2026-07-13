import React, { useEffect, useRef, useState } from 'react'
import { useApp } from '../state/store.jsx'
import { buildSlipHeader, SHOP_FIELDS, SLIP_DESIGN_W } from '../logic/slipHeader.js'

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
    shop_name: '', shop_tagline: '', shop_owner: '', shop_phone1: '', shop_phone2: '', shop_phone3: '', shop_address: ''
  })
  const [saved, setSaved] = useState(false)
  const [testMsg, setTestMsg] = useState('')
  const [testBusy, setTestBusy] = useState(false)
  const savedTimer = useRef(null)
  const saveTimer = useRef(null)
  const previewRef = useRef(null)

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
        ...shop
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

  useEffect(() => () => {
    if (savedTimer.current) clearTimeout(savedTimer.current)
    if (saveTimer.current) clearTimeout(saveTimer.current)
  }, [])

  if (!open) return null

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
      ...shop
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
                real design width. White paper, black ink, so it reads as the slip. */}
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

        </div>
      </div>
    </div>
  )
}
