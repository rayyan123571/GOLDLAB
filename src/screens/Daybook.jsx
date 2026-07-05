import React, { useEffect, useMemo, useState } from 'react'
import { useApp } from '../state/store.jsx'
import { fmtMoney, fmtNum } from '../logic/units.js'

const CAT_LABEL = {
  gold_sell: 'سونا فروخت (نقد)',
  gold_buy: 'سونا خرید (نقد)',
  gold_give: 'سونا دیا (ادھار)',
  gold_take: 'سونا لیا (ادھار)',
  cash_give: 'کیش دیا',
  cash_take: 'کیش لیا',
  lab_job: 'لیب کام',
  kacha_gold_take: 'کچا سونا لیا'
}

const KIND_LABEL = { cash: 'نقد', udhar: 'ادھار', lab: 'لیب' }

// 12-hour time (e.g. "12:56 PM") — rendered inside dir="ltr" cells so the
// AM/PM never flips to the wrong side of the digits in the RTL table.
const time12 = (ts) => {
  const d = new Date(ts)
  return isNaN(d) ? '-' : d.toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' })
}

// Local today as yyyy-mm-dd (toISOString would shift the date across midnight UTC).
const todayISO = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function Daybook() {
  const { setScreen, rates, hasApi } = useApp()
  const [date, setDate] = useState(rates.date || todayISO())
  const [data, setData] = useState({ txns: [], totals: { gold_in: 0, gold_out: 0, cash_in: 0, cash_out: 0 } })
  const [dates, setDates] = useState([]) // DESC (newest first) from listDates()
  const [fCat, setFCat] = useState('all')
  const [fKind, setFKind] = useState('all')
  const [fCust, setFCust] = useState('')

  useEffect(() => {
    if (!hasApi) return
    window.api.listDates().then((d) => setDates(d.map((x) => x.date)))
  }, [hasApi, data]) // refreshed with data so a just-saved day appears in nav

  useEffect(() => {
    if (!hasApi) return
    window.api.getDaybook(date).then(setData)
  }, [date, hasApi])

  // قبل / اگلا jump between dates that actually HAVE transactions. The list is
  // newest-first; ISO strings compare lexically, so plain < > works even when
  // the current date itself has no entries.
  const olderDate = useMemo(() => dates.find((d) => d < date) || null, [dates, date])
  const newerDate = useMemo(() => [...dates].reverse().find((d) => d > date) || null, [dates, date])

  // client-side filters (AND) over the loaded day
  const filtered = useMemo(() => {
    const q = fCust.trim()
    return data.txns.filter((x) =>
      (fCat === 'all' || x.category === fCat) &&
      (fKind === 'all' || x.kind === fKind) &&
      (q === '' || (x.customer_name || '').includes(q))
    )
  }, [data.txns, fCat, fKind, fCust])

  // footer totals over the CURRENTLY FILTERED rows (cards keep full-day backend totals)
  const ft = useMemo(() => {
    const s = { wazan: 0, khalis: 0, sonaDiya: 0, cashDiya: 0, qeemat: 0, cash: 0 }
    for (const x of filtered) {
      s.wazan += x.sona_wazan || 0
      s.khalis += x.khalis_sona || 0
      s.sonaDiya += x.sona_diya || 0
      s.cashDiya += x.cash_diya || 0
      s.qeemat += x.qeemat || 0
      s.cash += x.cash_amount || 0
    }
    return s
  }, [filtered])

  const t = data.totals

  const doPrint = async () => {
    // dialog print (wide table → A4/laser/PDF), NOT the silent thermal path
    if (hasApi && window.api.printPage) await window.api.printPage({ silent: false })
    else window.print()
  }

  // CSV of the VISIBLE (filtered) rows, Urdu headers, BOM so Excel decodes UTF-8.
  const doCsv = () => {
    const heads = ['وقت', 'رسید نمبر', 'قسم', 'نقد/ادھار/لیب', 'گاہک', 'سونا وزن', 'پوائنٹ', 'خالص سونا', 'سونا دیا', 'کیش دیا', 'ریٹ', 'قیمت', 'کیش']
    const esc = (v) => {
      const s = String(v ?? '')
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const lines = [heads.join(',')]
    for (const x of filtered) {
      lines.push([
        time12(x.ts), x.receipt_no ?? '', CAT_LABEL[x.category] || x.category || '',
        KIND_LABEL[x.kind] || x.kind || '', x.customer_name || '',
        x.sona_wazan || 0, x.point || 0, x.khalis_sona || 0,
        x.sona_diya || 0, x.cash_diya || 0,
        x.rate || 0, x.qeemat || 0, x.cash_amount || 0
      ].map(esc).join(','))
    }
    // leading U+FEFF (UTF-8 BOM) so Excel decodes the Urdu headers correctly
    const blob = new Blob([String.fromCharCode(0xfeff) + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `daybook-${date}.csv`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 2000)
  }

  return (
    <div dir="rtl" className="flex flex-col h-full w-full overflow-hidden bg-panel">
      {/* header bar: واپس (right in RTL) · title · ONE date picker + قبل/اگلا/آج · پرنٹ/CSV */}
      <div className="no-print flex items-center gap-2 bg-panel border-b border-line px-2 py-2 flex-wrap">
        <button className="tab tab-active urdu" onClick={() => setScreen('main')}>واپس ←</button>
        <h1 className="urdu text-lg font-bold">روزنامچہ</h1>
        <div className="flex items-center gap-1 mr-2">
          <button
            className="btn urdu disabled:opacity-40"
            title="پچھلی تاریخ جس میں اندراج ہیں"
            disabled={!olderDate}
            onClick={() => olderDate && setDate(olderDate)}
          >قبل ›</button>
          <input dir="ltr" className="inp w-36 text-center" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <button
            className="btn urdu disabled:opacity-40"
            title="اگلی تاریخ جس میں اندراج ہیں"
            disabled={!newerDate}
            onClick={() => newerDate && setDate(newerDate)}
          >‹ اگلا</button>
          <button className="btn urdu" onClick={() => setDate(todayISO())}>آج</button>
        </div>
        <div className="flex-1" />
        <button className="btn urdu" onClick={doPrint}>پرنٹ 🖨</button>
        <button className="btn" onClick={doCsv}>CSV ⬇</button>
      </div>

      {/* full-day summary cards (backend totals) — RTL order: سونا آمد سب سے دائیں */}
      <div className="no-print grid grid-cols-4 gap-2 p-2">
        <Card title="سونا آمد" value={t.gold_in ? fmtNum(t.gold_in) : '0'} unit="گرام" in1 />
        <Card title="سونا برآمد" value={t.gold_out ? fmtNum(t.gold_out) : '0'} unit="گرام" />
        <Card title="کیش آمد" value={t.cash_in ? fmtMoney(t.cash_in) : '0'} unit="روپے" in1 />
        <Card title="کیش برآمد" value={t.cash_out ? fmtMoney(t.cash_out) : '0'} unit="روپے" />
      </div>

      {/* filter bar — client-side, AND-combined, live count */}
      <div className="no-print flex items-center gap-2 px-2 pb-1 flex-wrap">
        <span className="urdu lbl">قسم:</span>
        <select className="inp w-44" value={fCat} onChange={(e) => setFCat(e.target.value)}>
          <option value="all">سب</option>
          {Object.entries(CAT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <span className="urdu lbl">نقد/ادھار/لیب:</span>
        <select className="inp w-28" value={fKind} onChange={(e) => setFKind(e.target.value)}>
          <option value="all">سب</option>
          <option value="cash">نقد</option>
          <option value="udhar">ادھار</option>
          <option value="lab">لیب</option>
        </select>
        <span className="urdu lbl">گاہک:</span>
        <input className="inp w-44 urdu" value={fCust} onChange={(e) => setFCust(e.target.value)} placeholder="نام سے تلاش" />
        <span className="urdu text-[12px] font-bold text-gray-700 mr-auto">{filtered.length} اندراجات</span>
      </div>

      {/* table region = the ONLY printable area (plus its print-only heading) */}
      <div className="print-area flex-1 overflow-auto px-2 pb-2">
        <div className="hidden print:block urdu text-center font-bold text-[16px] pb-1">
          روزنامچہ — {date}
          <span className="text-[12px] font-normal mr-3">
            (سونا آمد {fmtNum(t.gold_in)} · سونا برآمد {fmtNum(t.gold_out)} · کیش آمد {fmtMoney(t.cash_in)} · کیش برآمد {fmtMoney(t.cash_out)})
          </span>
        </div>
        <table dir="rtl" className="w-full text-[12px] border border-line bg-white border-collapse">
          <thead>
            <tr className="urdu">
              <Th w="w-[72px]">وقت</Th>
              <Th w="w-[64px]">رسید نمبر</Th>
              <Th w="w-[150px]">قسم</Th>
              <Th>گاہک</Th>
              <Th w="w-[76px]">سونا وزن</Th>
              <Th w="w-[56px]">پوائنٹ</Th>
              <Th w="w-[80px]">خالص سونا</Th>
              <Th w="w-[76px]">سونا دیا</Th>
              <Th w="w-[84px]">کیش دیا</Th>
              <Th w="w-[84px]">ریٹ</Th>
              <Th w="w-[92px]">قیمت</Th>
              <Th w="w-[92px]">کیش</Th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={12} className="text-center urdu py-4 text-gray-500">
                {data.txns.length === 0 ? 'اس دن کوئی لین دین نہیں' : 'اس فلٹر پر کوئی اندراج نہیں'}
              </td></tr>
            )}
            {filtered.map((x) => (
              <tr key={x.id} className="border-b border-gray-200 odd:bg-white even:bg-gray-50 hover:bg-amber-50">
                <Num>{time12(x.ts)}</Num>
                <Num>{x.receipt_no || '-'}</Num>
                <td className="px-1 py-[3px] text-center">
                  <span className={`urdu inline-block text-[10px] leading-tight border rounded px-1.5 py-[1px] ${
                    x.direction === 'in'
                      ? 'text-green-700 border-green-300 bg-green-50'
                      : x.direction === 'out'
                        ? 'text-rose-700 border-rose-300 bg-rose-50'
                        : 'text-gray-700 border-gray-300 bg-gray-50'}`}>
                    {CAT_LABEL[x.category] || x.category}
                  </span>
                </td>
                <td className="px-1 urdu text-center">{x.customer_name || '-'}</td>
                <Num>{x.sona_wazan ? fmtNum(x.sona_wazan) : '-'}</Num>
                <Num>{x.point ? fmtNum(x.point, 0) : '-'}</Num>
                <Num>{x.khalis_sona ? fmtNum(x.khalis_sona) : '-'}</Num>
                <Num>{x.sona_diya ? fmtNum(x.sona_diya) : '-'}</Num>
                <Num>{x.cash_diya ? fmtMoney(x.cash_diya) : '-'}</Num>
                <Num>{x.rate ? fmtMoney(x.rate) : '-'}</Num>
                <Num>{x.qeemat ? fmtMoney(x.qeemat) : '-'}</Num>
                <Num>{x.cash_amount ? fmtMoney(x.cash_amount) : '-'}</Num>
              </tr>
            ))}
          </tbody>
          {/* sticky footer: totals of the CURRENTLY FILTERED rows */}
          <tfoot>
            <tr>
              <Tf colSpan={4} cls="urdu justify-end pl-2">میزان (فلٹر شدہ {filtered.length} اندراجات)</Tf>
              <Tf num>{ft.wazan ? fmtNum(ft.wazan) : '-'}</Tf>
              <Tf />
              <Tf num>{ft.khalis ? fmtNum(ft.khalis) : '-'}</Tf>
              <Tf num>{ft.sonaDiya ? fmtNum(ft.sonaDiya) : '-'}</Tf>
              <Tf num>{ft.cashDiya ? fmtMoney(ft.cashDiya) : '-'}</Tf>
              <Tf />
              <Tf num>{ft.qeemat ? fmtMoney(ft.qeemat) : '-'}</Tf>
              <Tf num>{ft.cash ? fmtMoney(ft.cash) : '-'}</Tf>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}

// sticky header cell — sticky must sit on th (not thead) to survive scrolling;
// solid bg-header (via .hdr) stops rows bleeding through.
function Th({ children, w = '' }) {
  return <th className={`hdr sticky top-0 z-10 ${w}`}>{children}</th>
}

// numeric cell: value stays an LTR run so decimals/minus/AM-PM never mirror.
function Num({ children }) {
  return <td dir="ltr" className="px-1 text-center tabular-nums whitespace-nowrap">{children}</td>
}

// sticky totals cell
function Tf({ children, num, colSpan, cls = '' }) {
  return (
    <td dir={num ? 'ltr' : undefined} colSpan={colSpan}
      className={`hdr sticky bottom-0 z-10 font-bold ${num ? 'tabular-nums text-center' : ''} ${cls}`}>
      {children ?? ''}
    </td>
  )
}

function Card({ title, value, unit, in1 }) {
  return (
    <div className={`border border-line bg-white p-2 text-center border-r-4 ${in1 ? 'border-r-green-600' : 'border-r-rose-600'} min-h-[58px] flex flex-col justify-center`}>
      <div className={`urdu text-[11px] font-bold ${in1 ? 'text-green-700' : 'text-rose-700'}`}>{title}</div>
      <div dir="ltr" className="text-lg font-bold tabular-nums leading-tight">
        {value} <span className="urdu text-[11px] font-normal text-gray-600">{unit}</span>
      </div>
    </div>
  )
}
