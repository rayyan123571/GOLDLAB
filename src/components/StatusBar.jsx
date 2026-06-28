import React from 'react'
import { useApp } from '../state/store.jsx'
import { fmtMoney, fmtNum } from '../logic/units.js'

export default function StatusBar() {
  const { totals, resetEntry } = useApp()
  return (
    <div dir="rtl" className="flex items-stretch gap-1 px-1 py-1 bg-panel border-t border-line h-[34px]">
      {/* live shop totals on the RIGHT — 4 boxes: کیش | پرچون | پیں | تیزابی سونا */}
      <div className="flex items-stretch gap-1">
        <div className="urdu flex items-center px-1 text-[11px]">دکان میں موجود کیش</div>
        <div className="status-green px-3 min-w-[130px]">{fmtMoney(totals.cash)}</div>

        <div className="urdu flex items-center px-1 text-[11px]">دکان میں موجود پرچون</div>
        <div className="status-green px-3 min-w-[110px]">{fmtNum(totals.parchun, 3)}</div>

        <div className="urdu flex items-center px-1 text-[11px]">دکان میں موجود پیں</div>
        <div className="status-green px-3 min-w-[110px]">{fmtNum(totals.pin, 3)}</div>

        <div className="urdu flex items-center px-1 text-[11px]">دکان میں موجود تیزابی سونا</div>
        <div className="status-green px-3 min-w-[130px]">{fmtNum(totals.tezabi_sona, 3)}</div>
      </div>

      <div className="flex-1" />

      {/* controls on the LEFT */}
      <div className="flex">
        {['1', '2', '3', '4', '6', 'S', 'U'].map((b) => (
          <button key={b} className="btn px-2">{b}</button>
        ))}
      </div>
      <button className="btn urdu" onClick={resetEntry}>رسید نکالیں</button>
      <button className="btn font-bold">Defaults</button>
      <button className="btn" title="ترتیبات">⚙</button>
    </div>
  )
}
