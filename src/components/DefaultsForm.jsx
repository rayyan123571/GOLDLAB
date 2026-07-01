import React, { useEffect, useRef, useState } from 'react'
import { useApp } from '../state/store.jsx'

const INPUT =
  'w-full bg-white border border-gray-300 rounded-md text-[14px] leading-relaxed ' +
  'px-3 py-2 text-start tabular-nums cursor-text transition-colors ' +
  'focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500'

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
  const [form, setForm] = useState({ rate_tezabi_tola: '', fc_per_gram: '', parchi_charges: '', slip_count: '1' })
  const [saved, setSaved] = useState(false)
  const savedTimer = useRef(null)
  const saveTimer = useRef(null)

  // Load current values from the DB (fall back to the store's rates) on open.
  useEffect(() => {
    if (!open) return
    setSaved(false)
    let cancelled = false
    const seed = (r) => {
      const src = r || rates || {}
      if (cancelled) return
      setForm({
        rate_tezabi_tola: src.rate_tezabi_tola ?? '',
        fc_per_gram: src.fc_per_gram ?? '',
        parchi_charges: src.parchi_charges ?? '',
        slip_count: src.slip_count != null ? String(src.slip_count) : '1'
      })
    }
    if (hasApi) window.api.getRates().then(seed)
    else seed(rates)
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => () => {
    if (savedTimer.current) clearTimeout(savedTimer.current)
    if (saveTimer.current) clearTimeout(saveTimer.current)
  }, [])

  if (!open) return null

  // Persist the given form snapshot to the DB + store, and flash the saved tick.
  const persist = async (next) => {
    await saveRates({
      rate_tezabi_tola: Number(next.rate_tezabi_tola) || 0,
      fc_per_gram: Number(next.fc_per_gram) || 0,
      parchi_charges: Number(next.parchi_charges) || 0,
      slip_count: Math.max(1, parseInt(next.slip_count, 10) || 1)
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

        {/* Body */}
        <div className="p-5 flex flex-col gap-4">
          <Row label="ریٹ">
            <input className={INPUT} value={form.rate_tezabi_tola} onChange={numField('rate_tezabi_tola')} inputMode="decimal" placeholder="0" />
          </Row>

          <Row label="چارجز فی گرام">
            <input className={INPUT} value={form.fc_per_gram} onChange={numField('fc_per_gram')} inputMode="decimal" placeholder="0" />
          </Row>

          <Row label="چارج پرچی">
            <input className={INPUT} value={form.parchi_charges} onChange={numField('parchi_charges')} inputMode="decimal" placeholder="0" />
          </Row>

          <Row label="سلپ پرنٹ">
            <input
              className={`${INPUT} w-28`}
              value={form.slip_count}
              onChange={onSlip}
              inputMode="numeric"
              min={1}
              placeholder="1"
            />
          </Row>
        </div>
      </div>
    </div>
  )
}
