import React, { useState, useEffect, useRef } from 'react'
import { useApp } from '../state/store.jsx'
import { fmtMoney, fmtNum, GRAMS_PER_TOLA, GRAMS_PER_RATTI, round } from '../logic/units.js'

// qeemat (PKR) from pure-gold grams using the per-tola rate.
const qeemat = (khalisGrams, rateTola) =>
  round((Number(khalisGrams) || 0) / GRAMS_PER_TOLA * (Number(rateTola) || 0), 0)

const blankGold = () => ({ wazan: '', point: '100', rate: '' })

// The row-label column is flexible (1fr) so the table fills the whole panel
// width; the five data columns stay at fixed pixel widths like the reference.
const LABEL_W = '1fr'
const WAZAN_W = '84px'
const POINT_W = '78px'
const KHALIS_W = '90px'
const RATE_W = '92px'
const QEEMAT_W = '96px'

const gridStyle = {
  gridTemplateColumns: `${LABEL_W} ${WAZAN_W} ${POINT_W} ${KHALIS_W} ${RATE_W} ${QEEMAT_W}`
}

// A gold row counts as "active" only when its سونا وزن (wazan) holds a non-zero
// number — point defaults to '100', so it alone doesn't make a row active.
const hasData = (st) => String(st.wazan).trim() !== '' && Number(st.wazan) > 0

// One gold line: label (right) + سونا وزن | پوائنٹ | خالص سونا | ریٹ | قیمت.
// `disabled` locks/greys the inputs (used for نقد mutual exclusion).
// `onCommit` (ادھار rows only) fires on BLUR with the row's current state — i.e.
// when a value is actually committed, not on every keystroke.
//
// The row works in BOTH directions. Normally سونا وزن drives the line
// (وزن → خالص سونا → قیمت), but قیمت is editable too and runs the same chain
// backwards (قیمت → خالص سونا → سونا وزن), for the common counter case where the
// customer names a rupee amount instead of a weight. Only wazan/point/rate are
// stored — khalis and the price are derived — so the reverse edit simply writes
// wazan and every other cell recomputes exactly as it always did.
function GoldRow({ label, st, set, rateTola, disabled = false, onCommit }) {
  // Raw text held ONLY while the قیمت cell has focus. Without it the field would
  // fight the typist: each keystroke recomputes wazan, which recomputes the price,
  // which would rewrite the box mid-word.
  const [qEdit, setQEdit] = useState(null)
  // Enter-to-advance focus flow (per-row ref, so wazan → this row's own rate):
  // wazan → (Enter) → rate → (Enter) → blur. point is skipped in the flow —
  // Enter inside point just blurs. Purely focus movement; no data changes.
  const rateRef = useRef(null)
  const onEnterFocusRate = (e) => { if (e.key === 'Enter') { e.preventDefault(); if (rateRef.current) rateRef.current.focus() } }
  const onEnterBlur = (e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() } }
  const wazan = Number(st.wazan) || 0
  const point = Number(st.point) || 0
  // "point" is a purity reading where 100 = maiyar/standard. It adjusts gold on
  // the ratti scale (96 ratti per tola): point>100 deducts, point<100 adds,
  // point=100 leaves wazan unchanged. Symmetric via (point - 100).
  const above = point - 100
  const deduction = (above / 100) * (wazan / GRAMS_PER_TOLA) * GRAMS_PER_RATTI
  const khalis = round(wazan - deduction, 3)
  const rate = st.rate === '' ? rateTola : Number(st.rate)
  const q = qeemat(khalis, rate)
  const lock = disabled ? ' opacity-50 cursor-not-allowed bg-gray-100' : ''
  // ── قیمت → سونا وزن (the inverse of the two lines above) ────────────────────
  //   khalis = price / rate * TOLA                    (inverse of qeemat)
  //   wazan  = khalis / (1 - (point-100)/100 * RATTI/TOLA)   (inverse of deduction)
  // At the standard point of 100 the factor is 1, so wazan == khalis — the same
  // identity the forward direction has.
  const purityFactor = 1 - (above / 100) * (GRAMS_PER_RATTI / GRAMS_PER_TOLA)
  // No rate (or an impossible point) leaves nothing to divide by — the price cell
  // stays locked rather than silently producing a wrong weight.
  const canInvert = rate > 0 && purityFactor > 0
  const wazanFromQeemat = (text) => {
    const price = Number(text)
    if (!Number.isFinite(price) || price <= 0) return ''
    // 4 decimals: 0.0001g is under 2 rupees at shop rates, so the price typed and
    // the price the row shows back agree to the rupee.
    return String(round(price / rate * GRAMS_PER_TOLA / purityFactor, 4))
  }
  return (
    <div className="grid flex-1 min-h-0" style={gridStyle}>
      <div className="cell justify-end pr-1 urdu text-[15px] font-bold text-right leading-tight bg-white">
        {label}
      </div>
      <input dir="ltr" className={`inp-g text-center text-[15px] font-bold${lock}`} value={st.wazan} disabled={disabled}
        onChange={(e) => set({ ...st, wazan: e.target.value })} onKeyDown={onEnterFocusRate}
        onBlur={() => { if (onCommit) onCommit(hasData(st)) }} placeholder="-" />
      <input dir="ltr" className={`inp text-center text-[15px] font-bold${lock}`} value={st.point} disabled={disabled}
        onChange={(e) => set({ ...st, point: e.target.value })} onKeyDown={onEnterBlur} />
      <div className="cell cell-c text-[15px] font-bold">{khalis ? fmtNum(khalis) : '-'}</div>
      <input ref={rateRef} dir="ltr" className={`inp text-center text-[15px] font-bold${lock}`} value={st.rate} disabled={disabled}
        onChange={(e) => set({ ...st, rate: e.target.value })} onKeyDown={onEnterBlur} placeholder={fmtMoney(rateTola)} />
      <input dir="ltr" className={`inp text-center text-[15px] font-bold${lock}`}
        value={qEdit != null ? qEdit : (q ? fmtMoney(q) : '')}
        disabled={disabled || !canInvert}
        // Focus swaps the formatted "444,444" for the plain number, so typing
        // starts from a value the field can actually parse.
        onFocus={() => setQEdit(q ? String(q) : '')}
        onChange={(e) => { setQEdit(e.target.value); set({ ...st, wazan: wazanFromQeemat(e.target.value) }) }}
        onKeyDown={onEnterBlur}
        // Same commit contract as the wazan box: an ادھار row entered by price
        // must trigger the customer-name reminder too.
        onBlur={() => { setQEdit(null); if (onCommit) onCommit(hasData(st)) }}
        placeholder="-" />
    </div>
  )
}

// One cash line: label (right) + ONE merged blank white cell across the four
// middle columns + a single green amount box in the far-left قیمت column.
// `onCommit` — same contract as GoldRow's (blur, ادھار rows only).
function CashRow({ label, st, set, onCommit }) {
  return (
    <div className="grid flex-1 min-h-0" style={gridStyle}>
      <div className="cell justify-end pr-1 urdu text-[15px] font-bold text-right leading-tight bg-white">
        {label}
      </div>
      {/* merged empty cell spanning سونا وزن + پوائنٹ + خالص سونا + ریٹ */}
      <div className="cell bg-white" style={{ gridColumn: 'span 4' }}>&nbsp;</div>
      <input dir="ltr" className="inp-g text-center text-[15px] font-bold" value={st}
        onChange={(e) => set(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() } }}
        onBlur={() => { if (onCommit) onCommit(Number(st) > 0) }}
        placeholder="-" />
    </div>
  )
}

// Header row: dark section title fills the right-hand label column.
function Header({ title }) {
  return (
    <div className="grid flex-1 min-h-0" style={gridStyle}>
      <div className="hdr urdu bg-headerDark font-bold text-[15px]">{title}</div>
      <div className="hdr urdu font-bold text-[14px]">سونا وزن</div>
      <div className="hdr urdu font-bold text-[14px]">پوائنٹ</div>
      <div className="hdr urdu font-bold text-[14px]">خالص سونا</div>
      <div className="hdr urdu font-bold text-[14px]">ریٹ</div>
      <div className="hdr urdu font-bold text-[14px]">قیمت</div>
    </div>
  )
}

export default function CashUdharPanel() {
  const {
    rates, customer, bump, hasApi,
    cashSell, setCashSell, cashBuy, setCashBuy,
    udharGive, setUdharGive, udharTake, setUdharTake,
    udharCashGive, setUdharCashGive, udharCashTake, setUdharCashTake
  } = useApp()
  const rateTola = Number(rates.rate_tezabi_tola) || 0

  const [ledger, setLedger] = useState({ balance_gold: 0, balance_cash: 0 })

  useEffect(() => {
    if (hasApi && customer.id) {
      // Balances only — the two yellow boxes below use nothing else. getCustomerBalance
      // sums them in SQLite; getCustomerLedger (the fallback for an older preload)
      // returns the customer's entire transaction history to compute the same two
      // numbers, which is pure IPC weight on every parchi navigation.
      const read = window.api.getCustomerBalance
        ? window.api.getCustomerBalance(customer.id)
        : window.api.getCustomerLedger(customer.id)
      read.then((l) => setLedger(l || { balance_gold: 0, balance_cash: 0 }))
    } else {
      setLedger({ balance_gold: 0, balance_cash: 0 })
    }
  }, [customer.id, bump, hasApi])

  // ادھار needs a customer — warn EARLY, not only at Save. When an ادھار row is
  // committed (blur) with a real value while no saved customer is selected, pop a
  // one-time reminder. `warnedRef` keeps it from re-firing on every subsequent
  // ادھار blur; it re-arms once a customer IS selected (so the next nameless
  // parchi is warned again). نقد rows and the lab/purity work never call this.
  const [needName, setNeedName] = useState(false)
  const warnedRef = useRef(false)

  useEffect(() => {
    if (customer.id) { warnedRef.current = false; setNeedName(false) }
  }, [customer.id])

  const onUdharCommit = (hasValue) => {
    if (!hasValue || customer.id || warnedRef.current) return
    warnedRef.current = true
    setNeedName(true)
  }

  // نقد mutual exclusion: filling فروخت (sell) or خرید (buy) locks the other.
  // The ادھار rows (give/take) are independent and never locked.
  return (
    <div
      dir="rtl"
      className="cash-udhar flex flex-col h-full gap-y-1"
    >
      {/* نقد (Cash) */}
      <div className="flex flex-col border border-line bg-white overflow-hidden flex-[3]">
        <Header title="نقد" />
        <GoldRow label="فروخت" st={cashSell} set={setCashSell} rateTola={rateTola} disabled={hasData(cashBuy)} />
        <GoldRow label="نقد خریدا" st={cashBuy} set={setCashBuy} rateTola={rateTola} disabled={hasData(cashSell)} />
      </div>

      {/* ادھار (Credit) */}
      <div className="flex flex-col border border-line bg-white overflow-hidden flex-[6]">
        <Header title="ادھار" />
        <GoldRow label="تیزابی دیا" st={udharGive} set={setUdharGive} rateTola={rateTola} onCommit={onUdharCommit} />
        <GoldRow label="تیزابی لیا" st={udharTake} set={setUdharTake} rateTola={rateTola} onCommit={onUdharCommit} />
        <CashRow label="ادھار کیش دیا" st={udharCashGive} set={setUdharCashGive} onCommit={onUdharCommit} />
        <CashRow label="ادھار کیش لیا" st={udharCashTake} set={setUdharCashTake} onCommit={onUdharCommit} />

        {/* Bottom band: ٹوٹل | empty | سونا لین دین | yellow | کیش لین دین | yellow */}
        <div className="grid flex-1 min-h-0" style={gridStyle}>
          {/* col1 (right): ٹوٹل */}
          <div className="cell justify-end pr-1 urdu text-[13px] text-right bg-header font-bold">
            ٹوٹل :
          </div>
          {/* col2: khaali grey cell */}
          <div className="cell bg-header">&nbsp;</div>
          {/* col3: سونا لین دین label (right-aligned, allowed to overflow) */}
          <div className="cell justify-end pr-1 urdu text-[12px] font-bold whitespace-nowrap overflow-visible bg-header">
            سونا لین دین :
          </div>
          {/* col4: gold-ledger yellow box — only for a selected customer */}
          <input dir="ltr" className="inp-y text-center text-[14px] font-bold" value={customer.id ? fmtNum(ledger.balance_gold) : '-'} readOnly />
          {/* col5: کیش لین دین label */}
          <div className="cell justify-end pr-1 urdu text-[12px] font-bold whitespace-nowrap overflow-visible bg-header">
            کیش لین دین :
          </div>
          {/* col6 (left): cash-ledger yellow box — only for a selected customer */}
          <input dir="ltr" className="inp-y text-center text-[14px] font-bold" value={customer.id ? fmtMoney(ledger.balance_cash) : '-'} readOnly />
        </div>
      </div>

      {/* ادھار without a customer — one-time reminder (see onUdharCommit). */}
      {needName && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onMouseDown={() => setNeedName(false)}>
          <div
            className="bg-white border border-line rounded-md shadow-xl px-6 py-5 text-center max-w-xs"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="urdu text-[16px] font-bold text-red-700 leading-relaxed">
              براہِ کرم پہلے کسٹمر کا نام درج کریں
            </div>
            <button
              className="mt-4 px-6 py-1.5 rounded-md bg-blue-600 text-white urdu text-[14px] font-bold hover:bg-blue-700 active:bg-blue-800"
              onClick={() => setNeedName(false)}
              autoFocus
            >
              ٹھیک ہے
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
