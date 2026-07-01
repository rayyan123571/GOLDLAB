import React, { useEffect } from 'react'
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
      <div className="hdr urdu px-2 whitespace-nowrap text-[15px] font-bold">{label}</div>
      <input
        className={`inp text-center ${w} text-[17px] font-bold leading-none`}
        value={disp}
        onChange={(e) => onChange(numeric ? e.target.value.replace(/,/g, '') : e.target.value)}
      />
    </div>
  )
}

export default function TopBar() {
  const { rates, saveRates, setScreen, openUdhar, closeUdhar, openAkhrajat, closeAkhrajat, screen, udharOpen, akhrajatOpen } = useApp()

  // Exactly one tab is active at a time. ادھار / اخراجات are modals, so an open
  // modal wins the highlight; otherwise لیب = 'main', روزنامچہ = 'daybook'.
  const anyModal = udharOpen || akhrajatOpen
  const active = {
    daybook: screen === 'daybook' && !anyModal,
    lab: screen === 'main' && !anyModal,
    udhar: udharOpen,
    akhrajat: akhrajatOpen
  }
  // Active = green (tab-active). Inactive tabs get a subtle, lighter hover tint
  // (distinct from the active green) so they read as clickable.
  const tabCls = (isActive) => `tab urdu text-[16px] font-bold ${isActive ? 'tab-active' : 'hover:from-emerald-100 hover:to-emerald-200'}`
  const goLab = () => { closeUdhar(); closeAkhrajat(); setScreen('main') }
  const goDaybook = () => { closeUdhar(); closeAkhrajat(); setScreen('daybook') }

  // The تاریخ field stays an editable, persisted receipt date. Default it to
  // today's live date on mount only when it's empty, so a chosen date is kept.
  useEffect(() => {
    if (!rates.date) {
      const d = new Date()
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      saveRates({ date: iso })
    }
  }, [])

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
        <button className={tabCls(active.daybook)} onClick={goDaybook}>
          روزنامچہ
        </button>
        <button className={tabCls(active.lab)} onClick={goLab}>
          لیب
        </button>
        <button className={tabCls(active.udhar)} onClick={openUdhar}>
          ادھار
        </button>
        <button className={tabCls(active.akhrajat)} onClick={openAkhrajat}>
          اخراجات
        </button>
      </div>

      {/* wide free name box */}
      <input className="inp flex-1 min-w-[120px]" />

      <RateField label="ریٹ تیزابی فی تولہ" value={rates.rate_tezabi_tola} onChange={upd('rate_tezabi_tola')} w="w-28" numeric />
      <RateField label="تاریخ" value={dispDate} onChange={onDate} w="w-32" />

      <button className="bg-redX text-white font-bold w-7 flex items-center justify-center border border-line">
        X
      </button>
    </div>
  )
}
