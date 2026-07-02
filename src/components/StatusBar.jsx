import React, { useState } from 'react'
import { useApp } from '../state/store.jsx'
import { fmtMoney, fmtNum } from '../logic/units.js'
import DefaultsForm from './DefaultsForm.jsx'

export default function StatusBar() {
  const { totals, resetEntry, loadReceipt, kachaDisplay, resetKachaDisplay, cashDisplay } = useApp()
  const [search, setSearch] = useState('')
  const [searchMsg, setSearchMsg] = useState('')
  const [showDefaults, setShowDefaults] = useState(false)
  const [showKachaConfirm, setShowKachaConfirm] = useState(false) // کچا سونا reset gate

  // Look up a saved receipt by its number. Wired defensively: if the Electron
  // backend hasn't added a getReceiptByNo handler yet, warn (console) and show a
  // graceful "not found" message instead of crashing.
  // Look up a saved receipt by its number, triggered by pressing Enter in the
  // رسید نمبر field. Empty → do nothing; non-numeric → Urdu error; a number with
  // no saved receipt → "does not exist" error; a match → load it via loadReceipt.
  const doSearch = async () => {
    const raw = String(search).trim()
    if (!raw) { setSearchMsg(''); return } // empty — gentle no-op
    if (!/^\d+$/.test(raw)) { setSearchMsg('صرف نمبر لکھیں'); return }
    const n = Number(raw)
    setSearchMsg('')
    const fn = window.api && window.api.getReceiptByNo
    if (typeof fn !== 'function') { setSearchMsg('یہ رسید نمبر موجود نہیں'); return }
    try {
      const data = await fn(n)
      if (!data) { setSearchMsg('یہ رسید نمبر موجود نہیں'); return }
      loadReceipt(data)
      setSearchMsg('')
    } catch (e) {
      console.warn('Receipt lookup failed:', e)
      setSearchMsg('یہ رسید نمبر موجود نہیں')
    }
  }

  return (
    <div dir="rtl" className="flex items-stretch gap-1 px-1 py-1 bg-panel border-t border-line h-[40px]">
      {/* live shop totals on the RIGHT — 3 boxes: کیش | کچا سونا | تیزابی */}
      <div className="flex items-stretch gap-3">
        <div className="flex items-stretch gap-2">
          <div className="urdu flex items-center px-1 text-[15px] font-bold">کیش</div>
          {/* dir=ltr so a negative renders standard "-25,000" (minus on the LEFT). */}
          <div dir="ltr" className="status-green flex items-center justify-center px-3 min-w-[175px] text-[18px] font-bold whitespace-nowrap">{fmtMoney(cashDisplay)}</div>
        </div>

        <div className="flex items-stretch gap-1">
          <div className="urdu flex items-center px-1 text-[15px] font-bold">کچا سونا</div>
          <div className="status-green flex items-center justify-center px-3 min-w-[120px] text-[18px] font-bold whitespace-nowrap">{fmtNum(kachaDisplay, 3)}</div>
          {/* DISPLAY-ONLY reset: asks to confirm first, then zeros the on-screen
              number only; DB/report untouched. */}
          <button
            type="button"
            onClick={() => setShowKachaConfirm(true)}
            title="صرف اسکرین پر صفر — ریکارڈ محفوظ رہے گا (screen reset only, record stays safe)"
            className="self-center flex items-center justify-center w-6 h-[26px] rounded border border-gray-300 bg-white text-gray-600 text-[14px] leading-none hover:bg-gray-100 active:bg-gray-200 transition-colors"
          >
            ↺
          </button>
        </div>

        <div className="flex items-stretch gap-2">
          <div className="urdu flex items-center px-1 text-[15px] font-bold">تیزابی</div>
          <div className="status-green flex items-center justify-center px-3 min-w-[130px] text-[18px] font-bold whitespace-nowrap">{fmtNum(totals.tezabi_sona, 3)}</div>
        </div>
      </div>

      <div className="flex-1" />

      {/* receipt search on the LEFT (replaces the old 1..U buttons) */}
      <div className="flex items-center gap-1.5">
        <input
          className="self-center h-[26px] w-[120px] px-3 rounded-md border border-gray-300 bg-white text-[13px] font-semibold text-center outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
          inputMode="numeric"
          placeholder="رسید نمبر"
          title="رسید نمبر لکھ کر Enter دبائیں — type a receipt no. and press Enter"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') doSearch() }}
        />
        {searchMsg && <span className="urdu text-[10px] text-red-600 whitespace-nowrap px-1">{searchMsg}</span>}
      </div>
      <button
        type="button"
        onClick={resetEntry}
        className="self-center flex items-center px-4 h-[26px] rounded-md bg-emerald-600 text-white text-[12px] font-bold urdu shadow-sm hover:bg-emerald-700 active:bg-emerald-800 focus:outline-none focus:ring-2 focus:ring-emerald-400 transition-colors"
      >
        رسید نکالیں
      </button>
      <button
        type="button"
        title="ڈیفالٹ سیٹنگز"
        onClick={() => setShowDefaults(true)}
        className="self-center flex items-center gap-1.5 px-3 h-[26px] rounded-md bg-blue-600 text-white text-[12px] font-bold shadow-sm hover:bg-blue-700 active:bg-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-400 transition-colors"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
        </svg>
        Defaults
      </button>

      <DefaultsForm open={showDefaults} onClose={() => setShowDefaults(false)} />

      {/* کچا سونا reset confirmation — display-only; gates the click. */}
      {showKachaConfirm && (
        <div
          className="fixed inset-0 z-[70] bg-black/50 flex items-center justify-center p-4"
          onClick={() => setShowKachaConfirm(false)}
        >
          <div
            dir="rtl"
            className="bg-white rounded-lg shadow-2xl w-[360px] max-w-[92vw] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="urdu font-bold text-[15px] text-gray-800 bg-slate-100 border-b border-gray-200 px-4 py-2.5">
              کچا سونا صفر کریں؟
            </div>
            <div className="px-4 py-4 flex flex-col gap-2">
              <p className="urdu text-[14px] text-gray-800">کیا آپ کچا سونا کاؤنٹر صفر کرنا چاہتے ہیں؟</p>
              <p className="urdu text-[12px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-1.5">
                یہ صرف اسکرین کا نمبر صفر کرے گا — ریکارڈ محفوظ رہے گا
              </p>
            </div>
            <div className="flex gap-2 px-4 py-3 border-t border-gray-200 bg-gray-50">
              <button
                type="button"
                onClick={() => { resetKachaDisplay(); setShowKachaConfirm(false) }}
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
