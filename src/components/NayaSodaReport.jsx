import React, { useEffect, useState } from 'react'
import { GRAMS_PER_TOLA, fmtMoney } from '../logic/units'
import { amountOf, sumAmount } from '../logic/nayaSoda.js'

// نیا سودا report — shared by the بھگتان سودا and بقایا سودا buttons (status
// prop = 'bhugtan' | 'bakaya'). Reads ONLY the naya_soda table via
// window.api.listNayaSoda; never touches ledger data.
//
// New deals land in بقایا first. Each report has its own control:
//   • بقایا — LEADING checkboxes (plus a select-all in the header) tick rows into
//     a selection; the toolbar's "منتخب (N) بھگتان میں منتقل کریں" button opens ONE
//     confirm modal, and on ہاں every selected row moves to بھگتان
//     (setNayaSodaStatus, run sequentially) and disappears from here.
//   • بھگتان — a TRAILING ختم button; on ہاں that single row is DELETED outright
//     (deleteNayaSoda) via the styled confirm modal and is gone for good.
// Either way the list refreshes so the acted-on rows leave the current view.
//
// Print / thermal / PDF mirror the تیزابی (gold) reports' ReportView toolbar in
// UdharForm.jsx: same applyThermal() body-class + @page trick, same
// window.api.printPage / exportPDF calls, and a compact narrow ThermalNaya table
// for the 80mm roll. Only READS those flows for reference; nothing shared changed.

const pad2 = (n) => String(n).padStart(2, '0')
const isoToDisp = (iso) => {
  const p = String(iso || '').split('-')
  return p.length === 3 && p[0] ? `${p[2]}/${p[1]}/${p[0]}` : (iso || '-')
}
const TYPE_LABEL = { khareed: 'خرید', farokht: 'فروخت' }

const TH = 'urdu text-[13px] font-bold text-black bg-header border border-line px-2 py-1.5 text-center'
const TD = 'text-[14px] font-bold border border-gray-300 px-2 py-1.5 text-center tabular-nums'

// Sum the وزن of a row list; format trims trailing zeros (max 4 dp).
const sumWazan = (list) => list.reduce((s, r) => s + (Number(r.wazan) || 0), 0)
// رقم maths (amountOf / sumAmount) live in ../logic/nayaSoda.js so the report and
// the حساب cash position share ONE definition of what a سودا row is worth.
// avgRate below is deliberately left untouched: it does its own grams→tola
// conversion internally and its printed numbers must not move.
const fmtW = (n) => String(Math.round((Number(n) || 0) * 10000) / 10000)
// Weight-weighted average per-tola rate. Rate is per-tola, wazan is in grams, so
// each row's amount = (wazan / GRAMS_PER_TOLA) * rate, and the average rate is
// (Σ amount * GRAMS_PER_TOLA) / Σ wazan. Returns 0 for an empty/zero-weight list.
const avgRate = (list) => {
  const totalWazan = list.reduce((s, r) => s + (Number(r.wazan) || 0), 0)
  if (!totalWazan) return 0
  const totalAmount = list.reduce(
    (s, r) => s + ((Number(r.wazan) || 0) / GRAMS_PER_TOLA) * (Number(r.rate) || 0), 0)
  return (totalAmount * GRAMS_PER_TOLA) / totalWazan
}
// Rate formatting — matches the ریٹ column (plain number), rounded to 2 dp max.
const fmtRate = (n) => String(Math.round((Number(n) || 0) * 100) / 100)

// Thermal roll geometry — same constants the تیزابی reports use (80mm paper,
// 64mm content anchored 6mm from the true paper edge).
const THERMAL_PAPER_MM = 80
const THERMAL_CONTENT_MM = 64
const THERMAL_LEFT_MM = 6

// Toggle thermal print mode — identical mechanism to UdharForm's applyThermal:
// body class + CSS vars + an injected @page rule (continuous narrow strip).
function applyThermal(on) {
  const body = document.body
  body.classList.toggle('thermal-print', on)
  body.style.setProperty('--thermal-w', `${THERMAL_CONTENT_MM}mm`)
  body.style.setProperty('--thermal-left', `${THERMAL_LEFT_MM}mm`)
  let style = document.getElementById('thermal-page-style')
  if (on) {
    if (!style) { style = document.createElement('style'); style.id = 'thermal-page-style'; document.head.appendChild(style) }
    style.textContent = `@page { size: ${THERMAL_PAPER_MM}mm auto; margin: 2mm 0; }`
  } else if (style) {
    style.remove()
  }
}

// Compact narrow receipt for the 80mm roll — نام | ریٹ | وزن | رقم | قسم | تاریخ.
function ThermalNaya({ rows, title, range, status }) {
  const TTH = 'border border-black px-1 py-0.5 font-bold urdu'
  const TTD = 'border border-black px-1 py-0.5'
  const buyRows = rows.filter((r) => r.type === 'khareed')
  const sellRows = rows.filter((r) => r.type === 'farokht')
  const buyAmt = sumAmount(buyRows)
  const sellAmt = sumAmount(sellRows)
  return (
    <div className="thermal-receipt w-full bg-white text-black leading-tight">
      <div className="text-center border-b border-black pb-1 mb-1">
        <div className="urdu font-bold text-[13px] leading-tight">{title}</div>
        {range ? <div className="urdu font-bold text-[10px]" dir="rtl">{range}</div> : null}
      </div>
      {rows.length === 0 ? (
        <div className="urdu text-center text-[10px] py-2">کوئی اندراج نہیں</div>
      ) : (
        <table className="w-full border-collapse text-[10px]">
          <thead>
            <tr>
              <th className={`${TTH} text-right`}>نام</th>
              <th className={`${TTH} text-center`}>ریٹ</th>
              <th className={`${TTH} text-center`}>وزن</th>
              <th className={`${TTH} text-center`}>رقم</th>
              <th className={`${TTH} text-center`}>قسم</th>
              <th className={`${TTH} text-center`}>تاریخ</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className={`${TTD} text-right urdu`} dir="rtl">{r.name || '-'}</td>
                <td className={`${TTD} text-center tabular-nums`} dir="ltr">{r.rate}</td>
                <td className={`${TTD} text-center tabular-nums`} dir="ltr">{r.wazan}</td>
                <td className={`${TTD} text-center tabular-nums`} dir="ltr">{fmtMoney(amountOf(r))}</td>
                <td className={`${TTD} text-center urdu`}>{TYPE_LABEL[r.type] || r.type || '-'}</td>
                <td className={`${TTD} text-center tabular-nums`} dir="ltr">{isoToDisp(r.date)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-bold">
              {/* 6 data columns on the roll — thermal has no checkbox/ختم column. */}
              <td className="border border-black p-0 urdu" colSpan={6}>
                {/* Same matrix as the wide report, sized for the 64mm roll:
                    خرید/فروخت columns, measures as rows, hairlines via gap-px. */}
                <div dir="rtl" className="text-black">
                  <div className="flex items-center justify-between px-1 py-0.5 border-b border-black">
                    <span className="urdu font-bold">کل وزن</span>
                    <span className="tabular-nums" dir="ltr">{fmtW(sumWazan(rows))}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-px bg-black border-b border-black">
                    <div className="bg-white px-1 py-0.5" />
                    <div className="bg-white px-1 py-0.5 urdu font-bold text-center">خرید</div>
                    <div className="bg-white px-1 py-0.5 urdu font-bold text-center">فروخت</div>

                    <div className="bg-white px-1 py-0.5 urdu">وزن</div>
                    <div className="bg-white px-1 py-0.5 tabular-nums text-center" dir="ltr">{fmtW(sumWazan(buyRows))}</div>
                    <div className="bg-white px-1 py-0.5 tabular-nums text-center" dir="ltr">{fmtW(sumWazan(sellRows))}</div>

                    {status === 'bakaya' && (
                      <>
                        <div className="bg-white px-1 py-0.5 urdu">اوسط ریٹ</div>
                        <div className="bg-white px-1 py-0.5 tabular-nums text-center" dir="ltr">{fmtRate(avgRate(buyRows))}</div>
                        <div className="bg-white px-1 py-0.5 tabular-nums text-center" dir="ltr">{fmtRate(avgRate(sellRows))}</div>
                        <div className="bg-white px-1 py-0.5 urdu">رقم</div>
                        <div className="bg-white px-1 py-0.5 tabular-nums text-center" dir="ltr">{fmtMoney(buyAmt)}</div>
                        <div className="bg-white px-1 py-0.5 tabular-nums text-center" dir="ltr">{fmtMoney(sellAmt)}</div>
                      </>
                    )}
                  </div>
                  {status === 'bakaya' && sellAmt !== buyAmt && (
                    <div className="flex items-center justify-between px-1 py-1 font-bold text-[11px]">
                      <span className="urdu">{sellAmt > buyAmt ? 'اضافی فروخت' : 'اضافی خرید'}</span>
                      <span className="tabular-nums" dir="ltr">{fmtMoney(Math.abs(sellAmt - buyAmt))}</span>
                    </div>
                  )}
                </div>
              </td>
            </tr>
          </tfoot>
        </table>
      )}
    </div>
  )
}

export default function NayaSodaReport({ status, from, to, onClose }) {
  const [rows, setRows] = useState([])
  // id of the row awaiting confirmation, plus what ہاں will do: 'move' (بقایا →
  // بھگتان) or 'delete' (remove outright). Both null when no modal is open.
  const [confirmId, setConfirmId] = useState(null)
  const [confirmAction, setConfirmAction] = useState('move')
  // بقایا multi-select: ids ticked for the bulk بھگتان transfer, and whether the
  // one confirm modal for that bulk action is open.
  const [selected, setSelected] = useState(() => new Set())
  const [confirmBulk, setConfirmBulk] = useState(false)
  const [thermal, setThermal] = useState(false) // default to the normal wide view
  const [note, setNote] = useState('')
  const showMoveCheckbox = status === 'bakaya'  // LEADING move checkbox — بقایا only
  const showDeleteBtn = status === 'bhugtan'    // TRAILING ختم button — بھگتان only
  const title = status === 'bhugtan' ? 'بھگتان سودا' : 'بقایا سودا'
  const fromDisp = from ? isoToDisp(from) : 'ابتدا'
  const toDisp = to ? isoToDisp(to) : 'آج تک'
  const range = `عرصہ: ${fromDisp} تا ${toDisp}`
  // Weight totals + (بقایا only) average rates over the CURRENTLY DISPLAYED
  // (date-filtered) rows.
  const buyRows = rows.filter((r) => r.type === 'khareed')
  const sellRows = rows.filter((r) => r.type === 'farokht')
  const totalWazan = sumWazan(rows)
  const khareedWazan = sumWazan(buyRows)
  const farokhtWazan = sumWazan(sellRows)
  const avgBuyRate = avgRate(buyRows)
  const avgSellRate = avgRate(sellRows)
  // رقم totals (ریٹ × وزن-in-tolas, summed) over the same displayed rows — the
  // matrix shows these under بقایا only.
  const buyAmt = sumAmount(buyRows)
  const sellAmt = sumAmount(sellRows)

  // Select-all state over the CURRENTLY LISTED rows: fully ticked vs. partial
  // (the header checkbox renders indeterminate for the partial case).
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id))
  const someSelected = rows.some((r) => selected.has(r.id)) && !allSelected

  const load = async () => {
    if (!window.api) { setRows([]); return }
    setRows((await window.api.listNayaSoda(status, from, to)) || [])
  }
  // A different report / date range lists different rows — drop any stale ticks.
  useEffect(() => { setSelected(new Set()); load() }, [status, from, to])

  // Tick / untick one row. Ticking no longer opens the confirm modal — the rows
  // stay ticked until the toolbar's bulk transfer button acts on them.
  const toggleRow = (id) => setSelected((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })
  // Header checkbox — fill the set with every listed row, or empty it.
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)))

  // Open the confirm modal for a row, tagged with the action ہاں will perform.
  const askConfirm = (id, action) => { setConfirmAction(action); setConfirmId(id) }

  // Confirmed (ہاں), single row: either move it بقایا → بھگتان, or delete it
  // outright (بھگتان). Then close the modal and refresh so the row leaves this view.
  const confirmYes = async () => {
    const id = confirmId
    const action = confirmAction
    setConfirmId(null)
    if (id == null || !window.api) return
    if (action === 'delete') await window.api.deleteNayaSoda(id)
    else await window.api.setNayaSodaStatus(id, 'bhugtan')
    load()
  }

  // Confirmed (ہاں), bulk: move every ticked بقایا row to بھگتان. Sequential so the
  // writes don't race, then clear the ticks and refresh — the moved rows leave this
  // view and show up under بھگتان.
  const confirmBulkYes = async () => {
    const ids = [...selected]
    setConfirmBulk(false)
    if (!ids.length || !window.api) { setSelected(new Set()); return }
    for (const id of ids) await window.api.setNayaSodaStatus(id, 'bhugtan')
    setSelected(new Set())
    load()
  }

  // Silent print to the default printer via the main process (same as ReportView).
  const doPrint = async () => {
    applyThermal(thermal)
    try {
      if (window.api && window.api.printPage) {
        const res = await window.api.printPage({ silent: true })
        if (res && res.ok === false) {
          setNote(`پرنٹ نہیں ہو سکا${res.reason ? ` (${res.reason})` : ''} — پرنٹر چیک کریں`)
          setTimeout(() => setNote(''), 4000)
        }
      } else {
        window.print()
      }
    } finally {
      applyThermal(false)
    }
  }

  const doPdf = async () => {
    if (!window.api) { setNote('PDF صرف ایپ میں دستیاب ہے'); setTimeout(() => setNote(''), 2500); return }
    applyThermal(thermal)
    try {
      const name = status === 'bhugtan' ? 'bhugtan-soda.pdf' : 'baqaya-soda.pdf'
      const res = await window.api.exportPDF(name, thermal ? { cssPageSize: true } : undefined)
      if (res?.ok) setNote('PDF محفوظ ہو گیا ✓')
      else if (!res?.canceled) setNote('PDF محفوظ نہیں ہو سکا')
    } finally {
      applyThermal(false)
    }
    setTimeout(() => setNote(''), 2500)
  }

  return (
    <div className="print-overlay fixed inset-0 z-[70] bg-black/50 flex items-start justify-center p-3 pt-[6vh]" onClick={onClose}>
      <div dir="rtl" className="print-root bg-white border border-gray-300 rounded-xl shadow-2xl w-[720px] max-w-[95vw] max-h-[85vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="no-print shrink-0 flex items-center justify-between bg-gradient-to-b from-slate-700 to-slate-800 text-white px-4 py-3">
          <h2 className="urdu font-bold text-[18px]">{title}</h2>
          <button type="button" onClick={onClose} title="بند کریں" className="w-8 h-8 flex items-center justify-center rounded-md text-slate-200 hover:bg-white/20 transition-colors">✕</button>
        </div>

        <div className="print-area flex flex-col min-h-0 flex-1">
          {/* Toolbar — تھرمل toggle, پرنٹ, PDF (mirrors the تیزابی reports). */}
          <div className="no-print shrink-0 flex items-center gap-2 bg-white border-b border-gray-200 px-4 py-2.5">
            <button
              type="button"
              onClick={() => setThermal((v) => !v)}
              title={`تھرمل رول ${THERMAL_PAPER_MM}mm`}
              className={`urdu text-[12px] font-semibold border rounded-md px-3 py-1.5 transition-colors ${thermal ? 'bg-slate-700 text-white border-slate-700' : 'text-gray-700 border-gray-300 hover:bg-gray-100'}`}
            >
              تھرمل ({THERMAL_PAPER_MM}mm)
            </button>
            {/* بقایا only — bulk transfer of every ticked row; hidden while nothing is ticked. */}
            {showMoveCheckbox && selected.size > 0 && (
              <button
                type="button"
                onClick={() => setConfirmBulk(true)}
                className="urdu text-[12px] font-semibold text-white bg-emerald-600 rounded-md px-3 py-1.5 hover:bg-emerald-700 transition-colors"
              >
                منتخب ({selected.size}) بھگتان میں منتقل کریں
              </button>
            )}
            <div className="flex-1" />
            {note && <span className="urdu text-[11px] text-emerald-600">{note}</span>}
            <button type="button" onClick={doPrint} className="urdu text-[12px] font-semibold text-gray-700 border border-gray-300 rounded-md px-3 py-1.5 hover:bg-gray-100 transition-colors">پرنٹ 🖨</button>
            <button type="button" onClick={doPdf} className="urdu text-[12px] font-semibold text-white bg-rose-600 rounded-md px-3 py-1.5 hover:bg-rose-700 transition-colors">PDF</button>
          </div>

          {/* Printable heading — title + date range + count (like the other reports). */}
          <div className="px-4 pt-3">
            <div className="urdu font-bold text-[15px] text-gray-800">{title}</div>
            <div className="urdu text-[11px] text-gray-500" dir="rtl">{range} — کل اندراج: {rows.length}</div>
          </div>

          {rows.length === 0 ? (
            <div className="urdu text-[15px] font-bold text-gray-500 text-center py-8">کوئی ریکارڈ نہیں</div>
          ) : thermal ? (
            // Thermal preview — white strip is the PAPER (80mm), content 64mm.
            <div className="flex-1 min-h-0 overflow-auto bg-gray-200 p-4">
              <div className="mx-auto bg-white border border-gray-400 shadow-md" style={{ width: `${THERMAL_PAPER_MM}mm` }}>
                <div className="my-[2mm] mx-auto print:mx-0 print:ml-[6mm]" style={{ width: `${THERMAL_CONTENT_MM}mm` }}>
                  <ThermalNaya rows={rows} title={title} range={range} status={status} />
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 min-h-0 overflow-auto p-3">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    {showMoveCheckbox && (
                      <th className={`${TH} no-print w-10`}>
                        <input
                          type="checkbox"
                          checked={allSelected}
                          ref={(el) => { if (el) el.indeterminate = someSelected }}
                          onChange={toggleAll}
                          title="سب منتخب کریں"
                          className="scale-125 cursor-pointer"
                        />
                      </th>
                    )}
                    <th className={TH}>نام</th>
                    <th className={TH}>ریٹ</th>
                    <th className={TH}>وزن</th>
                    <th className={TH}>رقم</th>
                    <th className={TH}>قسم</th>
                    <th className={TH}>تاریخ</th>
                    {showDeleteBtn && <th className={`${TH} no-print`}>&nbsp;</th>}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    // بقایا report only: colour each row by قسم — خرید green, فروخت light red.
                    <tr key={r.id} className={`hover:bg-yellowCell/60 ${status === 'bakaya' ? (r.type === 'khareed' ? 'bg-emerald-100' : r.type === 'farokht' ? 'bg-rose-100' : '') : ''}`}>
                      {showMoveCheckbox && (
                        <td className={`${TD} w-10 no-print`}>
                          <input
                            type="checkbox"
                            checked={selected.has(r.id)}
                            onChange={() => toggleRow(r.id)}
                            title="بھگتان میں منتقل کرنے کے لیے منتخب کریں"
                            className="scale-125 cursor-pointer"
                          />
                        </td>
                      )}
                      <td className={`${TD} urdu text-right`}>{r.name || '-'}</td>
                      <td className={TD} dir="ltr">{r.rate}</td>
                      <td className={TD} dir="ltr">{r.wazan}</td>
                      <td className={TD} dir="ltr">{fmtMoney(amountOf(r))}</td>
                      <td className={`${TD} urdu`}>{TYPE_LABEL[r.type] || r.type || '-'}</td>
                      <td className={TD} dir="ltr">{isoToDisp(r.date)}</td>
                      {showDeleteBtn && (
                        <td className={`${TD} w-10 no-print`}>
                          <button
                            type="button"
                            onClick={() => askConfirm(r.id, 'delete')}
                            title="ختم کریں"
                            className="urdu w-7 h-7 flex items-center justify-center rounded-md text-rose-600 hover:bg-rose-100 transition-colors mx-auto"
                          >
                            ✕
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-amber-50 border-t-2 border-amber-300 font-bold urdu text-[13px] text-amber-800">
                    {/* 6 data columns (نام ریٹ وزن رقم قسم تاریخ) + بقایا's leading
                        checkbox + بھگتان's trailing ختم — the two are never both on,
                        but the span is computed from the same flags that render them. */}
                    <td colSpan={(showMoveCheckbox ? 1 : 0) + 6 + (showDeleteBtn ? 1 : 0)} className="p-0">
                      {/* Financial summary a shopkeeper scans. Structure follows the
                          real axis of the data — خرید vs فروخت as columns, measures
                          as rows — in fixed grid tracks so every digit lines up under
                          the one above it. All emphasis is spent on اضافی. */}
                      <div dir="rtl" className="text-amber-800">
                        {/* کل وزن — quiet, full width */}
                        <div className="flex items-center justify-between px-3 py-1.5 border-b border-amber-300">
                          <span className="urdu font-semibold">کل وزن</span>
                          <span className="tabular-nums font-bold" dir="ltr">{fmtW(totalWazan)}</span>
                        </div>
                        {/* خرید / فروخت matrix — hairline separators via gap-px over
                            the darker amber, cells on the lighter one. */}
                        <div className="grid grid-cols-3 gap-px bg-amber-300 border-b border-amber-300">
                          <div className="bg-amber-50 px-3 py-1.5" />
                          <div className="bg-amber-50 px-3 py-1.5 urdu font-bold text-center">خرید</div>
                          <div className="bg-amber-50 px-3 py-1.5 urdu font-bold text-center">فروخت</div>

                          <div className="bg-amber-50 px-3 py-1.5 urdu font-semibold">وزن</div>
                          <div className="bg-amber-50 px-3 py-1.5 tabular-nums text-center" dir="ltr">{fmtW(khareedWazan)}</div>
                          <div className="bg-amber-50 px-3 py-1.5 tabular-nums text-center" dir="ltr">{fmtW(farokhtWazan)}</div>

                          {status === 'bakaya' && (
                            <>
                              <div className="bg-amber-50 px-3 py-1.5 urdu font-semibold">اوسط ریٹ</div>
                              <div className="bg-amber-50 px-3 py-1.5 tabular-nums text-center" dir="ltr">{fmtRate(avgBuyRate)}</div>
                              <div className="bg-amber-50 px-3 py-1.5 tabular-nums text-center" dir="ltr">{fmtRate(avgSellRate)}</div>
                              <div className="bg-amber-50 px-3 py-1.5 urdu font-semibold">رقم</div>
                              <div className="bg-amber-50 px-3 py-1.5 tabular-nums text-center" dir="ltr">{fmtMoney(buyAmt)}</div>
                              <div className="bg-amber-50 px-3 py-1.5 tabular-nums text-center" dir="ltr">{fmtMoney(sellAmt)}</div>
                            </>
                          )}
                        </div>
                        {/* اضافی — the single loud element; بقایا only, and only when
                            the two sides differ (equal ⇒ no excess ⇒ no band). The
                            value is always positive; the label carries the direction. */}
                        {status === 'bakaya' && sellAmt !== buyAmt && (
                          <div className="flex items-center justify-between px-3 py-2 bg-amber-100">
                            <span className="urdu font-bold text-[15px]">{sellAmt > buyAmt ? 'اضافی فروخت' : 'اضافی خرید'}</span>
                            <span className="tabular-nums font-bold text-[17px]" dir="ltr">{fmtMoney(Math.abs(sellAmt - buyAmt))}</span>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Styled confirmation — replaces window.confirm. Backdrop click or نہیں
          cancels; ہاں moves the row to بھگتان (بقایا) or deletes it (بھگتان). */}
      {confirmId != null && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setConfirmId(null)}>
          <div dir="rtl" className="bg-white rounded-md shadow-lg p-5 w-[320px] max-w-[90vw]" onClick={(e) => e.stopPropagation()}>
            <div className="urdu text-[16px] font-bold text-black text-center mb-4">{confirmAction === 'delete' ? 'کیا آپ اسے ختم کرنا چاہتے ہیں؟' : 'کیا آپ اسے بھگتان میں منتقل کرنا چاہتے ہیں؟'}</div>
            <div className="flex items-center justify-center gap-3">
              <button type="button" onClick={confirmYes} className="urdu bg-emerald-600 text-white text-[15px] font-bold px-6 py-2 rounded-md hover:bg-emerald-700 transition-colors">ہاں</button>
              <button type="button" onClick={() => setConfirmId(null)} className="urdu border border-gray-400 bg-gray-100 text-black text-[15px] font-bold px-6 py-2 rounded-md hover:bg-gray-200 transition-colors">نہیں</button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk confirmation (بقایا) — ONE modal covering every ticked row; ہاں moves
          them all to بھگتان. Backdrop click or نہیں cancels and keeps the ticks. */}
      {confirmBulk && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setConfirmBulk(false)}>
          <div dir="rtl" className="bg-white rounded-md shadow-lg p-5 w-[340px] max-w-[90vw]" onClick={(e) => e.stopPropagation()}>
            <div className="urdu text-[16px] font-bold text-black text-center mb-4">{`کیا آپ منتخب ${selected.size} سودے بھگتان میں منتقل کرنا چاہتے ہیں؟`}</div>
            <div className="flex items-center justify-center gap-3">
              <button type="button" onClick={confirmBulkYes} className="urdu bg-emerald-600 text-white text-[15px] font-bold px-6 py-2 rounded-md hover:bg-emerald-700 transition-colors">ہاں</button>
              <button type="button" onClick={() => setConfirmBulk(false)} className="urdu border border-gray-400 bg-gray-100 text-black text-[15px] font-bold px-6 py-2 rounded-md hover:bg-gray-200 transition-colors">نہیں</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
