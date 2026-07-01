import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../state/store.jsx'
import { fmtMoney, fmtNum, gramsToTMR } from '../logic/units.js'

// ─── Report buttons, three groups. flow 'in' = INTO shop (green), 'out' = OUT (red)
const GROUP1 = [
  { label: 'تیزابی لینا ہے', flow: 'in', category: 'gold_take', kind: 'gold' },
  { label: 'تیزابی دینا ہے', flow: 'out', category: 'gold_give', kind: 'gold' },
  { label: 'رقم لینی ہے', flow: 'in', category: 'cash_take', kind: 'cash' },
  { label: 'رقم دینی ہے', flow: 'out', category: 'cash_give', kind: 'cash' }
]
const GROUP2 = [
  { label: 'آج کی ادھار رقم دی', flow: 'out', category: 'cash_give', kind: 'cash' },
  { label: 'آج کی ادھار رقم آمد', flow: 'in', category: 'cash_take', kind: 'cash' },
  { label: 'آج کا تیزابی ادھار دیا', flow: 'out', category: 'gold_give', kind: 'gold' },
  { label: 'آج کا تیزابی ادھار لیا', flow: 'in', category: 'gold_take', kind: 'gold' }
]
const CATS = [
  { v: 'gold_take', label: 'تیزابی لیا' },
  { v: 'gold_give', label: 'تیزابی دیا' },
  { v: 'cash_take', label: 'رقم لی' },
  { v: 'cash_give', label: 'رقم دی' }
]
const CAT_LABEL = {
  gold_take: 'تیزابی لیا', gold_give: 'تیزابی دیا', cash_take: 'رقم لی', cash_give: 'رقم دی',
  gold_sell: 'نقد فروخت', gold_buy: 'نقد خرید', lab_job: 'لیب'
}
const isGoldCat = (c) => c === 'gold_take' || c === 'gold_give'

const goldVal = (r) => Number(r.total_khalis ?? r.khalis_sona) || 0
const wazanVal = (r) => Number(r.sona_wazan) || goldVal(r)
const cashVal = (r) => Number(r.total_cash ?? r.cash_amount) || 0

// ═══ REPORT COLUMN CONFIG — edit here to change columns per report. ═══
const goldColumns = ({ parchi = false, date = false } = {}) => {
  const c = []
  if (parchi) c.push({ label: 'پرچی نمبر', get: (r) => r.receipt_no, num: true })
  if (date) c.push({ label: 'تاریخ', get: (r) => r.date, num: true })
  c.push({ label: 'نام', get: (r) => r.customer_name || '-' })
  c.push({ label: 'تولہ', get: (r) => gramsToTMR(goldVal(r)).tola, num: true })
  c.push({ label: 'ماشہ', get: (r) => gramsToTMR(goldVal(r)).masha, num: true })
  c.push({ label: 'رتی', get: (r) => fmtNum(gramsToTMR(goldVal(r)).ratti, 2), num: true })
  c.push({ label: 'گرام', get: (r) => fmtNum(wazanVal(r)), num: true })
  c.push({ label: 'خالص سونا', get: (r) => fmtNum(goldVal(r)), num: true, total: true, raw: (r) => goldVal(r) })
  return c
}
const cashColumns = ({ parchi = false, date = false } = {}) => {
  const c = []
  if (parchi) c.push({ label: 'پرچی نمبر', get: (r) => r.receipt_no, num: true })
  if (date) c.push({ label: 'تاریخ', get: (r) => r.date, num: true })
  c.push({ label: 'نام', get: (r) => r.customer_name || '-' })
  c.push({ label: 'نوٹ', get: (r) => r.note || '-' })
  c.push({ label: 'رقم', get: (r) => fmtMoney(cashVal(r)), num: true, total: true, raw: (r) => cashVal(r) })
  return c
}

const INP = 'w-full bg-white border border-gray-300 rounded-md text-[13px] px-2 py-1.5 text-start tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-500'
const hasApiFn = () => typeof window !== 'undefined' && window.api

// Date helpers — the app stores/queries ISO (yyyy-mm-dd); the UI shows DD/MM/YYYY.
const pad2 = (n) => String(n).padStart(2, '0')
const isoToDisp = (iso) => { const p = String(iso || '').split('-'); return p.length === 3 && p[0] ? `${p[2]}/${p[1]}/${p[0]}` : '' }
const dispToIso = (s) => { const m = String(s || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); return m ? `${m[3]}-${pad2(m[2])}-${pad2(m[1])}` : null }

// Date field: DD/MM/YYYY text (typeable) + a calendar icon that opens the native
// picker. Both edit the same ISO value. Defaults to today via the parent's state.
function DateField({ label, iso, setIso }) {
  const ref = useRef(null)
  const [text, setText] = useState(isoToDisp(iso))
  useEffect(() => { setText(isoToDisp(iso)) }, [iso])
  const onText = (v) => { setText(v); const parsed = dispToIso(v); if (parsed) setIso(parsed) }
  const openPicker = () => { const el = ref.current; if (!el) return; if (el.showPicker) { try { el.showPicker() } catch { el.focus() } } else el.focus() }
  return (
    <label className="flex items-center gap-1.5">
      <span className="text-[14px] font-bold text-black w-[86px] shrink-0">{label}</span>
      <input value={text} onChange={(e) => onText(e.target.value)} placeholder="dd/mm/yyyy" dir="ltr"
        className="flex-1 min-w-0 border border-gray-400 bg-white text-[16px] font-bold px-2 py-1.5 text-center tabular-nums rounded-sm focus:outline-none focus:ring-1 focus:ring-blue-500" />
      <button type="button" onClick={openPicker} title="کیلنڈر" className="border border-gray-400 bg-gray-100 px-2 py-1.5 rounded-sm hover:bg-gray-200 text-[16px]">📅</button>
      <input ref={ref} type="date" value={iso || ''} onChange={(e) => setIso(e.target.value)} tabIndex={-1} className="absolute w-0 h-0 opacity-0 pointer-events-none" />
    </label>
  )
}

function FlowIcon({ flow }) {
  return flow === 'in' ? (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true"><path d="M12 5v14M6 13l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" /></svg>
  ) : (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6" strokeLinecap="round" strokeLinejoin="round" /></svg>
  )
}
function ActionButton({ a, onClick }) {
  const inFlow = a.flow === 'in'
  return (
    <button type="button" onClick={onClick}
      className={`urdu flex items-center gap-2 rounded-xl px-3 py-3 text-[12.5px] font-semibold text-white shadow-sm ring-1 transition-all active:scale-[0.98] active:shadow-inner ${
        inFlow ? 'bg-emerald-600 ring-emerald-700/30 hover:bg-emerald-500 hover:shadow-md' : 'bg-rose-600 ring-rose-700/30 hover:bg-rose-500 hover:shadow-md'}`}>
      <span className={`shrink-0 w-6 h-6 rounded-lg flex items-center justify-center ${inFlow ? 'bg-emerald-700/40' : 'bg-rose-700/40'}`}><FlowIcon flow={a.flow} /></span>
      <span className="text-right leading-tight">{a.label}</span>
    </button>
  )
}

export default function UdharForm({ open, onClose }) {
  const { getReport, getReportGroup1, editTransaction, removeTransaction, resetData, hasApi } = useApp()

  const [custCode, setCustCode] = useState('')
  const [custName, setCustName] = useState('')
  const [nameHits, setNameHits] = useState([])
  const nameTimer = useRef(null)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [msg, setMsg] = useState(null)
  const [report, setReport] = useState(null)
  const [desc, setDesc] = useState(null)   // how to rebuild the current report
  const [view, setView] = useState('menu')
  const [editRow, setEditRow] = useState(null)
  const [customers, setCustomers] = useState([])

  // Live system date (LOCAL), NOT the app's setting date — both fields default to
  // the actual today (e.g. 02/07/2026). Computed fresh each render from new Date().
  const now = new Date()
  const todayISO = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`

  // Load the customer list for the code/name dropdowns when the form opens.
  useEffect(() => {
    if (!open || !hasApi) return
    window.api.listCustomersWithBalances().then((list) => setCustomers(list || []))
  }, [open, hasApi])

  useEffect(() => {
    if (!open) return
    setCustCode(''); setCustName(''); setNameHits([]); setMsg(null)
    setReport(null); setDesc(null); setView('menu'); setEditRow(null)
    setFrom(todayISO); setTo(todayISO)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const reportTotal = useMemo(() => {
    if (!report || report.group === 3) return 0
    const col = (report.columns || []).find((c) => c.total)
    return col ? (report.rows || []).reduce((s, r) => s + (col.raw ? col.raw(r) : 0), 0) : 0
  }, [report])

  if (!open) return null

  const customerFilter = () => ({
    customerId: custCode.trim() ? Number(custCode.trim()) : undefined,
    name: custCode.trim() ? undefined : (custName.trim() || undefined)
  })
  const customerLabel = () => (custCode.trim() ? `کوڈ ${custCode}` : (custName.trim() || 'تمام کسٹمر'))

  const onNameSearch = (v) => {
    setCustName(v); setCustCode('')
    if (nameTimer.current) clearTimeout(nameTimer.current)
    if (!hasApi || !v.trim()) { setNameHits([]); return }
    nameTimer.current = setTimeout(async () => { setNameHits((await window.api.findCustomers(v)) || []) }, 200)
  }
  const pickCustomer = (c) => { setCustCode(String(c.id)); setCustName(c.name || ''); setNameHits([]) }

  // Build (or rebuild) a report from a descriptor. `silent` skips validation
  // messages (used when reloading after an edit/delete).
  const loadReport = async (d, silent = false) => {
    if (d.type === 'g1') {
      const a = d.a
      const res = await getReportGroup1({ category: a.category, ...customerFilter() })
      setReport({ group: 1, kind: a.kind, gold: a.kind === 'gold', rows: res.rows || [], columns: a.kind === 'gold' ? goldColumns({}) : cashColumns({}), title: a.label, meta: { customer: customerLabel(), dateNote: 'تمام تواریخ (بیلنس)' } })
    } else if (d.type === 'g2') {
      const a = d.a
      if (!from || !to) { if (!silent) setMsg({ ok: false, text: 'پہلے تاریخ منتخب کریں' }); return }
      if (from !== to) { if (!silent) setMsg({ ok: false, text: 'اس رپورٹ کے لیے فرام اور ٹو ڈیٹ ایک ہی دن ہونی چاہیے' }); return }
      const res = await getReport({ category: a.category, from, to, ...customerFilter() })
      setReport({ group: 2, kind: a.kind, gold: a.kind === 'gold', rows: res.rows || [], columns: a.kind === 'gold' ? goldColumns({ parchi: true, date: true }) : cashColumns({ parchi: true, date: true }), title: a.label, meta: { customer: customerLabel(), dateNote: from } })
    } else if (d.type === 'g3') {
      if (!(custCode.trim() || custName.trim())) { if (!silent) setMsg({ ok: false, text: 'پہلے کسٹمر منتخب کریں / نام درج کریں' }); return }
      if (from && to && from > to) { if (!silent) setMsg({ ok: false, text: 'فرام ڈیٹ ٹو ڈیٹ سے بڑی نہیں ہو سکتی' }); return }
      const res = await getReport({ ...customerFilter(), from: from || undefined, to: to || undefined })
      setReport({ group: 3, rows: res.rows || [], meta: { customer: customerLabel(), from: from || 'ابتدا', to: to || 'آج تک' } })
    }
    setMsg(null); setDesc(d); setView('report')
  }
  const reload = () => { if (desc) loadReport(desc, true) }

  const onDeleteRow = async (row) => {
    if (!row || row.id == null) return
    if (!window.confirm('کیا آپ واقعی یہ لین دین حذف کرنا چاہتے ہیں؟')) return
    await removeTransaction(row.id)
    reload()
  }
  const saveEdit = async (id, fields) => { await editTransaction(id, fields); setEditRow(null); reload() }

  // Code + name dropdowns are kept in sync by the customer id.
  const onPickCustomer = (e) => {
    const id = e.target.value
    const c = customers.find((x) => String(x.id) === id)
    setCustCode(id)
    setCustName(c ? c.name : '')
  }

  // ── The ORIGINAL 8 buttons in a 2×4 grid (DOM order = RTL right col then left).
  // Buttons 1–4 = GROUP1 (no-date balance reports), 5–8 = GROUP2 (same-day). Their
  // array order already yields the requested rows:
  //   تیزابی لینا ہے | تیزابی دینا ہے
  //   رقم لینی ہے    | رقم دینی ہے
  //   آج کی ادھار رقم دی | آج کی ادھار رقم آمد
  //   آج کا تیزابی ادھار دیا | آج کا تیزابی ادھار لیا
  const gridButtons = [
    ...GROUP1.map((a) => ({ label: a.label, run: () => loadReport({ type: 'g1', a }) })),
    ...GROUP2.map((a) => ({ label: a.label, run: () => loadReport({ type: 'g2', a }) }))
  ]

  return (
    <div className="print-overlay fixed inset-0 z-[60] bg-black/50 flex items-start justify-center p-3 pt-[3vh]" onClick={onClose}>
      <div dir="rtl" className="print-root bg-gray-50 border border-gray-300 rounded-xl shadow-2xl w-[1040px] max-w-[97vw] max-h-[92vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="no-print shrink-0 flex items-center justify-between bg-gradient-to-b from-slate-700 to-slate-800 text-white px-4 py-3">
          <h2 className="urdu font-bold text-[18px]">ادھار — لین دین اور کسٹمر ریکارڈ</h2>
          <button type="button" onClick={onClose} title="بند کریں" className="w-8 h-8 flex items-center justify-center rounded-md text-slate-200 hover:bg-white/20 transition-colors">✕</button>
        </div>

        {view === 'report' ? (
          <ReportView report={report} total={reportTotal} onBack={() => setView('menu')} onEdit={setEditRow} onDelete={onDeleteRow} />
        ) : (
          <div className="no-print flex-1 min-h-0 overflow-auto p-4">
            <div className="flex gap-5 items-start">
              {/* RIGHT (first child in RTL) — 2×5 classic button grid */}
              <div className="flex-1 grid grid-cols-2 gap-2 content-start">
                {gridButtons.map((b) => (
                  <button
                    key={b.label}
                    type="button"
                    onClick={b.run}
                    className="urdu text-[16px] font-bold text-black bg-gray-100 border border-gray-400 rounded-sm px-2 py-2.5 min-h-[58px] flex items-center justify-center text-center leading-snug break-words hover:bg-gray-200 active:bg-gray-300 transition-colors"
                  >
                    {b.label}
                  </button>
                ))}
              </div>

              {/* LEFT — filters */}
              <div className="w-[340px] shrink-0 flex flex-col gap-3 bg-white border border-gray-300 rounded-md p-3">
                <DateField label="From Date:" iso={from} setIso={setFrom} />
                <DateField label="To Date:" iso={to} setIso={setTo} />
                <label className="flex items-center gap-2">
                  <span className="urdu text-[14px] font-bold text-black w-[120px] shrink-0">کسٹمر کا کوڈ :</span>
                  <select className="flex-1 min-w-0 border border-gray-400 bg-white text-[15px] font-bold px-2 py-1.5 rounded-sm focus:outline-none focus:ring-1 focus:ring-blue-500" value={custCode} onChange={onPickCustomer}>
                    <option value="">—</option>
                    {customers.map((c) => <option key={c.id} value={c.id}>{c.id}</option>)}
                  </select>
                </label>
                <label className="flex items-center gap-2">
                  <span className="urdu text-[14px] font-bold text-black w-[120px] shrink-0">کسٹمر کا نام :</span>
                  <select className="flex-1 min-w-0 border border-gray-400 bg-white text-[15px] font-bold px-2 py-1.5 rounded-sm focus:outline-none focus:ring-1 focus:ring-blue-500" value={custCode} onChange={onPickCustomer}>
                    <option value="">—</option>
                    {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() => loadReport({ type: 'g3' })}
                  className="urdu mt-1 w-full border border-gray-400 bg-gray-100 text-black text-[17px] font-bold py-2.5 rounded-sm hover:bg-gray-200 active:bg-gray-300 transition-colors"
                >
                  کسٹمر کی تفصیلی رسید
                </button>
                {msg && <div className={`urdu text-[14px] font-bold px-2 py-1.5 rounded ${msg.ok ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>{msg.text}</div>}
              </div>
            </div>
          </div>
        )}
      </div>

      {editRow && <EditModal row={editRow} onSave={saveEdit} onClose={() => setEditRow(null)} />}
    </div>
  )
}

// ═══ THERMAL RECEIPT (Udhar). Default 80mm roll — change to 58 for the small one.
const THERMAL_WIDTH_MM = 80

// Compact columns for the narrow roll — essentials only so nothing runs off edge.
const thermalColumns = (report) => report.gold
  ? [
      { label: 'نام', get: (r) => r.customer_name || '-' },
      { label: 'وزن', get: (r) => fmtNum(wazanVal(r)), num: true },
      { label: 'رتی', get: (r) => fmtNum(gramsToTMR(goldVal(r)).ratti, 2), num: true },
      { label: 'خالص', get: (r) => fmtNum(goldVal(r)), num: true, total: true, raw: (r) => goldVal(r) }
    ]
  : [
      { label: 'نام', get: (r) => r.customer_name || '-' },
      { label: 'تاریخ', get: (r) => isoToDisp(r.date), num: true },
      { label: 'رقم', get: (r) => fmtMoney(cashVal(r)), num: true, total: true, raw: (r) => cashVal(r) }
    ]

// Toggle thermal print mode: body class (monochrome + width via --thermal-w) plus
// an injected @page rule (size <w>mm auto → continuous narrow strip). Wrapped
// around window.print()/printToPDF, then cleared.
function applyThermal(on) {
  const body = document.body
  body.classList.toggle('thermal-print', on)
  body.style.setProperty('--thermal-w', `${THERMAL_WIDTH_MM}mm`)
  let style = document.getElementById('thermal-page-style')
  if (on) {
    if (!style) { style = document.createElement('style'); style.id = 'thermal-page-style'; document.head.appendChild(style) }
    style.textContent = `@page { size: ${THERMAL_WIDTH_MM}mm auto; margin: 2mm; }`
  } else if (style) {
    style.remove()
  }
}

function ThermalTable({ report, rows }) {
  const cols = thermalColumns(report)
  const totalCol = cols.find((c) => c.total)
  const total = rows.reduce((s, r) => s + (totalCol && totalCol.raw ? totalCol.raw(r) : 0), 0)
  return (
    <table className="w-full border-collapse text-[10px]">
      <thead>
        <tr>{cols.map((c) => <th key={c.label} className={`border border-black px-1 py-0.5 font-bold urdu ${c.num ? 'text-center' : 'text-right'}`}>{c.label}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={r.id ?? `${r.customer_id}-${i}`}>
            {cols.map((c) => <td key={c.label} className={`border border-black px-1 py-0.5 ${c.num ? 'text-center tabular-nums' : 'text-right urdu'}`} dir={c.num ? 'ltr' : 'rtl'}>{c.get(r)}</td>)}
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className="font-bold">
          <td className="border border-black px-1 py-0.5 urdu text-right" colSpan={cols.length - 1}>{report.gold ? 'کل خالص' : 'کل رقم'}</td>
          <td className="border border-black px-1 py-0.5 text-center tabular-nums" dir="ltr">{report.gold ? fmtNum(total) : fmtMoney(total)}</td>
        </tr>
      </tfoot>
    </table>
  )
}

function StatementThermal({ rows }) {
  const t = { goldGive: 0, goldTake: 0, cashGive: 0, cashTake: 0 }
  for (const r of rows) {
    if (r.category === 'gold_give') t.goldGive += Number(r.khalis_sona) || 0
    if (r.category === 'gold_take') t.goldTake += Number(r.khalis_sona) || 0
    if (r.category === 'cash_give') t.cashGive += Number(r.cash_amount) || 0
    if (r.category === 'cash_take') t.cashTake += Number(r.cash_amount) || 0
  }
  return (
    <div className="text-[10px] flex flex-col gap-1">
      {rows.map((r) => {
        const gold = r.category === 'gold_give' || r.category === 'gold_take'
        return (
          <div key={r.id} className="border-b border-black pb-0.5">
            <div className="flex justify-between"><span className="urdu font-bold">پرچی {r.receipt_no}</span><span dir="ltr">{isoToDisp(r.date)}</span></div>
            <div className="flex justify-between">
              <span className="urdu">{CAT_LABEL[r.category] || r.category} ({r.direction === 'out' ? 'دیا' : 'لیا'})</span>
              <span dir="ltr" className="tabular-nums font-bold">{gold ? `${fmtNum(r.khalis_sona)}g` : fmtMoney(r.cash_amount)}</span>
            </div>
          </div>
        )
      })}
      <div className="border-t-2 border-black pt-1 flex flex-col gap-0.5 font-bold">
        <div className="flex justify-between"><span className="urdu">کل تیزابی دیا</span><span dir="ltr">{fmtNum(t.goldGive)}g</span></div>
        <div className="flex justify-between"><span className="urdu">کل تیزابی لیا</span><span dir="ltr">{fmtNum(t.goldTake)}g</span></div>
        <div className="flex justify-between"><span className="urdu">کل رقم دی</span><span dir="ltr">{fmtMoney(t.cashGive)}</span></div>
        <div className="flex justify-between"><span className="urdu">کل رقم لی</span><span dir="ltr">{fmtMoney(t.cashTake)}</span></div>
      </div>
    </div>
  )
}

// Full thermal receipt: compact header + table (group 1/2) or statement (group 3).
function ThermalReceipt({ report }) {
  const isStatement = report.group === 3
  const title = isStatement ? 'کسٹمر کی تفصیلی رسید' : report.title
  const range = isStatement ? `${report.meta?.from} تا ${report.meta?.to}` : (report.meta?.dateNote || '')
  const cust = report.meta?.customer || ''
  const rows = report.rows || []
  return (
    <div className="thermal-receipt w-full bg-white text-black leading-tight">
      <div className="text-center border-b border-black pb-1 mb-1">
        <div className="urdu font-bold text-[13px] leading-tight">{title}</div>
        {range ? <div className="urdu font-bold text-[10px]" dir="rtl">{range}</div> : null}
        {cust ? <div className="urdu text-[10px]" dir="rtl">کسٹمر: {cust}</div> : null}
      </div>
      {rows.length === 0 ? (
        <div className="urdu text-center text-[10px] py-2">کوئی اندراج نہیں</div>
      ) : isStatement ? (
        <StatementThermal rows={rows} />
      ) : (
        <ThermalTable report={report} rows={rows} />
      )}
    </div>
  )
}

// ─── Report view: group 1/2 table or group 3 statement, + print/PDF ───────────
function ReportView({ report, total, onBack, onEdit, onDelete }) {
  const [note, setNote] = useState('')
  const [thermal, setThermal] = useState(true) // default to the thermal roll layout
  if (!report) return null
  const isStatement = report.group === 3
  const canRowEdit = (report.rows || []).some((r) => r.id != null)

  const doPrint = () => {
    applyThermal(thermal)
    window.addEventListener('afterprint', () => applyThermal(false), { once: true })
    setTimeout(() => applyThermal(false), 4000) // fallback if afterprint doesn't fire
    window.print()
  }
  const doPdf = async () => {
    if (!hasApiFn()) { setNote('PDF صرف ایپ میں دستیاب ہے'); setTimeout(() => setNote(''), 2500); return }
    applyThermal(thermal)
    try {
      const base = isStatement ? 'customer-statement' : (report.title || 'report')
      const res = await window.api.exportPDF(`${String(base).replace(/\s+/g, '-')}.pdf`, thermal ? { cssPageSize: true } : undefined)
      if (res?.ok) setNote('PDF محفوظ ہو گیا ✓')
      else if (!res?.canceled) setNote('PDF محفوظ نہیں ہو سکا')
    } finally { applyThermal(false) }
    setTimeout(() => setNote(''), 2500)
  }

  return (
    <div className="print-area flex flex-col min-h-0 flex-1">
      <div className="no-print shrink-0 flex items-center gap-2 bg-white border-b border-gray-200 px-4 py-2.5">
        <button type="button" onClick={onBack} className="urdu text-[12px] font-semibold text-blue-700 border border-blue-200 rounded-md px-3 py-1.5 hover:bg-blue-50 transition-colors">← واپس</button>
        <button
          type="button"
          onClick={() => setThermal((v) => !v)}
          title={`تھرمل رول ${THERMAL_WIDTH_MM}mm`}
          className={`urdu text-[12px] font-semibold border rounded-md px-3 py-1.5 transition-colors ${thermal ? 'bg-slate-700 text-white border-slate-700' : 'text-gray-700 border-gray-300 hover:bg-gray-100'}`}
        >
          تھرمل ({THERMAL_WIDTH_MM}mm)
        </button>
        <div className="flex-1" />
        {note && <span className="urdu text-[11px] text-emerald-600">{note}</span>}
        <button type="button" onClick={doPrint} className="urdu text-[12px] font-semibold text-gray-700 border border-gray-300 rounded-md px-3 py-1.5 hover:bg-gray-100 transition-colors">پرنٹ 🖨</button>
        <button type="button" onClick={doPdf} className="urdu text-[12px] font-semibold text-white bg-rose-600 rounded-md px-3 py-1.5 hover:bg-rose-700 transition-colors">PDF</button>
      </div>

      {thermal ? (
        // Thermal preview — the receipt shown on screen at the exact roll width so
        // the user can check it before printing. This same narrow content prints.
        <div className="flex-1 min-h-0 overflow-auto bg-gray-200 p-4">
          <div className="mx-auto bg-white border border-gray-400 shadow-md" style={{ width: `${THERMAL_WIDTH_MM}mm` }}>
            <div className="p-2"><ThermalReceipt report={report} /></div>
          </div>
        </div>
      ) : (
        <>
          {/* Printable heading (wide layout) */}
          <div className="px-4 pt-3">
            <div className="urdu font-bold text-[15px] text-gray-800">{isStatement ? 'کسٹمر کی تفصیلی رسید' : `تفصیلی رپورٹ — ${report.title}`}</div>
            <div className="urdu text-[11px] text-gray-500">کسٹمر: {report.meta?.customer} — {isStatement ? `عرصہ: ${report.meta?.from} تا ${report.meta?.to}` : report.meta?.dateNote} — کل اندراج: {report.rows.length}</div>
          </div>
          <div className="flex-1 min-h-0 overflow-auto p-4">
            {report.rows.length === 0 ? (
              <div className="urdu text-center text-gray-400 py-12 text-[13px]">اس فلٹر پر کوئی لین دین نہیں ملا</div>
            ) : isStatement ? (
              <StatementView rows={report.rows} onEdit={onEdit} onDelete={onDelete} />
            ) : (
              <TableReport columns={report.columns} rows={report.rows} total={total} gold={report.gold} canRowEdit={canRowEdit} onEdit={onEdit} onDelete={onDelete} />
            )}
          </div>
        </>
      )}
    </div>
  )
}

function RowActions({ r, onEdit, onDelete }) {
  if (!r || r.id == null) return <span className="text-gray-300">—</span>
  return (
    <span className="no-print inline-flex gap-1 justify-center">
      <button type="button" title="ترمیم" onClick={() => onEdit(r)} className="w-6 h-6 rounded hover:bg-blue-100 text-blue-700">✏️</button>
      <button type="button" title="حذف" onClick={() => onDelete(r)} className="w-6 h-6 rounded hover:bg-red-100 text-red-600">🗑</button>
    </span>
  )
}

function TableReport({ columns, rows, total, gold, canRowEdit, onEdit, onDelete }) {
  const totalIdx = columns.findIndex((c) => c.total)
  const totalText = gold ? `${fmtNum(total)} گرام` : fmtMoney(total)
  const totalLabel = gold ? 'کل خالص سونا' : 'کل رقم'
  const span = columns.length + (canRowEdit ? 1 : 0)
  return (
    <table className="w-full border-collapse text-[12.5px] bg-white border border-gray-300 shadow-sm">
      <thead className="sticky top-0">
        <tr className="bg-slate-100 text-gray-700 border-b-2 border-slate-300 urdu">
          {columns.map((c) => <th key={c.label} className={`px-3 py-2 border-l border-gray-200 ${c.num ? 'text-center' : 'text-right'}`}>{c.label}</th>)}
          {canRowEdit && <th className="no-print px-3 py-2 text-center w-[80px]">ایکشن</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={r.id ?? `${r.customer_id}-${i}`} className="border-b border-gray-100 hover:bg-blue-50/40">
            {columns.map((c) => (
              <td key={c.label} className={`px-3 py-1.5 border-l border-gray-100 ${c.num ? 'text-center tabular-nums' : 'text-right urdu'}`} dir={c.num ? 'ltr' : 'rtl'}>{c.get(r)}</td>
            ))}
            {canRowEdit && <td className="no-print px-3 py-1.5 text-center"><RowActions r={r} onEdit={onEdit} onDelete={onDelete} /></td>}
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className="bg-amber-50 border-t-2 border-amber-300 font-bold urdu text-[13px]">
          {columns.map((c, i) => {
            if (i === totalIdx) return <td key={c.label} className="px-3 py-2.5 text-center tabular-nums text-amber-800" dir="ltr">{totalText}</td>
            if (i === totalIdx - 1) return <td key={c.label} className="px-3 py-2.5 text-left text-amber-800">{totalLabel} :</td>
            return <td key={c.label} className="px-3 py-2.5" />
          })}
          {canRowEdit && <td className="no-print" />}
        </tr>
      </tfoot>
    </table>
  )
}

function StatementView({ rows, onEdit, onDelete }) {
  const t = { goldGive: 0, goldTake: 0, cashGive: 0, cashTake: 0, netGold: 0, netCash: 0 }
  for (const r of rows) {
    const sign = r.direction === 'out' ? 1 : -1
    if (r.category === 'gold_give') t.goldGive += Number(r.khalis_sona) || 0
    if (r.category === 'gold_take') t.goldTake += Number(r.khalis_sona) || 0
    if (r.category === 'cash_give') t.cashGive += Number(r.cash_amount) || 0
    if (r.category === 'cash_take') t.cashTake += Number(r.cash_amount) || 0
    if (r.category === 'gold_give' || r.category === 'gold_take') t.netGold += sign * (Number(r.khalis_sona) || 0)
    if (r.category === 'cash_give' || r.category === 'cash_take') t.netCash += sign * (Number(r.cash_amount) || 0)
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">{rows.map((r) => <ParchiCard key={r.id} r={r} onEdit={onEdit} onDelete={onDelete} />)}</div>
      <div className="mt-2 border-2 border-slate-300 rounded-lg bg-white overflow-hidden">
        <div className="urdu font-bold text-[13px] bg-slate-100 px-3 py-2 border-b border-slate-200 text-gray-800">کل حساب (اس عرصے کا)</div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 px-4 py-3 text-[12.5px] urdu">
          <StRow k="کل تیزابی دیا" v={`${fmtNum(t.goldGive)} گرام`} />
          <StRow k="کل تیزابی لیا" v={`${fmtNum(t.goldTake)} گرام`} />
          <StRow k="کل رقم دی" v={fmtMoney(t.cashGive)} />
          <StRow k="کل رقم لی" v={fmtMoney(t.cashTake)} />
          <StRow k="خالص تیزابی بیلنس" v={`${fmtNum(t.netGold)} گرام`} bold />
          <StRow k="خالص رقم بیلنس" v={fmtMoney(t.netCash)} bold />
        </div>
      </div>
    </div>
  )
}
function StRow({ k, v, bold }) {
  return (
    <div className={`flex items-center justify-between border-b border-dashed border-gray-200 py-1 ${bold ? 'font-bold text-amber-800' : 'text-gray-700'}`}>
      <span>{k} :</span><span className="tabular-nums" dir="ltr">{v}</span>
    </div>
  )
}

function ParchiCard({ r, onEdit, onDelete }) {
  const isGold = r.category === 'gold_give' || r.category === 'gold_take'
  const isCash = r.category === 'cash_give' || r.category === 'cash_take'
  const tmr = gramsToTMR(Number(r.khalis_sona) || 0)
  const typeLabel = CAT_LABEL[r.category] || r.category
  return (
    <div className="border border-gray-300 rounded-lg bg-white shadow-sm overflow-hidden text-[12px]">
      <div className="flex items-center justify-between bg-slate-50 border-b border-gray-200 px-3 py-1.5">
        <span className="urdu font-bold text-gray-800">پرچی نمبر {r.receipt_no}</span>
        <span className="flex items-center gap-2">
          <span className="tabular-nums text-gray-500" dir="ltr">{r.date}</span>
          <span className="no-print inline-flex gap-1">
            <button type="button" title="ترمیم" onClick={() => onEdit(r)} className="w-6 h-6 rounded hover:bg-blue-100 text-blue-700">✏️</button>
            <button type="button" title="حذف" onClick={() => onDelete(r)} className="w-6 h-6 rounded hover:bg-red-100 text-red-600">🗑</button>
          </span>
        </span>
      </div>
      <div className="px-3 py-2 flex flex-col gap-1" dir="rtl">
        <div className="flex justify-between"><span className="urdu text-gray-500">نام</span><span className="urdu font-semibold">{r.customer_name || '-'}</span></div>
        <div className="flex justify-between"><span className="urdu text-gray-500">قسم</span><span className={`urdu font-semibold ${r.direction === 'out' ? 'text-rose-600' : 'text-emerald-600'}`}>{typeLabel} ({r.direction === 'out' ? 'دیا' : 'لیا'})</span></div>
        {isGold && (
          <div className="mt-1 border border-gray-200 rounded-md overflow-hidden">
            <div className="grid grid-cols-4 bg-slate-100 text-[10px] urdu text-gray-600 text-center">
              <div className="py-0.5 border-l border-gray-200">تولہ</div><div className="py-0.5 border-l border-gray-200">ماشہ</div><div className="py-0.5 border-l border-gray-200">رتی</div><div className="py-0.5">گرام</div>
            </div>
            <div className="grid grid-cols-4 text-[11px] tabular-nums text-center">
              <div className="py-0.5 border-l border-gray-100">{tmr.tola}</div><div className="py-0.5 border-l border-gray-100">{tmr.masha}</div><div className="py-0.5 border-l border-gray-100">{fmtNum(tmr.ratti, 2)}</div><div className="py-0.5">{fmtNum(wazanVal(r))}</div>
            </div>
            <div className="flex justify-between px-2 py-1 bg-amber-50 border-t border-amber-200"><span className="urdu text-gray-600">خالص سونا</span><span className="tabular-nums font-bold text-amber-800" dir="ltr">{fmtNum(r.khalis_sona)} گرام</span></div>
          </div>
        )}
        {isCash && <div className="flex justify-between mt-1 px-2 py-1.5 bg-amber-50 border border-amber-200 rounded-md"><span className="urdu text-gray-600">رقم</span><span className="tabular-nums font-bold text-amber-800" dir="ltr">{fmtMoney(r.cash_amount)}</span></div>}
        {r.note ? <div className="flex justify-between"><span className="urdu text-gray-500">نوٹ</span><span className="urdu text-gray-600">{r.note}</span></div> : null}
      </div>
    </div>
  )
}

// ─── Edit modal (Part 1) ──────────────────────────────────────────────────────
function EditModal({ row, onSave, onClose }) {
  const startGold = isGoldCat(row.category)
  const [category, setCategory] = useState(row.category)
  const [direction, setDirection] = useState(row.direction || (row.category?.includes('take') ? 'in' : 'out'))
  const [amount, setAmount] = useState(String(startGold ? (row.khalis_sona || '') : (row.cash_amount || '')))
  const [date, setDate] = useState(row.date || '')
  const [note, setNote] = useState(row.note || '')
  const gold = isGoldCat(category)

  const submit = () => {
    const amt = Number(amount) || 0
    const fields = { category, direction, date, note }
    if (gold) { fields.khalis_sona = amt; fields.sona_wazan = amt; fields.point = 100; fields.cash_amount = 0 }
    else { fields.cash_amount = amt; fields.khalis_sona = 0; fields.sona_wazan = 0 }
    onSave(row.id, fields)
  }
  return (
    <div className="fixed inset-0 z-[70] bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div dir="rtl" className="bg-white rounded-lg shadow-2xl w-[380px] max-w-[95vw] overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between bg-slate-100 border-b border-gray-200 px-4 py-2.5"><h3 className="urdu font-bold text-[14px]">لین دین میں ترمیم (پرچی {row.receipt_no})</h3><button onClick={onClose} className="w-7 h-7 rounded hover:bg-red-500 hover:text-white">✕</button></div>
        <div className="p-4 flex flex-col gap-3">
          <label className="urdu text-[11px] text-gray-600 flex flex-col gap-1">قسم
            <select className={INP} value={category} onChange={(e) => setCategory(e.target.value)}>{CATS.map((c) => <option key={c.v} value={c.v}>{c.label}</option>)}</select></label>
          <label className="urdu text-[11px] text-gray-600 flex flex-col gap-1">سمت
            <select className={INP} value={direction} onChange={(e) => setDirection(e.target.value)}><option value="in">لیا (in — شاپ کو موصول)</option><option value="out">دیا (out — شاپ نے دیا)</option></select></label>
          <label className="urdu text-[11px] text-gray-600 flex flex-col gap-1">{gold ? 'خالص سونا (گرام)' : 'رقم (روپے)'}
            <input className={INP} value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} inputMode="decimal" /></label>
          <label className="urdu text-[11px] text-gray-600 flex flex-col gap-1">تاریخ<input type="date" className={INP} value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label className="urdu text-[11px] text-gray-600 flex flex-col gap-1">نوٹ<input className={INP} value={note} onChange={(e) => setNote(e.target.value)} /></label>
        </div>
        <div className="flex gap-2 px-4 py-3 border-t border-gray-200 bg-gray-50">
          <button onClick={submit} className="urdu flex-1 rounded-md bg-blue-600 text-white text-[13px] font-semibold py-2 hover:bg-blue-700">محفوظ کریں</button>
          <button onClick={onClose} className="urdu rounded-md border border-gray-300 bg-white text-gray-700 text-[13px] font-semibold px-4 hover:bg-gray-100">منسوخ</button>
        </div>
      </div>
    </div>
  )
}
