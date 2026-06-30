import React, { useEffect, useState } from 'react'
import { useApp } from '../state/store.jsx'
import { buildLabReceipt } from '../logic/purity.js'
import { fmtMoney, fmtNum } from '../logic/units.js'
import LeftSidebar from './LeftSidebar.jsx'

const time = () => {
  const d = new Date()
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

// One label:value field for the two-column receipt forms. Label sits on the
// right (RTL), the value underline / yellow box fills the space to its left.
function Fld({ label, value, yellow, red, strong }) {
  // justify-between + a bigger gap and side padding spread the label (right) and
  // its value (left) with a clear gap and keep both off the panel borders —
  // matching the even spacing used in the Laib receipt. The Urdu label is a
  // single text node so Nastaliq letters join correctly.
  return (
    <div className="flex items-center justify-between gap-3 w-full min-w-0 px-2 border-b border-dotted border-gray-300 min-h-[19px]">
      <span dir="rtl" className={`urdu text-[10px] whitespace-nowrap shrink-0 ${red ? 'text-red-600 font-bold' : 'text-gray-700'}`}>
        {label} :
      </span>
      {yellow ? (
        <span dir="ltr" className="bg-yellowCell border border-line text-[10px] text-center flex-1 min-w-0 leading-tight">
          {value ?? '-'}
        </span>
      ) : (
        <span dir="ltr" className={`text-[10px] text-center flex-1 min-w-0 ${strong ? 'font-bold' : ''} ${red ? 'text-red-600' : ''}`}>
          {value ?? '-'}
        </span>
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
  const { customer, receiptNo, rates } = ctx
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
        <span className="absolute left-1 bg-header border border-line text-[10px] font-normal px-2">{time()}</span>
      </div>
      {/* Row-based two-column form; rows evenly distributed to fill the panel. */}
      <div className="flex-1 flex flex-col" dir="rtl">
        <R>
          <FLine
            right={{ label: 'رسید نمبر', value: receiptNo, strong: true }}
            left={{ label: 'تاریخ', value: `${time()}  ${dispDate(rates.date)}`, strong: true }}
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
            right={{ label: 'اجرت کی رقم', value: fmtMoney(row?.labCharges) }}
            left={{ label: 'اجرت کا سونا', value: '-' }}
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
        onPrint={() => window.print()}
      >
        {['I', 'C', 'R', 'P', 'O', 'Q'].map((b) => (
          <Btn key={b} title={`بٹن ${b}`} onClick={() => console.log(`وصولی رسید: action ${b}`, { receiptNo })}>{b}</Btn>
        ))}
      </ActionBar>
    </div>
  )
}

/* 2) لیب رسید — Lab Receipt */
function LabReceipt({ row, lab, ctx }) {
  const { customer, receiptNo, rates } = ctx
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
          <span className="num">{dispDate(rates.date)}</span>
          <span className="urdu" dir="rtl">وقت</span>
          <span className="num">{time()}</span>
          <span className="urdu" dir="rtl">رتی</span>
          <span className="num">{fmtNum(lab?.milawatTotalRatti, 2)}</span>
        </div>
      </div>
      <ActionBar
        onWa={() => waOpen(customer.mobile, `لیب رسید ${receiptNo}\nخالص وزن: ${fmtNum(lab?.khalisWazan)}\nٹوٹل رقم: ${fmtMoney(lab?.totalRaqam)}`)}
        onPrint={() => window.print()}
      >
        <label className="flex items-center gap-1 text-[10px]"><input type="checkbox" /> Saved</label>
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
      <div className="flex-1 min-w-0 px-2 border-b border-dotted border-gray-300 min-h-[19px] flex items-center justify-end">
        <span dir="ltr" className="text-[10px]">{f.value ?? '-'}</span>
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
  const { customer, receiptNo, rates, bump, hasApi } = ctx
  const [led, setLed] = useState({ balance_gold: 0, balance_cash: 0 })
  useEffect(() => {
    if (hasApi && customer.id) window.api.getCustomerLedger(customer.id).then(setLed)
    else setLed({ balance_gold: 0, balance_cash: 0 })
  }, [customer.id, bump, hasApi])
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
            left={{ label: 'تاریخ', value: `${time()}  ${dispDate(rates.date)}`, strong: true }}
          />
        </R>
        <R><Fld label="نام" value={customer.name || '-'} /></R>
        {/* ریٹ فی تولہ + ریٹ فی گرام */}
        <R>
          <FLine
            right={{ label: 'ریٹ فی تولہ', value: rates.rate_tezabi_tola ?? '-' }}
            left={{ label: 'ریٹ فی گرام', value: rates.rate_tezabi_gram ?? '-' }}
          />
        </R>

        {/* ---- Gold block ---- */}
        <R><CRow right={{ label: 'سونا۔ دیا', value: fmtNum(led.balance_gold) }} left={{ label: 'خالص وزن', value: '-' }} /></R>
        <R><CRow right={{ label: 'سونا۔ لیا', value: '-' }} left={{ label: 'خالص وزن', value: '-' }} /></R>
        <R><CRow right={null} left={{ label: 'باقی', value: '-' }} /></R>
        <R><CRow right={{ bare: true, value: fmtNum(led.balance_gold) }} left={{ label: 'سابقہ سونا بیلنس', value: '-' }} /></R>
        <R><CRow right={{ bare: true, value: '-' }} left={{ label: 'باقی', value: fmtNum(led.balance_gold), yellow: true }} /></R>

        <div className="border-t border-line my-[1px]" />

        {/* ---- Cash block ---- */}
        <R><CRow right={{ label: 'کیش۔ دیا', value: fmtMoney(led.balance_cash) }} left={{ label: 'کیش۔ لیا', value: '-' }} /></R>
        <R><CRow right={null} left={{ label: 'باقی', value: '-' }} /></R>
        <R><CRow right={{ bare: true, value: fmtMoney(led.balance_cash) }} left={{ label: 'سابقہ کیش بیلنس', value: '-' }} /></R>
        <R><CRow right={{ bare: true, value: '-' }} left={{ label: 'باقی', value: fmtMoney(led.balance_cash), yellow: true }} /></R>
      </div>
      <ActionBar
        onWa={() => waOpen(customer.mobile, `ادھار رسید\nنام: ${customer.name}\nباقی سونا: ${fmtNum(led.balance_gold)}\nباقی کیش: ${fmtMoney(led.balance_cash)}`)}
        onPrint={() => window.print()}
      >
        <Btn onClick={() => ctx.refresh()}>Refresh</Btn>
      </ActionBar>
    </div>
  )
}

/* 4) نقد کی رسید — Cash Receipt (رسید سونا خرید) */
function CashReceipt({ ctx }) {
  const { customer, receiptNo, rates } = ctx
  // Mini TMR band grid (RTL right->left): پوائنٹ | label | value | رتی | ماشہ | تولہ.
  // columnGap keeps adjacent cells (e.g. پوائنٹ and سونا وزن) from abutting so the
  // Urdu labels don't read as merged. Column widths are unchanged.
  const tmrGrid = { gridTemplateColumns: '34px 1fr 1fr 22px 22px 26px', columnGap: 6 }
  // Each row grows (flex-1) so rows fill the panel evenly instead of bunching at
  // the top, but is capped at a comfortable height so they never over-stretch.
  const R = ({ children }) => (
    <div className="flex-1 flex flex-col justify-center">{children}</div>
  )
  return (
    <div className="receipt-panel border border-line bg-white flex flex-col h-full">
      <div className="panel-title urdu">نقد کی رسید</div>
      <div className="urdu text-center text-[12px] font-bold py-[2px]">رسید سونا خرید</div>
      <div className="flex-1 px-1 pt-1 flex flex-col" dir="rtl">
        {/* رسید نمبر + تاریخ on one row */}
        <R>
          <FLine
            right={{ label: 'رسید نمبر', value: receiptNo }}
            left={{ label: 'تاریخ', value: `${time()}  ${dispDate(rates.date)}`, strong: true }}
          />
        </R>
        {/* نام full width */}
        <R><Fld label="نام" value={customer.name || '-'} /></R>
        {/* ریٹ فی تولہ + ریٹ فی گرام on one row */}
        <R>
          <FLine
            right={{ label: 'ریٹ فی تولہ', value: rates.rate_tezabi_tola ?? '-' }}
            left={{ label: 'ریٹ فی گرام', value: rates.rate_tezabi_gram ?? '-' }}
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
            <div className="text-[10px] text-center border-b border-gray-400" dir="ltr">-</div>
            <div className="text-[10px] text-center">-</div>
            <div className="text-[10px] text-center">-</div>
            <div className="text-[10px] text-center">-</div>
          </div>
        </R>
        {/* خالص وزن row — پوائنٹ value (100) sits on the right */}
        <R>
          <div className="grid items-center" style={tmrGrid}>
            <div className="text-[10px] text-center font-bold" dir="ltr">{fmtNum(rates.point, 0)}</div>
            <div dir="rtl" className="urdu text-[10px] text-right whitespace-nowrap">خالص وزن :</div>
            <div className="text-[10px] text-center border-b border-gray-400" dir="ltr">-</div>
            <div className="text-[10px] text-center">-</div>
            <div className="text-[10px] text-center">-</div>
            <div className="text-[10px] text-center">-</div>
          </div>
        </R>

        <div className="border-t border-line mt-1" />
        <R><Fld label="کل قیمت" value="-" /></R>
        <R><Fld label="رقم دی" value="-" /></R>
        <div className="border-t border-line" />
        <R><Fld label="بیلنس" value="-" yellow /></R>
      </div>
      <div className="flex flex-wrap items-center gap-1 px-1 pb-1">
        <Btn onClick={() => console.log('نقد رسید: View', { receiptNo, customer: customer.name })}>View</Btn>
        <Btn variant="red" title="منسوخ" onClick={() => ctx.resetEntry()}>X</Btn>
        <Btn onClick={() => ctx.saveCustomer()}>Add</Btn>
        <div className="flex-1 min-w-0" />
        <Btn variant="green"
          onClick={() => waOpen(customer.mobile, `نقد رسید ${receiptNo}\nنام: ${customer.name}`)}>WhatsApp</Btn>
        <Btn title="پرنٹ" onClick={() => window.print()}>🖨</Btn>
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
