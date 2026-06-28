import React, { useEffect, useState } from 'react'
import { useApp } from '../state/store.jsx'
import { fmtMoney, fmtNum } from '../logic/units.js'

const CAT_LABEL = {
  gold_sell: 'سونا فروخت (نقد)',
  gold_buy: 'سونا خرید (نقد)',
  gold_give: 'سونا دیا (ادھار)',
  gold_take: 'سونا لیا (ادھار)',
  cash_give: 'کیش دیا',
  cash_take: 'کیش لیا',
  lab_job: 'لیب کام'
}

export default function Daybook() {
  const { setScreen, rates, hasApi } = useApp()
  const [date, setDate] = useState(rates.date)
  const [data, setData] = useState({ txns: [], totals: { gold_in: 0, gold_out: 0, cash_in: 0, cash_out: 0 } })
  const [dates, setDates] = useState([])

  useEffect(() => {
    if (!hasApi) return
    window.api.listDates().then((d) => setDates(d.map((x) => x.date)))
  }, [hasApi])

  useEffect(() => {
    if (!hasApi) return
    window.api.getDaybook(date).then(setData)
  }, [date, hasApi])

  const t = data.totals

  return (
    <div className="flex flex-col h-full w-full overflow-hidden bg-panel">
      <div className="flex items-center gap-2 bg-panel border-b border-line px-2 py-2">
        <button className="tab tab-active urdu" onClick={() => setScreen('main')}>← واپس</button>
        <h1 className="urdu text-lg font-bold">روزنامچہ — Daily Ledger</h1>
        <div className="flex-1" />
        <span className="urdu">تاریخ:</span>
        <input className="inp w-40" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        {dates.length > 0 && (
          <select className="inp w-40" value={date} onChange={(e) => setDate(e.target.value)}>
            {dates.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        )}
      </div>

      {/* summary cards */}
      <div className="grid grid-cols-4 gap-2 p-2">
        <Card title="سونا آمد (in)" value={fmtNum(t.gold_in)} unit="گرام" />
        <Card title="سونا برآمد (out)" value={fmtNum(t.gold_out)} unit="گرام" />
        <Card title="کیش آمد" value={fmtMoney(t.cash_in)} />
        <Card title="کیش برآمد" value={fmtMoney(t.cash_out)} />
      </div>

      {/* table */}
      <div className="flex-1 overflow-auto px-2 pb-2">
        <table className="w-full text-[12px] border border-line bg-white">
          <thead className="bg-header sticky top-0">
            <tr className="urdu">
              <th className="hdr">وقت</th>
              <th className="hdr">قسم</th>
              <th className="hdr">گاہک</th>
              <th className="hdr">سونا وزن</th>
              <th className="hdr">پوائنٹ</th>
              <th className="hdr">خالص سونا</th>
              <th className="hdr">ریٹ</th>
              <th className="hdr">قیمت</th>
              <th className="hdr">کیش</th>
            </tr>
          </thead>
          <tbody>
            {data.txns.length === 0 && (
              <tr><td colSpan={9} className="text-center urdu py-4 text-gray-500">اس دن کوئی لین دین نہیں</td></tr>
            )}
            {data.txns.map((x) => (
              <tr key={x.id} className="border-b border-gray-200">
                <td className="px-1 text-center">{new Date(x.ts).toLocaleTimeString()}</td>
                <td className="px-1 urdu text-center">{CAT_LABEL[x.category] || x.category}</td>
                <td className="px-1 urdu text-center">{x.customer_name || '-'}</td>
                <td className="px-1 text-center">{fmtNum(x.sona_wazan)}</td>
                <td className="px-1 text-center">{fmtNum(x.point, 0)}</td>
                <td className="px-1 text-center">{fmtNum(x.khalis_sona)}</td>
                <td className="px-1 text-center">{x.rate ? fmtMoney(x.rate) : '-'}</td>
                <td className="px-1 text-center">{x.qeemat ? fmtMoney(x.qeemat) : '-'}</td>
                <td className="px-1 text-center">{x.cash_amount ? fmtMoney(x.cash_amount) : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Card({ title, value, unit }) {
  return (
    <div className="border border-line bg-white p-2 text-center">
      <div className="urdu text-[11px] text-gray-600">{title}</div>
      <div className="text-lg font-bold">{value} <span className="urdu text-[11px]">{unit}</span></div>
    </div>
  )
}
