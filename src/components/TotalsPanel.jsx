import React, { useState } from 'react'
import { useApp } from '../state/store.jsx'
import { fmtMoney, fmtNum } from '../logic/units.js'

// ٹوٹل — the live shop totals that used to sit on the RIGHT of the bottom bar,
// moved behind a top-bar button. PURE RELOCATION: the boxes, their values, their
// formatting and their red/green rule are the SAME code that ran in StatusBar —
// `totals` still comes straight from the store (getShopTotals()'s result
// wholesale, calculated in electron/db.cjs) and `cashDisplay` straight from the
// store. Nothing is computed here, exactly as nothing was computed there.
//
// `onChangePin` (optional) opens the PIN تبدیل کریں flow — the ONLY addition the
// pin gate makes to this component. The totals body below is untouched.
export default function TotalsPanel({ open, onClose, onChangePin }) {
  const { totals, resetKachaCounter, cashDisplay } = useApp()
  const [showKachaConfirm, setShowKachaConfirm] = useState(false) // کچا سونا reset gate

  // A negative value turns the box BACKGROUND red (text stays the class's white —
  // best contrast, colorblind-safe); zero/positive falls back to the
  // .status-green class's green. Inline style beats the class regardless of
  // Tailwind layer order. Condition on the RAW number, never the formatted
  // string. (Verbatim from the old bottom bar.)
  const negStyle = (v) => ({ backgroundColor: Number(v) < 0 ? '#dc2626' : undefined })

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/50 flex items-start justify-center p-4 pt-[10vh]"
      onClick={onClose}
    >
      <div
        dir="rtl"
        className="relative bg-gray-50 border border-gray-300 rounded-lg shadow-2xl w-[560px] max-w-[95vw] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Title bar */}
        <div className="flex items-center justify-between bg-gradient-to-b from-slate-100 to-slate-200 border-b border-gray-300 px-4 py-2.5">
          <h2 className="urdu font-bold text-[16px] text-gray-800">ٹوٹل</h2>
          <div className="flex items-center gap-2">
            {onChangePin && (
              <button
                type="button"
                onClick={onChangePin}
                title="پن تبدیل کریں"
                className="urdu flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 text-[12px] font-bold text-white shadow-sm hover:bg-slate-900 active:bg-black transition-colors"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                  <rect x="4" y="10" width="16" height="10" rx="2.5" />
                  <path d="M8 10V7a4 4 0 0 1 8 0v3" />
                </svg>
                PIN تبدیل کریں
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              title="بند کریں"
              className="w-7 h-7 flex items-center justify-center rounded-md text-gray-600 hover:bg-red-500 hover:text-white transition-colors"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Body — ONE grid for all three items, two tracks: [label][value bar].
            Every label lines up down the right edge (RTL start), every bar gets
            the SAME width from the 1fr track, and gap-y keeps the rows apart. The
            old per-row min-widths are gone because the track now sets the width. */}
        <div className="px-7 py-6">
          <div className="grid grid-cols-[130px_1fr] gap-x-5 gap-y-3.5 items-center">
            <div className="urdu text-[15px] font-bold whitespace-nowrap">کیش</div>
            {/* dir=ltr so a negative renders standard "-25,000" (minus on the LEFT). */}
            <div dir="ltr" style={negStyle(cashDisplay)} className="status-green h-[46px] flex items-center justify-center px-4 text-[19px] font-bold whitespace-nowrap">{fmtMoney(cashDisplay)}</div>

            <div className="urdu text-[15px] font-bold whitespace-nowrap">کچا سونا</div>
            {/* The ↺ counter reset sits INSIDE this row's bar track, so the bar
                stays the same width as the other two and stays aligned. */}
            <div className="flex items-center gap-2">
              <div dir="ltr" style={negStyle(totals.kacha_sona)} className="status-green flex-1 h-[46px] flex items-center justify-center px-4 text-[19px] font-bold whitespace-nowrap">{fmtNum(totals.kacha_sona, 3)}</div>
              {/* Reset ONLY this کچا سونا COUNTER to 0. Records are KEPT —
                  the اُدھار report's کچا سونا لیا stays intact (baseline offset). */}
              <button
                type="button"
                onClick={() => setShowKachaConfirm(true)}
                title="کچا سونا کاؤنٹر صفر کریں (ریکارڈ محفوظ رہے گا)"
                className="flex items-center justify-center w-8 h-8 rounded-md border border-gray-300 bg-white text-gray-600 text-[15px] leading-none hover:bg-gray-100 active:bg-gray-200 transition-colors"
              >
                ↺
              </button>
            </div>

            <div className="urdu text-[15px] font-bold whitespace-nowrap">تیزابی</div>
            <div dir="ltr" style={negStyle(totals.tezabi_sona)} className="status-green h-[46px] flex items-center justify-center px-4 text-[19px] font-bold whitespace-nowrap">{fmtNum(totals.tezabi_sona, 3)}</div>
          </div>
        </div>
      </div>

      {/* کچا سونا COUNTER reset confirmation — zeroes the counter only,
          کچا سونا لیا records are KEPT (اُدھار report stays intact). */}
      {showKachaConfirm && (
        <div
          className="fixed inset-0 z-[80] bg-black/50 flex items-center justify-center p-4"
          onClick={(e) => { e.stopPropagation(); setShowKachaConfirm(false) }}
        >
          <div
            dir="rtl"
            className="bg-white rounded-lg shadow-2xl w-[360px] max-w-[92vw] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="urdu font-bold text-[15px] text-gray-800 bg-slate-100 border-b border-gray-200 px-4 py-2.5">
              کچا سونا کاؤنٹر صفر کریں؟
            </div>
            <div className="px-4 py-4 flex flex-col gap-2">
              <p className="urdu text-[14px] text-gray-800">کیا آپ کچا سونا ٹوٹل صفر کرنا چاہتے ہیں؟</p>
              <p className="urdu text-[12px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-1.5">
                صرف کاؤنٹر صفر ہوگا — کوئی ریکارڈ حذف نہیں ہوگا، اُدھار فارم میں کچا سونا لیا کا ریکارڈ محفوظ رہے گا
              </p>
            </div>
            <div className="flex gap-2 px-4 py-3 border-t border-gray-200 bg-gray-50">
              <button
                type="button"
                onClick={() => { resetKachaCounter(); setShowKachaConfirm(false) }}
                className="urdu flex-1 rounded-md bg-rose-600 text-white text-[14px] font-bold py-2 hover:bg-rose-700 active:bg-rose-800 transition-colors"
              >
                ہاں
              </button>
              <button
                type="button"
                onClick={() => setShowKachaConfirm(false)}
                className="urdu rounded-md border border-gray-300 bg-white text-gray-700 text-[14px] font-bold px-5 py-2 hover:bg-gray-100 transition-colors"
              >
                نہیں
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
