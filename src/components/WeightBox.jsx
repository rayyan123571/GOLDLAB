import React from 'react'
import { useApp } from '../state/store.jsx'
import { gramsToTMR, fmtNum } from '../logic/units.js'

// Top-left scale-entry box. Column order (left -> right):
//   <row label> | (گرام) | تولہ | ماشہ | رتی
function WeightRow({ label, grams, onGrams }) {
  const tmr = gramsToTMR(grams)
  return (
    <div className="flex" dir="ltr">
      <div className="hdr urdu w-28 justify-end pr-1 text-[11px]">{label}</div>
      <input
        className="inp text-center w-24 bg-mint"
        value={grams ?? ''}
        onChange={(e) => onGrams(e.target.value)}
        placeholder="0"
      />
      <div className="cell cell-c w-12">{fmtNum(tmr.tola, 0)}</div>
      <div className="cell cell-c w-12">{fmtNum(tmr.masha, 0)}</div>
      <div className="cell cell-c w-12">{fmtNum(tmr.ratti, 2)}</div>
    </div>
  )
}

export default function WeightBox() {
  const { input, setInput } = useApp()
  return (
    <div dir="ltr" className="border border-line bg-white self-start">
      <div className="flex">
        <div className="hdr w-28"> </div>
        <div className="hdr urdu w-24">(گرام)</div>
        <div className="hdr urdu w-12">تولہ</div>
        <div className="hdr urdu w-12">ماشہ</div>
        <div className="hdr urdu w-12">رتی</div>
      </div>
      <WeightRow
        label="وزن کنڈے پر"
        grams={input.wazan}
        onGrams={(v) => setInput((s) => ({ ...s, wazan: v }))}
      />
      <WeightRow
        label="وزن پانی میں"
        grams={input.malawat}
        onGrams={(v) => setInput((s) => ({ ...s, malawat: v }))}
      />
    </div>
  )
}
