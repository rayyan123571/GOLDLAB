import React from 'react'
import { useApp } from '../state/store.jsx'

function RateField({ label, value, onChange, w = 'w-20', numeric }) {
  // Numeric rate fields display with thousand separators (9000 -> 9,000) while
  // storing the raw digits; the date field passes numeric={false}.
  const disp =
    numeric && value !== '' && value != null && !isNaN(Number(String(value).replace(/,/g, '')))
      ? Number(String(value).replace(/,/g, '')).toLocaleString('en-US')
      : value ?? ''
  return (
    <div className="flex items-stretch">
      <div className="hdr urdu px-2 whitespace-nowrap">{label}</div>
      <input
        className={`inp text-center ${w}`}
        value={disp}
        onChange={(e) => onChange(numeric ? e.target.value.replace(/,/g, '') : e.target.value)}
      />
    </div>
  )
}

export default function TopBar() {
  const { rates, saveRates, setScreen } = useApp()

  const upd = (k) => (v) => saveRates({ [k]: v })

  // Display date as dd/mm/yyyy from yyyy-mm-dd
  const dispDate = (() => {
    const p = String(rates.date || '').split('-')
    return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : rates.date
  })()

  const onDate = (v) => {
    const p = String(v).split('/')
    if (p.length === 3) saveRates({ date: `${p[2]}-${p[1]}-${p[0]}` })
    else saveRates({ date: v })
  }

  return (
    <div dir="rtl" className="flex items-stretch gap-1 bg-panel border-b border-line px-1 py-1 h-[46px] relative">
      {/* tiny tola->gram constant printed at the very top in the screenshot */}
      <div className="absolute right-1/2 -top-[0px] text-[9px] text-gray-500">11.664</div>

      {/* Tabs (right-most in RTL) */}
      <div className="flex items-stretch">
        <button className="tab urdu" onClick={() => setScreen('daybook')}>
          روزنامچہ
        </button>
        <button className="tab tab-active urdu" onClick={() => setScreen('main')}>
          لیب
        </button>
        <button className="tab urdu" onClick={() => setScreen('udhar')}>
          ادھار
        </button>
      </div>

      {/* wide free name box */}
      <input className="inp flex-1 min-w-[120px]" />

      <RateField label="فی گرام چار جز" value={rates.fc_per_gram} onChange={upd('fc_per_gram')} w="w-12" numeric />
      <RateField label="پرچی چار جز" value={rates.parchi_charges} onChange={upd('parchi_charges')} w="w-12" numeric />
      <RateField label="ریٹ تیزابی فی گرام" value={rates.rate_tezabi_gram} onChange={upd('rate_tezabi_gram')} w="w-16" numeric />
      <RateField label="ریٹ تیزابی فی تولہ" value={rates.rate_tezabi_tola} onChange={upd('rate_tezabi_tola')} w="w-20" numeric />
      <RateField label="تاریخ" value={dispDate} onChange={onDate} w="w-24" />

      <button className="bg-redX text-white font-bold w-7 flex items-center justify-center border border-line">
        X
      </button>
    </div>
  )
}
