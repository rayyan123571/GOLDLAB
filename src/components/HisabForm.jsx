import React, { useEffect, useState } from 'react'
import { fmtMoney } from '../logic/units.js'
import { useApp } from '../state/store.jsx'
import { sumAmount, sumWazan } from '../logic/nayaSoda.js'

// حساب — a read-only position panel. It holds TWO calculations, each the same
// ladder over a different quantity:
//     بقایا کیش    — the shop's net cash right now (rupees)
//     بقایا تیزابی — the shop's net تیزابی right now (grams)
// It only READS (the store totals, two *BalanceNet calls, and the بقایا نیا سودا
// rows) and adds them up; it writes, prints and persists nothing. Modal shell
// mirrors AkhrajatForm.
//
// The ladder (top → bottom), same shape both times:
//     opening  +  لینا/لینی ہے  =  میزان
//     میزان  ±  بقایا سودا  =  میزان
//     میزان  −  دینا/دینی ہے  =  بقایا …
// Every step is shown so a shopkeeper can check it by hand — an unverifiable
// number is one he won't trust.
//
// The بقایا سودا rule FLIPS between the two, and that is the whole point of
// keeping them separate: a pending فروخت brings cash IN but sends metal OUT, so
// اضافی فروخت adds on the cash ladder and subtracts on the تیزابی one.

const hasApi = () => typeof window !== 'undefined' && window.api

// Formatters that can never emit "-0": Math.round(-0.3) is -0 and
// (-0).toLocaleString() renders "-0", which reads as a bug in a cash figure.
// `|| 0` collapses -0 (falsy) to +0; every other value passes through.
const money = (v) => fmtMoney((Math.round(Number(v) || 0)) || 0)
// Grams at a fixed 3dp — the same precision the تیزابی box and the تیزابی
// لینا/دینا reports round to. Not fmtNum: that renders 0 as "-", and a zero step
// in a visible chain has to read as 0.
const grams = (v) => ((Math.round((Number(v) || 0) * 1000) / 1000) || 0)
  .toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 })

// ── بقایا سودا — the ONE step whose QUANTITY differs between the two ladders ───
// Both return { label, op, value } — which excess it is, the sign to APPLY, and
// the magnitude to show. Both use the SAME rule: the NET of the two sides, not
// the whole heavier side. Only the quantity being netted differs:
//
//   کیش   — net رقم: فروخت رقم − خرید رقم. Both sides are money and they cancel,
//           so a خرید debt and a فروخت credit net to one figure.
//   تیزابی — net وزن: خرید وزن − فروخت وزن. خرید 36.430 against فروخت 35.980 is
//           one 0.450 اضافی خرید, and only that 0.450 enters the sum.
//
// Sign, both ladders: + when the shop GAINS that quantity. A pending فروخت
// brings cash IN but sends metal OUT, which is why the sign flips between them.
// A dead-even سودا shows 0 with no sign — a missing step in a visible chain
// reads as a bug.
const cashSoda = (buyRows, sellRows) => {
  const net = sumAmount(sellRows) - sumAmount(buyRows)
  return {
    label: net > 0 ? 'بقایا سودا (اضافی فروخت)' : net < 0 ? 'بقایا سودا (اضافی خرید)' : 'بقایا سودا',
    op: net > 0 ? '+' : net < 0 ? '−' : null,
    value: Math.abs(net)
  }
}

const tezabiSoda = (buyRows, sellRows) => {
  const net = sumWazan(buyRows) - sumWazan(sellRows)   // metal gained: خرید in − فروخت out
  return {
    label: net > 0 ? 'بقایا سودا (اضافی خرید)' : net < 0 ? 'بقایا سودا (اضافی فروخت)' : 'بقایا سودا',
    op: net > 0 ? '+' : net < 0 ? '−' : null,
    value: Math.abs(net)
  }
}

const BTN = 'urdu text-[16px] font-bold text-black bg-gray-100 border border-gray-400 rounded-sm px-2 py-2.5 min-h-[58px] flex items-center justify-center text-center leading-snug break-words hover:bg-gray-200 active:bg-gray-300 transition-colors'

const TITLE = { baqaya: 'بقایا کیش', tezabi: 'بقایا تیزابی' }

export default function HisabForm({ open, onClose }) {
  const { cashDisplay, totals } = useApp()
  const [view, setView] = useState('menu')      // 'menu' | 'baqaya' | 'tezabi'
  const [status, setStatus] = useState('idle')  // 'idle' | 'loading' | 'ready' | 'error'
  const [data, setData] = useState(null)

  // Reset to the menu every time the modal is (re)opened.
  useEffect(() => {
    if (!open) return
    setView('menu'); setStatus('idle'); setData(null)
  }, [open])

  if (!open) return null

  // Fetch the three live sources in parallel, then snapshot the four figures the
  // ladder needs. The opening figure comes from the store (کیش is already
  // cash − expenses; تیزابی is the تیزابی box), so it is read at compute time, not
  // fetched. بقایا سودا is asked for with NO date bounds: this is a standing
  // position, and filtering it to a day would silently drop every carried-over
  // سودا. `which` picks the cash or the metal column at every step — the two
  // never mix. Any failure → error state and NO total: a wrong position is worse
  // than none.
  const compute = (which) => async () => {
    setView(which); setStatus('loading'); setData(null)
    if (!hasApi()) { setStatus('error'); return }
    const isCash = which === 'baqaya'
    // The SAME call the ادھار form's تیزابی/رقم لینا-دینا buttons make, so the two
    // screens can never disagree. Mind the field names: _netBalanceReport puts the
    // per-row amount under total_khalis but the GRAND total under total_gold —
    // reading total_khalis off the result is undefined, which `|| 0` then silently
    // turns into a zero row.
    const balance = isCash ? window.api.reportCashBalanceNet : window.api.reportGoldBalanceNet
    const totalOf = (res) => Number(isCash ? res.total_cash : res.total_gold) || 0
    try {
      const [lena, dena, bakayaRows] = await Promise.all([
        balance('lena', {}),
        balance('dena', {}),
        window.api.listNayaSoda('bakaya', null, null)
      ])
      if (!lena || !dena || !bakayaRows) { setStatus('error'); return }
      const rows = bakayaRows || []
      const buyRows = rows.filter((r) => r.type === 'khareed')
      const sellRows = rows.filter((r) => r.type === 'farokht')
      setData({
        opening: isCash ? Number(cashDisplay) || 0 : Number(totals.tezabi_sona) || 0,
        // owed TO the shop / owed BY the shop, both positive magnitudes
        lena: totalOf(lena),
        dena: totalOf(dena),
        soda: isCash ? cashSoda(buyRows, sellRows) : tezabiSoda(buyRows, sellRows),
        isCash
      })
      setStatus('ready')
    } catch {
      setStatus('error')
    }
  }

  return (
    <div className="print-overlay fixed inset-0 z-[60] bg-black/50 flex items-start justify-center p-3 pt-[6vh]" onClick={onClose}>
      <div dir="rtl" className="bg-gray-50 border border-gray-300 rounded-xl shadow-2xl w-[480px] max-w-[96vw] max-h-[88vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="shrink-0 flex items-center justify-between bg-gradient-to-b from-slate-700 to-slate-800 text-white px-4 py-3">
          <h2 className="urdu font-bold text-[18px]">حساب</h2>
          <button type="button" onClick={onClose} title="بند کریں" className="w-8 h-8 flex items-center justify-center rounded-md text-slate-200 hover:bg-white/20 transition-colors">✕</button>
        </div>

        {view === 'menu' ? (
          // View 1 — menu. One button per calculation; more are coming and this is
          // the pattern they slot into.
          <div className="flex-1 min-h-0 overflow-auto p-4">
            <div className="grid grid-cols-1 gap-2 w-[300px]">
              <button type="button" className={BTN} onClick={compute('baqaya')}>بقایا کیش</button>
              <button type="button" className={BTN} onClick={compute('tezabi')}>بقایا تیزابی</button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col min-h-0 flex-1">
            <div className="shrink-0 flex items-center gap-2 bg-white border-b border-gray-200 px-4 py-2.5">
              <button type="button" onClick={() => setView('menu')} className="urdu text-[13px] font-bold text-blue-700 border border-blue-200 rounded-md px-3 py-1.5 hover:bg-blue-50 transition-colors">← واپس</button>
              <div className="urdu text-[13px] font-bold text-gray-600">{TITLE[view]}</div>
              <div className="flex-1" />
              {status !== 'loading' && (
                <button type="button" onClick={compute(view)} title="تازہ کریں" className="urdu text-[13px] font-bold text-gray-700 border border-gray-300 rounded-md px-3 py-1.5 hover:bg-gray-100 transition-colors">↻</button>
              )}
            </div>

            <div className="flex-1 min-h-0 overflow-auto p-4">
              {status === 'loading' && (
                <div className="urdu text-[15px] font-bold text-gray-500 text-center py-10">حساب ہو رہا ہے…</div>
              )}
              {status === 'error' && (
                <div className="urdu text-[15px] font-bold text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-4 py-4 text-center">
                  حساب لوڈ نہیں ہو سکا۔ ↻ سے دوبارہ کوشش کریں۔
                </div>
              )}
              {status === 'ready' && data && <BaqayaLadder data={data} />}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// One line of the ladder. `op` is the operator glyph that was APPLIED (+/−); the
// value is the magnitude. Rows with no op (کیش, میزان, بقایا …) show the number
// as-is, so a negative figure carries its own minus sign. `fmt` is money or grams.
function Line({ label, value, op = null, kind = 'row', fmt = money }) {
  const isSub = kind === 'sub'
  const isHero = kind === 'hero'
  const box =
    isHero ? 'bg-amber-100 border-t-2 border-amber-400 px-4 py-3'
    : isSub ? 'bg-white border-t border-gray-300 px-4 py-2'
    : 'px-4 py-2'
  const labelCls =
    isHero ? 'urdu font-bold text-[17px] text-amber-900'
    : isSub ? 'urdu font-bold text-[14px] text-gray-800'
    : 'urdu font-semibold text-[14px] text-gray-700'
  const valCls =
    isHero ? 'tabular-nums font-bold text-[20px] text-amber-900'
    : 'tabular-nums font-bold text-[15px] text-gray-900'
  return (
    <div className={`flex items-center justify-between gap-3 ${box}`}>
      <span className={labelCls}>{label}</span>
      <span className={valCls} dir="ltr">
        {op ? <span className="text-gray-400 mr-1">{op}</span> : null}{fmt(value)}
      </span>
    </div>
  )
}

// The one ladder, driven by whichever quantity was computed. Cash rows are
// رقم/کیش and formatted as money; تیزابی rows are metal and formatted as grams.
function BaqayaLadder({ data }) {
  const { opening, lena, dena, soda, isCash } = data
  // soda.op is the sign to APPLY and soda.value the magnitude, so the arithmetic
  // has to re-apply the sign — never add soda.value blind.
  const signedSoda = soda.op === '−' ? -soda.value : soda.value
  const subtotal = opening + lena       // opening + لینا/لینی ہے
  const total = subtotal + signedSoda   // ± بقایا سودا
  const baqaya = total - dena           // − دینا/دینی ہے

  const fmt = isCash ? money : grams
  const openLabel = isCash ? 'کیش' : 'تیزابی'
  const lenaLabel = isCash ? 'رقم لینی ہے' : 'تیزابی لینا ہے'
  const denaLabel = isCash ? 'رقم دینی ہے' : 'تیزابی دینا ہے'
  const heroLabel = isCash ? 'بقایا کیش' : 'بقایا تیزابی'

  return (
    <div className="bg-white border border-gray-300 rounded-md overflow-hidden">
      <Line label={openLabel} value={opening} fmt={fmt} />
      <Line label={lenaLabel} value={lena} op="+" fmt={fmt} />
      <Line label="میزان" value={subtotal} kind="sub" fmt={fmt} />
      <Line label={soda.label} value={soda.value} op={soda.op} fmt={fmt} />
      <Line label="میزان" value={total} kind="sub" fmt={fmt} />
      <Line label={denaLabel} value={dena} op="−" fmt={fmt} />
      <Line label={heroLabel} value={baqaya} kind="hero" fmt={fmt} />
    </div>
  )
}
