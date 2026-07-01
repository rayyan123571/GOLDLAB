import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useApp } from '../state/store.jsx'
import { buildLabReceipt } from '../logic/purity.js'
import { fmtMoney, fmtNum, round, GRAMS_PER_TOLA, GRAMS_PER_RATTI, gramsToTMR } from '../logic/units.js'
import { useClock } from '../logic/useClock.js'
import LeftSidebar from './LeftSidebar.jsx'

// AM/PM time string from a live Date (passed in so the component re-renders).
const fmtTime = (d) => {
  let h = d.getHours()
  const m = String(d.getMinutes()).padStart(2, '0')
  const ap = h >= 12 ? 'PM' : 'AM'
  h = h % 12 || 12
  return `${h}:${m} ${ap}`
}

const dispDate = (iso) => {
  const p = String(iso || '').split('-')
  return p.length === 3 ? `${p[2]}-${p[1]}-${p[0].slice(2)}` : iso
}

// yyyy-mm-dd for a live Date, so it can flow through dispDate().
const isoFrom = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

// Date shown on receipts: the user-entered receipt date if set, else live today.
const showDate = (rates, now) => (rates.date ? dispDate(rates.date) : dispDate(isoFrom(now)))

function Row({ label, value, strong, red, yellow }) {
  return (
    <div className="flex justify-between items-center border-b border-dotted border-gray-300 px-1 py-[1px]">
      {yellow ? (
        <span className="bg-yellowCell border border-line text-[10px] text-center min-w-[70px] px-1 leading-tight">
          {value ?? '-'}
        </span>
      ) : (
        <span className={`urdu text-[10px] ${strong ? 'font-bold' : ''} ${red ? 'text-red-600' : ''}`}>
          {value ?? '-'}
        </span>
      )}
      <span className={`urdu text-[10px] ${red ? 'text-red-600 font-bold' : 'text-gray-700'}`}>{label} :</span>
    </div>
  )
}

// Rate line showing per-tola (right, labelled) and per-gram (left) together.
function RateRow({ rates }) {
  return (
    <div className="flex justify-between items-center border-b border-dotted border-gray-300 px-1 py-[1px]">
      <span className="urdu text-[10px] text-gray-700">
        <b>{fmtNum(rates.rate_tezabi_gram, 0)}</b> ریٹ فی گرام
      </span>
      <span className="urdu text-[10px] text-gray-700">
        <b>{fmtMoney(rates.rate_tezabi_tola)}</b> : ریٹ فی تولہ
      </span>
    </div>
  )
}

// Value renderer that NEVER overflows its box. Numbers (and dates) shrink their
// font-size to fit — so digits are never lost — while plain text (names) is
// truncated with an ellipsis. The element fills its parent (`w-full`, one line),
// and we shrink until scrollWidth ≤ clientWidth. Because the design canvas is a
// fixed size that FitScreen only CSS-transforms, these measurements are stable
// regardless of window size, so a single layout pass on value change suffices.
function FitValue({ value, align = 'right', strong, red, min = 6 }) {
  const ref = useRef(null)
  const raw = value === null || value === undefined || value === '' ? '-' : String(value)
  // Digits plus number/date punctuation only → treat as numeric (shrink, keep all
  // digits). Anything with letters (names) → text (ellipsis is acceptable there).
  const numeric = /\d/.test(raw) && /^[\d.,:\-−()%/\s]+$/.test(raw)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.fontSize = '' // reset to the inherited size before measuring
    if (!numeric || !el.clientWidth) return
    let size = parseFloat(getComputedStyle(el).fontSize) || 10
    let guard = 0
    while (el.scrollWidth > el.clientWidth && size > min && guard < 30) {
      size -= 0.5
      el.style.fontSize = `${size}px`
      guard++
    }
  }, [raw, numeric, min])

  const alignCls = align === 'center' ? 'text-center' : align === 'left' ? 'text-left' : 'text-right'
  return (
    <span
      ref={ref}
      dir="ltr"
      className={`block w-full whitespace-nowrap overflow-hidden ${numeric ? '' : 'text-ellipsis'} ${alignCls} ${strong ? 'font-bold' : ''} ${red ? 'text-red-600' : ''}`}
    >
      {raw}
    </span>
  )
}

// One label:value field for the two-column receipt forms. Label sits on the
// right (RTL), the value / yellow box fills the space to its left and is
// right-aligned against the label. Values can never spill the panel border:
// min-w-0 lets the value box shrink, overflow-hidden clips, and FitValue keeps
// numbers readable (shrink-to-fit) and text tidy (ellipsis).
function Fld({ label, value, yellow, red, strong }) {
  return (
    <div className="flex items-center gap-1 w-full min-w-0 px-2 border-b border-dotted border-gray-300 min-h-[19px]">
      <span dir="rtl" className={`urdu shrink-0 whitespace-nowrap ${yellow ? 'text-[9px]' : 'text-[10px]'} ${red ? 'text-red-600 font-bold' : 'text-gray-700'}`}>
        {label} :
      </span>
      {yellow ? (
        <div className="bg-yellowCell border border-line text-[9px] leading-tight px-2 py-[1px] flex-1 min-w-0 overflow-hidden box-border">
          <FitValue value={value} align="right" />
        </div>
      ) : (
        <div className={`text-[10px] flex-1 min-w-0 overflow-hidden ${red ? 'text-red-600' : ''}`}>
          <FitValue value={value} align="right" strong={strong} red={red} />
        </div>
      )}
    </div>
  )
}

// A form line carrying a right field and (optionally) a left field — mirrors the
// two-column label/value grid of the reference وصولی / لیب receipts.
function FLine({ right, left, mid }) {
  return (
    <div dir="rtl" className="flex items-stretch">
      <div className="flex-1 min-w-0">{right ? <Fld {...right} /> : null}</div>
      {mid ? <div className="flex-1 min-w-0"><Fld {...mid} /></div> : null}
      <div className="flex-1 min-w-0">{left ? <Fld {...left} /> : null}</div>
    </div>
  )
}

// Reusable raised action button — consistent look/size across all four receipts.
// variant: undefined (grey) | 'green' (WhatsApp) | 'red' (X).
function Btn({ children, onClick, variant, title, className = '' }) {
  const v = variant === 'green' ? 'abtn-green' : variant === 'red' ? 'abtn-red' : ''
  return (
    <button type="button" title={title} onClick={onClick} className={`abtn ${v} ${className}`}>
      {children}
    </button>
  )
}

// "Saved" confirmation tick under a receipt — auto-checks after a successful DB
// save of that section (driven by the store's savedFlags; read-only for the user).
function SavedChk({ on }) {
  return (
    <label className="flex items-center gap-1 text-[10px] urdu cursor-default">
      <input type="checkbox" checked={!!on} readOnly className={on ? 'accent-emerald-600' : ''} />
      {on ? 'محفوظ ✓' : 'Saved'}
    </label>
  )
}

function ActionBar({ children, onWa, onPrint }) {
  return (
    <div className="flex flex-wrap items-center gap-1 mt-1 px-1 pb-1">
      {children}
      <div className="flex-1 min-w-0" />
      <Btn variant="green" onClick={onWa}>WhatsApp</Btn>
      <Btn title="پرنٹ" onClick={onPrint}>🖨</Btn>
    </div>
  )
}

const waOpen = (mobile, text) => {
  const num = String(mobile || '').replace(/[^0-9]/g, '')
  const url = `https://wa.me/${num}?text=${encodeURIComponent(text)}`
  if (typeof window !== 'undefined') window.open(url, '_blank')
}

/* 1) وصولی رسید — Recovery Receipt */
function RecoveryReceipt({ row, lab, ctx }) {
  const { customer, receiptNo, rates, ujratKaSona } = ctx
  const now = useClock()
  // اجرت کا سونا checkbox: convert the labour charge (PKR) into its gold weight
  // at the per-tola rate (grams = money / ratePerTola * GRAMS_PER_TOLA). When on,
  // the cash اجرت کی رقم field zeroes out and the gold weight shows instead.
  const ujratGold = lab?.ratePerTola
    ? (Number(row?.labCharges) || 0) / lab.ratePerTola * GRAMS_PER_TOLA
    : 0
  // Each row grows (flex-1) so rows never bunch at the top, but is capped at a
  // comfortable height so they never over-stretch in a tall panel — giving even,
  // moderate line spacing (not too much, not too little).
  const R = ({ children, top }) => (
    <div className={`flex-1 flex flex-col justify-center ${top ? 'border-t border-line' : ''}`}>
      {children}
    </div>
  )
  return (
    <div className="receipt-panel border border-line bg-white flex flex-col h-full">
      <div className="panel-title urdu flex items-center justify-center relative">
        <span>وصولی رسید</span>
        <span className="absolute left-1 bg-header border border-line text-[10px] font-normal px-2">{fmtTime(now)}</span>
      </div>
      {/* Row-based two-column form; rows evenly distributed to fill the panel. */}
      <div className="flex-1 flex flex-col" dir="rtl">
        <R>
          <FLine
            right={{ label: 'رسید نمبر', value: receiptNo, strong: true }}
            left={{ label: 'تاریخ', value: `${fmtTime(now)}  ${showDate(rates, now)}`, strong: true }}
          />
        </R>
        <R><Fld label="نام" value={customer.name || '-'} /></R>

        <R>
          <FLine
            right={{ label: 'ریٹ فی تولہ', value: fmtMoney(lab?.ratePerTola) }}
            left={{ label: 'پرچون وزن', value: fmtNum(row?.malawat) }}
          />
        </R>
        <R><FLine left={{ label: 'خالص وزن', value: fmtNum(row?.khalisSona) }} /></R>
        <R>
          <FLine
            right={{ label: 'اجرت کی رقم', value: ujratKaSona ? '-' : fmtMoney(row?.labCharges) }}
            left={{ label: 'اجرت کا سونا', value: ujratKaSona ? fmtNum(ujratGold) : '-' }}
          />
        </R>
        <R><FLine left={{ label: 'سونا دینا ہے', value: '-' }} /></R>

        <R top>
          <FLine
            right={{ label: 'کیش دیا', value: '#Num!', strong: true }}
            left={{ label: 'کیش کا سونا', value: '-', yellow: true }}
          />
        </R>
        <R>
          <FLine
            right={{ label: 'اجرت لینی ہے', value: '-', yellow: true }}
            left={{ label: 'خالص سونا دیا', value: '-', yellow: true }}
          />
        </R>

        <R top><FLine right={{ label: 'اجرت وصول', value: '-' }} /></R>
        <R>
          <FLine
            right={{ label: 'ڈسکاؤنٹ', value: '-' }}
            left={{ label: 'باقی', value: fmtMoney(row?.baqiRaqam), yellow: true }}
          />
        </R>
      </div>
      <ActionBar
        onWa={() => waOpen(customer.mobile, `وصولی رسید نمبر ${receiptNo}\nخالص سونا: ${fmtNum(row?.khalisSona)}\nباقی: ${fmtMoney(row?.baqiRaqam)}`)}
        onPrint={() => ctx.printSlips()}
      >
        <SavedChk on={ctx.savedFlags?.wasooli} />
      </ActionBar>

    </div>
  )
}

/* 2) لیب رسید — Lab Receipt */
function LabReceipt({ row, lab, ctx }) {
  const { customer, receiptNo, rates } = ctx
  const now = useClock()
  // ONE shared 6-col grid (left -> right): گرام | ملی گرام | تولہ | ماشہ | رتی | label.
  // Every row uses it (with column spans) so the whole receipt stays aligned.
  const LG = { gridTemplateColumns: '1fr 1.2fr 0.55fr 0.55fr 0.55fr 78px' }
  // ملی گرام column = the .xxxx fraction of the gram value, as a padded 4-digit
  // number (e.g. 11.6640 -> "6640", 1.0375 -> "0375", 10.6265 -> "6265").
  const mg = (grams) => {
    const frac = Math.round(((Number(grams) || 0) % 1) * 10000)
    return String(frac).padStart(4, '0')
  }
  // گرام column = the whole-gram part (11.664 -> 11).
  const gWhole = (grams) => Math.floor(Number(grams) || 0)
  const C = ({ children, cls = '', span }) => (
    <div className={`flex items-center justify-center min-w-0 text-[10px] ${cls}`} style={span ? { gridColumn: `span ${span}` } : undefined}>{children}</div>
  )
  const Lb = ({ children, cls = '', span }) => (
    <div className={`flex items-center justify-end pr-1 min-w-0 text-[9px] urdu ${cls}`} style={span ? { gridColumn: `span ${span}` } : undefined}>{children}</div>
  )
  // Each row grows (flex-1) to share the panel height evenly but is capped so it
  // never over-stretches — same moderate spacing as the وصولی رسید. The 6-col
  // grid (column widths) is untouched; only the row's vertical size changes.
  const Row = ({ children }) => (
    <div className="grid border-b border-gray-300 flex-1" style={LG}>{children}</div>
  )
  const div = 'border-l border-gray-400' // faint vertical divider after ملی گرام
  return (
    <div className="receipt-panel border border-line bg-white flex flex-col h-full">
      <div className="panel-title urdu">لیب رسید</div>
      <div className="flex-1 px-1 pt-[2px] flex flex-col">
        {/* header */}
        <Row>
          <C cls="urdu">گرام</C>
          <C cls="urdu text-red-600">ملی گرام</C>
          <C cls={`urdu ${div}`}>تولہ</C>
          <C cls="urdu">ماشہ</C>
          <C cls="urdu text-red-600">رتی</C>
          <C> </C>
        </Row>
        {/* آمد / ملاوٹ / خالص وزن — each weight gets its OWN gram->tola/masha/ratti */}
        {[
          { label: 'آمدوزن', grams: lab?.aamadWazan || 0, tmr: lab?.grossTMR, red: true },
          { label: 'ملاوٹ وزن', grams: lab?.malawatWazan || 0, tmr: lab?.malawatTMR, red: true },
          { label: 'خالص وزن', grams: lab?.khalisWazan || 0, tmr: lab?.khalisTMR, strong: true }
        ].map((r, i) => (
          <Row key={i}>
            <C>{gWhole(r.grams)}</C>
            <C cls={r.strong ? 'font-bold' : ''}>{mg(r.grams)}</C>
            <C cls={div}>{fmtNum(r.tmr?.tola, 0)}</C>
            <C>{fmtNum(r.tmr?.masha, 0)}</C>
            <C>{fmtNum(r.tmr?.ratti, 2)}</C>
            <Lb cls={r.red ? 'text-red-600' : ''}>{r.label}</Lb>
          </Row>
        ))}
        {/* ملاوٹ فی تولہ — value (0.0889) + its masha/ratti breakdown */}
        <Row>
          <C>{fmtNum(lab?.malawatPerGram, 4)}</C>
          <C cls="urdu text-red-600">فی گرام</C>
          <C cls={div}>{fmtNum(lab?.milawatFiTolaTMR?.tola, 0)}</C>
          <C>{fmtNum(lab?.milawatFiTolaTMR?.masha, 0)}</C>
          <C>{fmtNum(lab?.milawatFiTolaTMR?.ratti, 2)}</C>
          <Lb cls="text-red-600">ملاوٹ فی تولہ</Lb>
        </Row>
        {/* کیرٹ | ریٹ فی تولہ */}
        <Row>
          <C>{fmtMoney(lab?.ratePerTola)}</C>
          <Lb span={2}>ریٹ فی تولہ</Lb>
          <C> </C>
          <C>{fmtNum(lab?.keerat, 2)}</C>
          <Lb>کیرٹ</Lb>
        </Row>
        {/* The cramped total/charges/baqaya line is split into TWO rows so the big
            money numbers each get room and never overlap. Each is a simple flex
            row (label on the right via row-reverse), charges as a single number.
            DOM order is [label, …numbers] so row-reverse puts the label rightmost. */}
        {/* Row 1 (RTL): ٹوٹل رقم · total · چارجز · charges. Each label is ONE clean
            .urdu text node with dir=rtl so the Nastaliq letters join correctly
            (no Lb flex-wrapper, no split). چارجز labels the charges number. */}
        <div className="laib-total-row border-b border-gray-300 flex-1">
          <span className="urdu" dir="rtl">ٹوٹل رقم</span>
          <span className="num">{fmtMoney(lab?.totalRaqam)}</span>
          <span className="urdu" dir="rtl">چارجز</span>
          <span className="num">{fmtMoney(lab?.charges)}</span>
        </div>
        {/* Row 2 (RTL): بقایا رقم · baqaya value (highlighted box) */}
        <div className="laib-baqaya-row border-b border-gray-300 flex-1">
          <span className="urdu" dir="rtl">بقایا رقم</span>
          <span className="num bg-yellowCell border border-line text-red-600">{fmtMoney(lab?.baqi)}</span>
        </div>
        {/* نام | پوائنٹ (khalis fraction 0.9111) */}
        <Row>
          <C>{fmtNum(lab?.point, 4)}</C>
          <Lb>پوائنٹ</Lb>
          <C span={3} cls="border-b border-gray-400">{customer.name || ' '}</C>
          <Lb>نام</Lb>
        </Row>
        {/* تاریخ row (RTL): تاریخ · date · وقت · time · رتی · ratti — spread evenly
            on one line via flex space-between. Same height as before (flex-1);
            this is a horizontal-spacing-only fix. Labels are clean .urdu spans. */}
        <div className="laib-date-row border-b border-gray-300 flex-1">
          <span className="urdu" dir="rtl">تاریخ</span>
          <span className="num">{showDate(rates, now)}</span>
          <span className="urdu" dir="rtl">وقت</span>
          <span className="num">{fmtTime(now)}</span>
          <span className="urdu" dir="rtl">رتی</span>
          <span className="num">{fmtNum(lab?.milawatTotalRatti, 2)}</span>
        </div>
      </div>
      <ActionBar
        onWa={() => waOpen(customer.mobile, `لیب رسید ${receiptNo}\nخالص وزن: ${fmtNum(lab?.khalisWazan)}\nٹوٹل رقم: ${fmtMoney(lab?.totalRaqam)}`)}
        onPrint={() => ctx.printSlips()}
      >
        <SavedChk on={ctx.savedFlags?.lab} />
        <span className="urdu text-[10px]">رسید</span>
      </ActionBar>
    </div>
  )
}

// Two-column credit-receipt helpers: each side is a {label,value,yellow} field,
// a bare value {bare:true,value} (right-aligned, no label), or null (empty cell).
function CSide({ f }) {
  if (!f) return <div className="flex-1 min-w-0" />
  if (f.bare)
    return (
      <div className="flex-1 min-w-0 px-2 border-b border-dotted border-gray-300 min-h-[19px] flex items-center overflow-hidden text-[10px]">
        <FitValue value={f.value} align="right" />
      </div>
    )
  return <div className="flex-1 min-w-0"><Fld {...f} /></div>
}
function CRow({ right, left }) {
  return (
    <div dir="rtl" className="flex items-stretch">
      <CSide f={right} />
      <CSide f={left} />
    </div>
  )
}

/* 3) ادھار کی رسید — Credit Receipt */
function CreditReceipt({ ctx }) {
  const { customer, receiptNo, rates, bump, hasApi,
    udharGive, udharTake, udharCashGive, udharCashTake } = ctx
  const now = useClock()
  const [led, setLed] = useState({ balance_gold: 0, balance_cash: 0 })
  useEffect(() => {
    if (hasApi && customer.id)
      window.api.getCustomerLedger(customer.id).then((l) => setLed(l || { balance_gold: 0, balance_cash: 0 }))
    else setLed({ balance_gold: 0, balance_cash: 0 })
  }, [customer.id, bump, hasApi])

  // Live ادھار transaction figures — same ratti-scale formula as the panel's
  // GoldRow. null when a gold row's wazan is empty so the field shows '-'.
  const calcGold = (st) => {
    if (!st) return null
    const wazan = Number(st.wazan) || 0
    if (wazan <= 0) return null
    const point = Number(st.point) || 0
    const above = point - 100
    const deduction = (above / 100) * (wazan / GRAMS_PER_TOLA) * GRAMS_PER_RATTI
    const khalis = round(wazan - deduction, 3)
    const rate = st.rate === '' ? (Number(rates.rate_tezabi_tola) || 0) : Number(st.rate)
    const qeemat = round(khalis / GRAMS_PER_TOLA * rate, 0)
    return { wazan, khalis, rate, qeemat, tmr: gramsToTMR(khalis) }
  }
  const gGive = udharGive ? calcGold(udharGive) : null // gold given
  const gTake = udharTake ? calcGold(udharTake) : null // gold taken
  const cGive = Number(udharCashGive) || 0
  const cTake = Number(udharCashTake) || 0
  // One shared point for the gold block — from whichever entry has a weight.
  const activePoint = (Number(udharGive?.wazan) > 0) ? udharGive?.point
                    : (Number(udharTake?.wazan) > 0) ? udharTake?.point
                    : null
  // This transaction's net (give − take); previous ledger balance + net = new باقی.
  const netGold = (gGive?.khalis || 0) - (gTake?.khalis || 0)
  const netCash = cGive - cTake
  // Final gold balance = previous ledger balance + this transaction's net.
  // Shop convention: give MORE than you take (net > 0) -> the customer owes YOU
  // that gold -> "لینا" (to take). Net < 0 -> you owe them -> "دینا".
  const finalGold = (led?.balance_gold || 0) + netGold
  // Same orientation for cash: previous balance + this transaction's net.
  // net > 0 -> customer owes YOU -> "لینا"; net < 0 -> you owe them -> "دینا".
  const finalCash = (led?.balance_cash || 0) + netCash
  // Each row grows (flex-1) so rows fill the panel evenly instead of bunching at
  // the top, but is capped at a comfortable height so they never over-stretch.
  const R = ({ children }) => (
    <div className="flex-1 flex flex-col justify-center">{children}</div>
  )
  return (
    <div className="receipt-panel border border-line bg-white flex flex-col h-full">
      <div className="panel-title urdu">ادھار کی رسید</div>
      <div className="flex-1 px-1 pt-1 flex flex-col" dir="rtl">
        {/* رسید نمبر + تاریخ */}
        <R>
          <FLine
            right={{ label: 'رسید نمبر', value: receiptNo }}
            left={{ label: 'تاریخ', value: `${fmtTime(now)}  ${showDate(rates, now)}`, strong: true }}
          />
        </R>
        <R><Fld label="نام" value={customer.name || '-'} /></R>

        {/* ---- Gold block ---- */}
        <R><CRow right={{ label: 'تیزابی دیا', value: gGive ? fmtNum(gGive.wazan) : '-' }} left={{ label: 'خالص وزن', value: gGive ? fmtNum(gGive.khalis) : '-' }} /></R>
        <R><CRow right={{ label: 'تیزابی لیا', value: gTake ? fmtNum(gTake.wazan) : '-' }} left={{ label: 'خالص وزن', value: gTake ? fmtNum(gTake.khalis) : '-' }} /></R>
        {/* پوائنٹ on its own line in the empty space below تیزابی لیا. */}
        <R><CRow right={{ label: 'پوائنٹ', value: activePoint != null ? fmtNum(Number(activePoint), 0) : '-' }} left={null} /></R>
        <R><CRow right={null} left={{ label: 'باقی', value: netGold ? fmtNum(netGold) : '-' }} /></R>
        <R><CRow right={{ bare: true, value: fmtNum(led?.balance_gold) }} left={{ label: 'سابقہ سونا بیلنس', value: fmtNum(led?.balance_gold) }} /></R>
        <R><CRow right={null} left={{ label: 'باقی تیزابی دینا ہے', value: finalGold < 0 ? fmtNum(Math.abs(finalGold)) : '-', yellow: true }} /></R>
        <R><CRow right={null} left={{ label: 'باقی تیزابی لینا ہے', value: finalGold > 0 ? fmtNum(finalGold) : '-', yellow: true }} /></R>

        <div className="border-t border-line my-[1px]" />

        {/* ---- Cash block ---- */}
        <R><CRow right={{ label: 'کیش۔ دیا', value: cGive ? fmtMoney(cGive) : '-' }} left={{ label: 'کیش۔ لیا', value: cTake ? fmtMoney(cTake) : '-' }} /></R>
        <R><CRow right={null} left={{ label: 'باقی', value: netCash ? fmtMoney(netCash) : '-' }} /></R>
        <R><CRow right={{ bare: true, value: fmtMoney(led?.balance_cash) }} left={{ label: 'سابقہ کیش بیلنس', value: fmtMoney(led?.balance_cash) }} /></R>
        <R><CRow right={null} left={{ label: 'باقی کیش دینا ہے', value: finalCash < 0 ? fmtMoney(Math.abs(finalCash)) : '-', yellow: true }} /></R>
        <R><CRow right={null} left={{ label: 'باقی کیش لینا ہے', value: finalCash > 0 ? fmtMoney(finalCash) : '-', yellow: true }} /></R>
      </div>
      <ActionBar
        onWa={() => waOpen(customer.mobile, `ادھار رسید\nنام: ${customer.name}\nباقی سونا: ${fmtNum(led?.balance_gold)}\nباقی کیش: ${fmtMoney(led?.balance_cash)}`)}
        onPrint={() => ctx.printSlips()}
      >
        <SavedChk on={ctx.savedFlags?.udhar} />
        <Btn onClick={() => ctx.refresh()}>Refresh</Btn>
      </ActionBar>
    </div>
  )
}

/* 4) نقد کی رسید — Cash Receipt (رسید سونا خرید) */
function CashReceipt({ ctx }) {
  const { customer, receiptNo, rates, cashSell, cashBuy } = ctx
  const now = useClock()
  // Active نقد entry = whichever of فروخت / خرید has a non-zero سونا وزن. Its
  // figures use the SAME ratti-scale formula as the نقد panel's GoldRow.
  const active = (Number(cashSell.wazan) > 0) ? { ...cashSell, kind: 'فروخت' }
               : (Number(cashBuy.wazan) > 0) ? { ...cashBuy, kind: 'خرید' }
               : null

  let v = null
  if (active) {
    const wazan = Number(active.wazan) || 0
    const point = Number(active.point) || 0
    const above = point - 100
    const deduction = (above / 100) * (wazan / GRAMS_PER_TOLA) * GRAMS_PER_RATTI
    const khalis = round(wazan - deduction, 3)
    const rate = active.rate === '' ? (Number(rates.rate_tezabi_tola) || 0) : Number(active.rate)
    const qeemat = round(khalis / GRAMS_PER_TOLA * rate, 0)
    v = { wazan, point, khalis, rate, qeemat, kind: active.kind,
          grossTMR: gramsToTMR(wazan), khalisTMR: gramsToTMR(khalis) }
  }
  // Mini TMR band grid (RTL right->left): پوائنٹ | label | value | رتی | ماشہ | تولہ.
  // columnGap keeps adjacent cells (e.g. پوائنٹ and سونا وزن) from abutting so the
  // Urdu labels don't read as merged. Column widths are unchanged.
  // Order (RTL right->left): پوائنٹ | label | value | رتی | ماشہ | تولہ. value is
  // a fixed 64px (was 1fr, which stole space and spread the receipt), so the
  // label 1fr absorbs the slack; رتی widened to 34px so "5.76" no longer clips.
  const tmrGrid = { gridTemplateColumns: '30px 1fr 64px 34px 28px 28px', columnGap: 4 }
  // Each row grows (flex-1) so rows fill the panel evenly instead of bunching at
  // the top, but is capped at a comfortable height so they never over-stretch.
  const R = ({ children }) => (
    <div className="flex-1 flex flex-col justify-center">{children}</div>
  )
  return (
    <div className="receipt-panel border border-line bg-white flex flex-col h-full">
      <div className="panel-title urdu">نقد کی رسید</div>
      <div className="urdu text-center text-[12px] font-bold py-[2px]">{`رسید سونا ${v ? v.kind : 'خرید'}`}</div>
      <div className="flex-1 px-1 pt-1 flex flex-col" dir="rtl">
        {/* رسید نمبر + تاریخ on one row */}
        <R>
          <FLine
            right={{ label: 'رسید نمبر', value: receiptNo }}
            left={{ label: 'تاریخ', value: `${fmtTime(now)}  ${showDate(rates, now)}`, strong: true }}
          />
        </R>
        {/* نام full width */}
        <R><Fld label="نام" value={customer.name || '-'} /></R>
        {/* ریٹ فی تولہ + ریٹ فی گرام on one row */}
        <R>
          <FLine
            right={{ label: 'ریٹ فی تولہ', value: v ? fmtMoney(v.rate) : (rates.rate_tezabi_tola ?? '-') }}
            left={{ label: 'ریٹ فی گرام', value: v ? fmtMoney(round(v.rate / GRAMS_PER_TOLA, 0)) : '-' }}
          />
        </R>

        {/* TMR header: checkbox (right) + تولہ|ماشہ|رتی(red) */}
        <R>
          <div className="grid items-center mt-[1px]" style={tmrGrid}>
            <div className="flex"><input type="checkbox" className="scale-90" /></div>
            <div></div>
            <div></div>
            <div dir="rtl" className="urdu text-[9px] text-red-600 text-center">رتی</div>
            <div dir="rtl" className="urdu text-[9px] text-center">ماشہ</div>
            <div dir="rtl" className="urdu text-[9px] text-center">تولہ</div>
          </div>
        </R>
        {/* سونا وزن row — پوائنٹ label sits on the right */}
        <R>
          <div className="grid items-center" style={tmrGrid}>
            <div dir="rtl" className="urdu text-[10px] text-center border-b border-gray-400">پوائنٹ</div>
            <div dir="rtl" className="urdu text-[10px] text-right whitespace-nowrap">سونا وزن :</div>
            <div className="text-[10px] text-center border-b border-gray-400" dir="ltr">{v ? fmtNum(v.wazan) : '-'}</div>
            <div className="text-[10px] text-center whitespace-nowrap">{v ? fmtNum(v.grossTMR.ratti, 2) : '-'}</div>
            <div className="text-[10px] text-center whitespace-nowrap">{v ? fmtNum(v.grossTMR.masha, 0) : '-'}</div>
            <div className="text-[10px] text-center whitespace-nowrap">{v ? fmtNum(v.grossTMR.tola, 0) : '-'}</div>
          </div>
        </R>
        {/* خالص وزن row — پوائنٹ value (100) sits on the right */}
        <R>
          <div className="grid items-center" style={tmrGrid}>
            <div className="text-[10px] text-center font-bold" dir="ltr">{v ? fmtNum(v.point, 0) : '-'}</div>
            <div dir="rtl" className="urdu text-[10px] text-right whitespace-nowrap">خالص وزن :</div>
            <div className="text-[10px] text-center border-b border-gray-400" dir="ltr">{v ? fmtNum(v.khalis) : '-'}</div>
            <div className="text-[10px] text-center whitespace-nowrap">{v ? fmtNum(v.khalisTMR.ratti, 2) : '-'}</div>
            <div className="text-[10px] text-center whitespace-nowrap">{v ? fmtNum(v.khalisTMR.masha, 0) : '-'}</div>
            <div className="text-[10px] text-center whitespace-nowrap">{v ? fmtNum(v.khalisTMR.tola, 0) : '-'}</div>
          </div>
        </R>

        <div className="border-t border-line mt-1" />
        <R><Fld label="کل قیمت" value={v ? fmtMoney(v.qeemat) : '-'} /></R>
        <R><Fld label="رقم دی" value={v ? fmtMoney(v.qeemat) : '-'} /></R>
      </div>
      <div className="flex flex-wrap items-center gap-1 px-1 pb-1">
        <SavedChk on={ctx.savedFlags?.naqad} />
        <div className="flex-1 min-w-0" />
        <Btn variant="green"
          onClick={() => waOpen(customer.mobile, `نقد رسید ${receiptNo}\nنام: ${customer.name}`)}>WhatsApp</Btn>
        <Btn title="پرنٹ" onClick={() => ctx.printSlips()}>🖨</Btn>
      </div>
    </div>
  )
}

// LEFT half receipts: sidebar + وصولی رسید + لیب رسید
export function LeftReceipts() {
  const ctx = useApp()
  const selected = ctx.computedRows.find((r) => r.parchi) || ctx.computedRows[2] // default Standard
  const lab = selected ? buildLabReceipt(selected, ctx.input, ctx.rates) : null
  return (
    <div dir="ltr" className="flex gap-1 h-full">
      <LeftSidebar />
      <div className="flex-1 min-w-0"><RecoveryReceipt row={selected} lab={lab} ctx={ctx} /></div>
      <div className="flex-1 min-w-0"><LabReceipt row={selected} lab={lab} ctx={ctx} /></div>
    </div>
  )
}

// RIGHT half receipts: ادھار کی رسید + نقد کی رسید — split into two equal halves.
export function RightReceipts() {
  const ctx = useApp()
  return (
    <div dir="ltr" className="flex gap-1 h-full">
      <div className="flex-1 min-w-0"><CreditReceipt ctx={ctx} /></div>
      <div className="flex-1 min-w-0"><CashReceipt ctx={ctx} /></div>
    </div>
  )
}
