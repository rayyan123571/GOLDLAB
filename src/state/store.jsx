import React, { createContext, useContext, useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { computeTable } from '../logic/purity.js'
import { GRAMS_PER_TOLA, GRAMS_PER_RATTI, round } from '../logic/units.js'

// Pure-gold (khalis) + qeemat from a {wazan, point, rate} gold entry — the SAME
// ratti-scale formula the نقد/ادھار panel's GoldRow uses, so a saved transaction
// matches exactly what the operator saw on screen.
function goldFigures(st, rateTola) {
  const wazan = Number(st?.wazan) || 0
  if (wazan <= 0) return null
  const point = Number(st?.point) || 0
  const deduction = ((point - 100) / 100) * (wazan / GRAMS_PER_TOLA) * GRAMS_PER_RATTI
  const khalis = round(wazan - deduction, 3)
  const rate = st.rate === '' || st.rate == null ? (Number(rateTola) || 0) : Number(st.rate)
  const qeemat = round((khalis / GRAMS_PER_TOLA) * rate, 0)
  return { wazan, point, khalis, rate, qeemat }
}

const NO_SAVED = { wasooli: false, lab: false, naqad: false, udhar: false }

const AppCtx = createContext(null)
export const useApp = () => useContext(AppCtx)

// Today's date (LOCAL) as YYYY-MM-DD — the app's date fields default to this,
// never a hardcoded string, so they always show the real current day.
const todayISO = () => {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

// Fallback rates if the DB bridge isn't ready (e.g. running renderer in a
// plain browser without Electron). Keeps the UI alive for development.
const FALLBACK_RATES = {
  date: todayISO(),
  rate_tezabi_tola: 9000,
  parchi_charges: 100,
  fc_per_gram: 80,
  rate_tezabi_gram: 772,
  point: 100,
  slip_count: 1
}

const hasApi = typeof window !== 'undefined' && window.api

// Transient bottom-center toast for print failures — surfaces the reason instead
// of failing silently (a failed print used to look like "nothing happened").
function showPrintError(reason) {
  if (typeof document === 'undefined') return
  const el = document.createElement('div')
  el.dir = 'rtl'
  el.className = 'urdu no-print'
  el.style.cssText =
    'position:fixed;bottom:56px;left:50%;transform:translateX(-50%);z-index:9999;' +
    'background:#b91c1c;color:#fff;padding:10px 18px;border-radius:8px;font-size:14px;' +
    'font-weight:700;box-shadow:0 4px 12px rgba(0,0,0,.35);max-width:80vw;text-align:center'
  el.textContent = `پرنٹ نہیں ہو سکا${reason ? ` (${reason})` : ''} — پرنٹر آن اور کنیکٹڈ چیک کریں`
  document.body.appendChild(el)
  setTimeout(() => el.remove(), 5000)
}

// Generic transient toast (green = success, red = problem) — same style as the
// print-error toast; used by the WhatsApp share to tell the operator the image
// is on the clipboard. Display-only; never throws.
function showToast(text, ok) {
  if (typeof document === 'undefined') return
  try {
    const el = document.createElement('div')
    el.dir = 'rtl'
    el.className = 'urdu no-print'
    el.style.cssText =
      'position:fixed;bottom:56px;left:50%;transform:translateX(-50%);z-index:9999;' +
      `background:${ok ? '#047857' : '#b91c1c'};color:#fff;padding:10px 18px;border-radius:8px;` +
      'font-size:14px;font-weight:700;box-shadow:0 4px 12px rgba(0,0,0,.35);max-width:80vw;text-align:center'
    el.textContent = text
    document.body.appendChild(el)
    setTimeout(() => { try { el.remove() } catch {} }, 6000)
  } catch {}
}

// ── Thermal slip header/footer — STATIC shop-identity text printed above/below
// the cloned receipt panel. Display-only markup: never touches any value.
// Classic bordered header block (reference-receipt style): one clean outer
// rectangle, internal horizontal rules separating name / tagline / phones /
// address. Sizes are DESIGN px — the raster path scales them ×~1.63 onto the
// 576-dot canvas (name ≈ 42px printed, the largest text on the slip).
function buildSlipHeader() {
  const el = document.createElement('div')
  el.dir = 'rtl'
  el.className = 'urdu slip-header'
  el.style.cssText = 'text-align:center;color:#000;border:2px solid #000;padding:3px 4px 0;margin-bottom:5px'
  el.innerHTML =
    '<div style="font-size:26px;font-weight:800;line-height:1.55">چوہدری گولڈ لیبارٹری</div>' +
    // classic double rule under the name (top margin keeps clear of Nastaliq tails)
    '<div style="border-top:2px solid #000;border-bottom:1px solid #000;height:3px;margin:3px 6px 3px"></div>' +
    '<div style="font-size:12px;font-weight:500;line-height:1.9">خالص سونے کی لین دین ۔ ہول سیل جیولری کا مرکز  (جیولری چوڑی میکر)</div>' +
    '<div style="font-size:13.5px;font-weight:600;line-height:1.8">چوہدری ایم رمضان آرائیں&nbsp;&nbsp;<span dir="ltr">0300-7301839</span></div>' +
    '<div style="font-size:14px;font-weight:600;line-height:1.7"><span dir="ltr">0302-7330000</span>&nbsp;&nbsp;&nbsp;&nbsp;<span dir="ltr">0302-3334440</span></div>' +
    // address in its own ruled strip at the bottom of the box
    '<div style="border-top:1.5px solid #000;margin-top:3px;padding:2px 0 4px;font-size:12.5px;font-weight:500;line-height:1.8">نزد موسیٰ پاک دربار صرافہ بازار ملتان</div>'
  return el
}

// Footer: the sona-testing fee paragraph is LAB-ONLY; the software line (with
// Rayyan 0307-6965231) prints on every slip.
function buildSlipFooter(kind) {
  const el = document.createElement('div')
  el.dir = 'rtl'
  el.className = 'urdu'
  el.style.cssText = 'color:#000;margin-top:5px'
  const fee = kind === 'lab'
    ? '<div style="font-size:12.5px;font-weight:500;line-height:2;text-align:right;border:1.5px solid #000;padding:3px 6px;margin-bottom:5px">' +
      'سونا ٹیسٹ کرنے کی فیس 100 روپے اور خالص سونا یا رقم لینے کی صورت میں 40 روپے فی گرام مزدوری ہو گی۔ رزلٹ کے بعد سونا لینے یا رقم لینے کا اندر کا کارندہ پابند نہیں ہو گا۔ سونا صرف رتی کی صورت میں چیک کیا جاتا ہے۔ یہاں خالص سونے کا لین دین کیا جاتا ہے۔' +
      '</div>'
    : ''
  el.innerHTML = fee +
    '<div style="font-size:12px;font-weight:500;line-height:1.9;text-align:center;border-top:2px solid #000;padding-top:4px">' +
    'لیبارٹری، کاسٹنگ سنٹر، ہول سیل شاپ، جیولری شاپ، چوڑی کڑے اور کارخانے کے سوفٹ ویئر دستیاب ہیں۔' +
    '<div dir="ltr" style="font-size:13px;font-weight:800;margin-top:2px">Rayyan&nbsp;&nbsp;0307-6965231</div>' +
    '</div>'
  return el
}

// Build the standalone HTML document the DIRECT thermal raster path renders:
// exactly 576px wide (72.1mm × 8 dots @ 203dpi — the printer's full printable
// band), with a 10px inner safe padding per side so ink never touches the
// physical edge. The receipt keeps its EXACT on-screen layout: the panel is
// cloned at its 341px design width and vector-scaled once to the 556px content
// box — Chromium rasterizes glyphs at the FINAL size (no bitmap resize), and
// the main process hard-thresholds that single render to 1-bit.
function buildRasterSlipHtml(panelEl) {
  try {
    const clone = panelEl.cloneNode(true)
    // cloneNode copies attributes, NOT live input state — and outerHTML only
    // serializes ATTRIBUTES, so live values must be written back as attributes.
    const src = panelEl.querySelectorAll('input, textarea, select')
    const dst = clone.querySelectorAll('input, textarea, select')
    dst.forEach((f, i) => {
      const s = src[i]
      if (!s) return
      if (f.type === 'checkbox' || f.type === 'radio') {
        if (s.checked) f.setAttribute('checked', '')
        else f.removeAttribute('checked')
      } else if (f.tagName === 'TEXTAREA') {
        f.textContent = s.value
      } else if (f.tagName === 'SELECT') {
        Array.from(f.options).forEach((o, j) => {
          if (j === s.selectedIndex) o.setAttribute('selected', '')
          else o.removeAttribute('selected')
        })
      } else {
        f.setAttribute('value', s.value)
      }
    })
    // Rows are flex-1 inside a fixed panel height, so give the clone 1.35× the
    // on-screen height: the larger print typography (below) gets matching row
    // room with tidy (not airy) spacing — width/geometry untouched, the slip
    // just runs a little longer down the roll.
    clone.style.height = `${Math.round((panelEl.offsetHeight || 456) * 1.35)}px`
    // The offscreen page needs the app's real stylesheet (tailwind utilities,
    // receipt-panel rules). Serialize every reachable rule; same-origin in dev
    // (vite) and prod (file://) alike.
    let css = ''
    try {
      css = Array.from(document.styleSheets)
        .map((ss) => { try { return Array.from(ss.cssRules).map((r) => r.cssText).join('\n') } catch { return '' } })
        .join('\n')
    } catch {}
    // Packaged builds may refuse CSSOM access on file:// stylesheets — leave a
    // marker and the main process injects the built stylesheet from disk.
    if (!css || css.length < 500) css = '/*__APP_CSS__*/'
    const DOTS = 576, PAD = 10, DESIGN_W = 341
    const scale = (DOTS - 2 * PAD) / DESIGN_W
    const header = buildSlipHeader().outerHTML
    const footer = buildSlipFooter(panelEl.getAttribute('data-receipt') || '').outerHTML
    return '<!doctype html><html dir="ltr"><head><meta charset="utf-8"><style>' + css +
      '\nhtml,body{margin:0!important;padding:0!important;background:#fff!important}' +
      // ── Print typography (203dpi thermal): BIGGER regular/medium text, not
      // bold — small bold Nastaliq bleeds on a 1-bit head; size carries the
      // readability. Design px here land ×1.63 on the 576-dot canvas:
      // values 17px → ≈28 dots, Urdu labels 16px → ≈26 dots. The only bold
      // that remains is the final boxed بقایا رقم amount.
      '\n.print-area *{color:#000!important}' +
      '\n.print-area .receipt-panel,.print-area .receipt-panel *{border-color:#000!important;font-weight:500!important}' +
      '\n.print-area .receipt-panel .cell,.print-area .receipt-panel .lbl,.print-area .receipt-panel .inp,' +
      '.print-area .receipt-panel .inp-g,.print-area .receipt-panel .inp-y,.print-area .receipt-panel [class*="text-["]{font-size:17px!important;line-height:1.35!important}' +
      '\n.print-area .receipt-panel .urdu{font-size:16px!important;line-height:1.55!important}' +
      '\n.print-area .receipt-panel .panel-title{font-size:18px!important;font-weight:600!important;padding:3px 0!important}' +
      '\n.print-area .receipt-panel .laib-baqaya-row .num,.print-area .receipt-panel .laib-baqaya-row .bg-yellowCell *{font-weight:700!important}' +
      // ── Solid printable rules: 1px design lines raster to <2 dots and print
      // broken on thermal heads. Outer panel border ≈3 dots, inner separators
      // ≈2.4 dots. Dotted field underlines keep their style, just heavier.
      '\n.print-area .receipt-panel{border-width:2px!important}' +
      '\n.print-area .receipt-panel [class~="border-b"]{border-bottom-width:1.5px!important}' +
      '\n.print-area .receipt-panel [class~="border-t"]{border-top-width:1.5px!important}' +
      '\n.print-area .receipt-panel [class~="border-l"]{border-left-width:1.5px!important}' +
      '\n.print-area .receipt-panel [class~="border-r"]{border-right-width:1.5px!important}' +
      '\n.print-area .receipt-panel .panel-title{border-bottom-width:1.5px!important}' +
      // The red باقی تیزابی دینا ہے alert is SCREEN-only: this offscreen page
      // renders screen media, and #d32f2f would hard-threshold to a SOLID
      // BLACK BLOCK swallowing its (forced-black) text — strip it back to
      // plain black-on-clear like every other printed field.
      '\n.print-area .redbox-label,.print-area .redbox-value,.print-area .redbox-value *{background:transparent!important;color:#000!important;-webkit-text-fill-color:#000!important;opacity:1!important}' +
      // the offscreen page renders SCREEN media, so the @media print rule that
      // hides action bars (WhatsApp/print buttons, Saved tick) never fires —
      // hide them here explicitly
      '\n.no-print{display:none!important}' +
      '</style></head><body>' +
      // dir="ltr" wrapper for the same reason the print overlay uses it: the
      // clone must keep its on-screen anchoring/column order; the header,
      // footer and the receipts' internal RTL blocks set dir="rtl" themselves.
      // NO overflow:hidden here — transform:scale does not grow the wrapper's
      // LAYOUT box, so clipping to it would chop the slip at its unscaled
      // height (bottom rows lost). The ready script pins explicit heights to
      // the VISUAL (scaled) extent instead.
      '<div class="print-area" dir="ltr" style="width:' + DOTS + 'px;box-sizing:border-box;padding:6px ' + PAD + 'px 0;background:#fff">' +
      '<div data-measure style="width:' + DESIGN_W + 'px;transform:scale(' + scale + ');transform-origin:top left">' +
      header + clone.outerHTML + footer +
      '</div></div>' +
      // In-page passes after fonts load, before measuring:
      // 1) FIT PASS — FitValue spans were fitted at SCREEN sizes; at the larger
      //    print typography a long value (e.g. "4:27 PM 05-07-26") can overflow
      //    its box and get clipped. Re-run the same shrink-until-fits loop at
      //    print sizes so every digit always survives.
      // 2) HEIGHT — report the VISUAL (scaled) bottom so the canvas covers the
      //    whole slip.
      '<script>window.__ready=(async()=>{try{if(document.fonts&&document.fonts.ready){await document.fonts.ready}}catch(e){}' +
      'await new Promise(r=>setTimeout(r,80));' +
      'document.querySelectorAll(".receipt-panel span[dir=ltr]").forEach(function(s){' +
      'if(!/whitespace-nowrap/.test(s.className))return;' +
      'var sz=parseFloat(getComputedStyle(s).fontSize)||17,g=0;' +
      'while(s.scrollWidth>s.clientWidth&&sz>10&&g<40){sz-=0.5;s.style.setProperty("font-size",sz+"px","important");g++}' +
      '});' +
      'var el=document.querySelector("[data-measure]")||document.body;' +
      'var h=Math.ceil(el.getBoundingClientRect().bottom)+8;' +
      'var pa=document.querySelector(".print-area");if(pa){pa.style.height=h+"px"}' +
      'document.body.style.height=h+"px";return h})()</scr' + 'ipt>' +
      '</body></html>'
  } catch {
    return null
  }
}

// Flip to true to trace the parchi save/load path in the devtools console
// (Save button → saveParchi → replaceReceipt, and loadReceipt reconstruction).
const DEBUG_SAVE = false

export function AppProvider({ children }) {
  const [screen, setScreen] = useState('main') // 'main' | 'daybook' | 'udhar'
  const [rates, setRates] = useState(FALLBACK_RATES)
  const [receiptNo, setReceiptNo] = useState(1)
  // The receipt_no of the SAVED parchi currently open on screen (null while
  // composing a new, unsaved parchi). Drives First/Last/Next/Prev navigation.
  const [openReceiptNo, setOpenReceiptNo] = useState(null)
  const [udharOpen, setUdharOpen] = useState(false) // ادھار form/report modal
  const [akhrajatOpen, setAkhrajatOpen] = useState(false) // اخراجات (expenses) modal
  // Extended customer shape. mobile2/telephone/address/imagePath are new; their
  // persistence needs an upsertCustomer backend extension (see note), but the
  // form and live state work with them today.
  const [customer, setCustomer] = useState({
    id: null, name: '', mobile: '', mobile2: '', telephone: '', address: '', imagePath: null
  })
  const [totals, setTotals] = useState({ cash: 0, tezabi_sona: 0, parchun: 0 })
  const [bump, setBump] = useState(0)

  // Bottom-bar "کچا سونا" is DERIVED from the DB: getShopTotals returns kacha_sona =
  // Σ sona_wazan over kacha_gold_take transactions, loaded into `totals.kacha_sona`.
  // So it reflects the actually-saved kacha parchis (one row each via replaceReceipt)
  // — counted once per parchi, and it drops when a parchi's kacha entry is removed.

  // Bottom-bar "کیش" is DISPLAY-ONLY reduced by TODAY'S expenses: shown cash =
  // totals.cash − (sum of today's کھرچہ). Expenses live in their own table and
  // never touch cash transactions / ledger, so this is purely a display subtraction.
  // Date-scoped to the app's current date (rates.date), like the کچا سونا counter.
  const [expensesToday, setExpensesToday] = useState(0)

  // Purity table inputs + per-cell manual overrides.
  const [input, setInput] = useState({ wazan: '', malawat: '' })
  const [overrides, setOverrides] = useState({}) // { rowKey: { field: value } }

  // وصولی رسید sidebar toggles + the gold the customer hands over (سونا دیا, grams).
  const [ujratKaSona, setUjratKaSona] = useState(true) // اجرت کا سونا (default on)
  const [parchunLiya, setParchunLiya] = useState(false) // پرچوں لیا
  const [sonaDiya, setSonaDiya] = useState('') // سونا دیا (grams, editable)
  const [cashDiya, setCashDiya] = useState('') // کیش دیا (cash, two-way with سونا دیا)

  // نقد (cash) sell/buy entries — lifted here so the نقد کی رسید (a sibling of
  // the نقد panel) can read them and update live.
  const [cashSell, setCashSell] = useState({ wazan: '', point: '100', rate: '' })
  const [cashBuy, setCashBuy] = useState({ wazan: '', point: '100', rate: '' })

  // ادھار (credit) entries — gold give/take + cash give/take, lifted so the
  // ادھار کی رسید can read them and update live (gold & cash both allowed).
  const [udharGive, setUdharGive] = useState({ wazan: '', point: '100', rate: '' })
  const [udharTake, setUdharTake] = useState({ wazan: '', point: '100', rate: '' })
  const [udharCashGive, setUdharCashGive] = useState('')
  const [udharCashTake, setUdharCashTake] = useState('')
  // Free-text note saved with the parchi — typically the NAME of whoever came to
  // collect on the account holder's behalf. Shown only in the ادھار receipt
  // (next to پوائنٹ). Persisted in the receipt payload (no DB column).
  const [udharComment, setUdharComment] = useState('')

  // "Saved" confirmation ticks under each of the four receipts. Auto-set true
  // after a successful DB save of that section; cleared on New / reset.
  const [savedFlags, setSavedFlags] = useState(NO_SAVED)

  const refresh = useCallback(() => setBump((b) => b + 1), [])

  // Modal tabs (ادھار / اخراجات) open over the main workflow. Only one at a time.
  const openUdhar = useCallback(() => { setScreen('main'); setAkhrajatOpen(false); setUdharOpen(true) }, [])
  const closeUdhar = useCallback(() => setUdharOpen(false), [])
  const openAkhrajat = useCallback(() => { setScreen('main'); setUdharOpen(false); setAkhrajatOpen(true) }, [])
  const closeAkhrajat = useCallback(() => setAkhrajatOpen(false), [])

  // Initial load
  useEffect(() => {
    if (!hasApi) return
    ;(async () => {
      const r = await window.api.getRates()
      // Always start on TODAY'S date (override any old stored default like
      // 2026-05-15); the user can still change it during the session.
      if (r) setRates({ ...r, date: todayISO() })
      const n = await window.api.nextReceiptNo()
      if (n) setReceiptNo(n)
    })()
  }, [])

  // Totals refresh on every write
  useEffect(() => {
    if (!hasApi) return
    window.api.getShopTotals().then(setTotals)
  }, [bump])

  // Parchi nav boundary flags — whether an older/newer SAVED parchi exists relative
  // to the one open. Recomputes when the open parchi changes or the saved set
  // changes (bump). Drives DISABLING the ◀ (Prev) / ▶ (Next) nav buttons at edges.
  const [receiptBounds, setReceiptBounds] = useState({ hasPrev: false, hasNext: false })
  useEffect(() => {
    let alive = true
    ;(async () => {
      if (!hasApi) { setReceiptBounds({ hasPrev: false, hasNext: false }); return }
      const first = await window.api.getFirstReceiptNo()
      const last = await window.api.getLastReceiptNo()
      const hasAny = first != null
      let hasPrev, hasNext
      if (openReceiptNo == null) {
        // Composing a NEW unsaved parchi = newest position, at the end.
        hasPrev = hasAny // can step back into the saved history
        hasNext = false // nothing newer ahead
      } else {
        hasPrev = openReceiptNo > first // an older saved parchi exists
        hasNext = openReceiptNo < last // a newer saved parchi exists
      }
      if (alive) setReceiptBounds({ hasPrev, hasNext })
    })()
    return () => { alive = false }
  }, [openReceiptNo, bump])

  // Today's expenses total (read-only) — recomputed on every write (bump, e.g.
  // after adding an expense) and on a date change. Reduces ONLY the cash DISPLAY.
  useEffect(() => {
    if (!hasApi) return
    window.api.getExpensesTotalForDate(rates.date).then((s) => setExpensesToday(Number(s) || 0))
  }, [rates.date, bump])

  // Bottom-bar cash DISPLAY = live cash figure − today's expenses (display-only;
  // the DB cash balance/ledger is never reduced by expenses).
  const cashDisplay = (Number(totals.cash) || 0) - expensesToday

  // PART 1: the sidebar "پرچوں لیا" checkbox DRIVES "اجرت کا سونا" — ticking پرچوں لیا
  // ticks اجرت کا سونا, unticking unticks it. اجرت کا سونا being on is what the
  // EXISTING calc uses to subtract ujrat from khalis (goldOwed = khalisSona −
  // ujratGold), so this auto-tick reuses that logic — no new subtraction.
  // Also gate سونا دیا / کیش دیا: when پرچوں لیا is off, both are cleared/locked.
  // We skip the FIRST run so the app's اجرت کا سونا default (on) is preserved; the
  // coupling then applies on every real toggle of پرچوں لیا.
  const parchunFirstRun = useRef(true)
  useEffect(() => {
    if (parchunFirstRun.current) { parchunFirstRun.current = false; return }
    setUjratKaSona(parchunLiya)
    if (!parchunLiya) { setSonaDiya(''); setCashDiya('') }
  }, [parchunLiya])

  const computedRows = useMemo(
    () => computeTable(input, rates, overrides),
    [input, rates, overrides]
  )

  // PART 2 — سونا دیا ↔ کیش دیا two-way binding as a SPLIT of the gold owed:
  //   (سونا دیا) + (کیش دیا ÷ ratePerGram) = goldOwed  (سونا دینا ہے)
  // The two boxes are COMPLEMENTS, not the same amount in two units — giving all
  // the owed gold leaves کیش دیا at 0, and vice versa. goldOwed is computed exactly
  // like LeftSidebar.jsx: selected row = پرچی-ticked else Standard; اجرت کا سونا on
  // subtracts the labour's gold value (ujratGold) from the row's khalis.
  const sidebarGoldCtx = useCallback(() => {
    const sel = computedRows.find((r) => r.parchi) || computedRows[2]
    if (!sel) return { rpg: 0, goldOwed: 0 }
    const rpg = (Number(sel.rate) || 0) / GRAMS_PER_TOLA
    const ujratGold = rpg > 0 ? (Number(sel.labCharges) || 0) / rpg : 0
    const goldOwed = ujratKaSona ? (Number(sel.khalisSona) || 0) - ujratGold
                                 : (Number(sel.khalisSona) || 0)
    return { rpg, goldOwed }
  }, [computedRows, ujratKaSona])

  // These are called ONLY from the user's onChange on each input. They set the
  // SIBLING field's state directly (not via its onChange), so a programmatic
  // update never re-fires the other handler → no feedback loop.
  // سونا دیا typed → کیش دیا = cash value of the gold STILL owed after this gold.
  const setSonaDiyaLinked = useCallback((v) => {
    setSonaDiya(v)
    const { rpg, goldOwed } = sidebarGoldCtx()
    const n = Number(v)
    if (String(v).trim() === '' || !Number.isFinite(n) || rpg <= 0) { setCashDiya(''); return }
    const leftoverGold = Math.max(0, goldOwed - n)
    const cash = round(leftoverGold * rpg, 0)
    setCashDiya(cash > 0 ? String(cash) : '') // all in gold → cash blank/0
  }, [sidebarGoldCtx])

  // کیش دیا typed → سونا دیا = the gold STILL owed after the cash's gold-equivalent.
  const setCashDiyaLinked = useCallback((v) => {
    setCashDiya(v)
    const { rpg, goldOwed } = sidebarGoldCtx()
    const n = Number(v)
    if (String(v).trim() === '' || !Number.isFinite(n) || rpg <= 0) { setSonaDiya(''); return }
    const remainingGold = Math.max(0, goldOwed - (n / rpg))
    setSonaDiya(remainingGold > 0 ? String(round(remainingGold, 3)) : '')
  }, [sidebarGoldCtx])

  // Auto-default: once a weight is entered and NO row is parchi-selected, tick
  // the Standard row. This is only a default — the moment any row is selected
  // (incl. the operator picking another row) this no-ops, so manual choices via
  // toggleParchi always win and never get snapped back.
  useEffect(() => {
    if (!input.wazan) return
    if (Object.values(overrides).some((o) => o?.parchi)) return
    setOverrides((o) => {
      const next = {}
      for (const key of Object.keys(o)) {
        next[key] = { ...o[key], parchi: false }
      }
      next.Standard = { ...(o.Standard || {}), parchi: true }
      return next
    })
  }, [input.wazan, overrides])

  // ---- actions ----
  const saveRates = useCallback(async (patch) => {
    const next = { ...rates, ...patch }
    setRates(next)
    if (hasApi) await window.api.saveRates(next)
  }, [rates])

  // Print the current view once per configured slip copy (سلپ پرنٹ). 1 → one
  // print, 2 → two, etc. Each call opens the print dialog for that copy.
  const printSlips = useCallback(async (panelEl) => {
    const n = Math.max(1, parseInt(rates.slip_count, 10) || 1)
    // ── PRIMARY: direct 1-bit thermal raster (ESC/POS, RAW spool). The slip is
    // rendered ONCE at exactly 576 dots = the full 72.1mm printable band, hard-
    // thresholded to pure black/white and written straight to the printer — no
    // driver scaling, no left/right drift, no anti-alias blur. If the printer
    // isn't reachable this way (non-ESC/POS device, no default printer), fall
    // through to the driver-based path below unchanged.
    if (panelEl && hasApi && window.api.rasterPrintSlip) {
      const rasterHtml = buildRasterSlipHtml(panelEl)
      if (rasterHtml) {
        try {
          const res = await window.api.rasterPrintSlip({ html: rasterHtml, copies: n })
          if (res && res.ok) return
          console.warn('raster print unavailable, using driver path:', res && res.reason)
        } catch (e) {
          console.warn('raster print failed, using driver path:', e)
        }
      }
    }
    // ── FALLBACK: Windows-driver print (silent → dialog), safe-window geometry.
    // The global @media print CSS shows ONLY `.print-area` content — and the main
    // screen has none, so receipt prints came out BLANK. Fix: clone the clicked
    // receipt panel into a temporary body-level .print-area (the same overlay
    // structure the report prints use). The clone lives OUTSIDE the FitScreen
    // scale transform, so it prints at natural size; `slip-print` on <body> hides
    // #root entirely in print so the clone starts on page 1. Cleaned up after.
    let overlay = null
    let pageStyle = null
    if (panelEl && typeof document !== 'undefined') {
      overlay = document.createElement('div')
      overlay.className = 'print-overlay'
      // <html dir="rtl">: on screen the receipt panels sit inside a dir="ltr"
      // wrapper (LeftReceipts/RightReceipts), but this overlay hangs off <body>,
      // so without its own LTR the clone inherits RTL — the لیب grid mirrors its
      // columns AND the 341px inner block right-aligns in the 74mm area, hanging
      // ~61px off the LEFT edge (transform-origin:left keeps that overhang), which
      // clipped the label column and the leading digits of رتی/کیرٹ on the printed
      // slip. dir="ltr" here restores the exact on-screen anchoring/column order;
      // the header/footer and the receipts' internal RTL blocks set dir="rtl"
      // explicitly themselves, so they are unaffected.
      overlay.dir = 'ltr'
      // invisible + out of flow on screen; print CSS re-shows the .print-area
      overlay.style.cssText = 'visibility:hidden;position:fixed;left:0;top:0;pointer-events:none'
      const root = document.createElement('div')
      root.className = 'print-root'
      const area = document.createElement('div')
      area.className = 'print-area'
      // Print the receipt EXACTLY as designed: render the clone at the panel's
      // fixed DESIGN width and transform-scale it down to the roll, the same
      // render-at-design-size-then-scale trick the statement view uses.
      // Squeezing the clone directly to the roll width broke the internal
      // fixed-px grids (لیب رسید columns) — scaling preserves them.
      //
      // Printable-safety geometry: an "80mm" thermal printer physically prints
      // only a ~72mm band (576 dots @ 203dpi) and every driver anchors that
      // band differently — one shop printer swallowed the LEFT ~3mm (leading
      // digits of گرام/فی تولہ lost), another clipped everything past ~72mm on
      // the RIGHT (Urdu labels lost). The old 74mm-wide slip at 2mm could not
      // survive either. Keep the WHOLE slip inside the 6mm..70mm window of the
      // page so both failure modes hit blank margin, never text.
      const PAPER_MM = 80 // physical roll width (@page size)
      const CONTENT_MM = 64 // slip width — inside every common printable band
      const LEFT_MM = 6 // slip's left edge, measured from the paper edge
      const DESIGN_W = 341 // the receipt panels' on-screen design width (px)
      const targetPx = (CONTENT_MM * 96) / 25.4 // 64mm in CSS px ≈ 242
      const scale = targetPx / DESIGN_W
      const designH = panelEl.offsetHeight || 456 // layout (unscaled) height
      area.style.cssText = `width:${CONTENT_MM}mm;margin-left:${LEFT_MM}mm;overflow:hidden`
      const inner = document.createElement('div')
      inner.style.cssText = `width:${DESIGN_W}px;transform:scale(${scale});transform-origin:top left`
      const clone = panelEl.cloneNode(true)
      // Fix the clone at its on-screen height so the flex rows keep the same
      // even spacing they have on screen (h-full has no parent height here).
      clone.style.height = `${designH}px`
      // cloneNode copies attributes, NOT live input/checkbox state — sync every
      // field into the clone so no value can go missing from the printout.
      const srcFields = panelEl.querySelectorAll('input, textarea, select')
      const dstFields = clone.querySelectorAll('input, textarea, select')
      dstFields.forEach((f, i) => {
        const s = srcFields[i]
        if (!s) return
        f.value = s.value
        if (f.type === 'checkbox' || f.type === 'radio') f.checked = s.checked
      })
      // Slip = [SHOP HEADER] → [receipt body, exactly as on screen] → [FOOTER].
      // The fee paragraph is lab-only; data-receipt on the panel root says which
      // receipt this is (lab / naqad / udhar / wasooli).
      inner.appendChild(buildSlipHeader())
      inner.appendChild(clone)
      inner.appendChild(buildSlipFooter(panelEl.getAttribute('data-receipt') || ''))
      area.appendChild(inner)
      root.appendChild(area)
      overlay.appendChild(root)
      document.body.appendChild(overlay)
      document.body.classList.add('slip-print')
      // The scaled inner keeps its unscaled layout height — clamp the printable
      // area to the VISUAL (scaled) height so no blank feed follows the slip.
      area.style.height = `${Math.ceil((inner.offsetHeight || designH) * scale)}px`
      // 80mm continuous-roll page (same technique as the thermal reports): the
      // last @page rule wins over the global `@page { margin: 10mm }`. Side
      // margins are 0 so LEFT_MM above is measured from the TRUE paper edge —
      // the safe-window math must not shift with the page margin.
      pageStyle = document.createElement('style')
      pageStyle.id = 'slip-page-style'
      pageStyle.textContent = `@page { size: ${PAPER_MM}mm auto; margin: 2mm 0; }`
      document.head.appendChild(pageStyle)
    }
    try {
      // SILENT print straight to the default (thermal) printer — the system
      // print dialog often fails to spool on Windows thermal drivers, which is
      // why dialog printing produced nothing. Failures now surface as a toast.
      for (let i = 0; i < n; i++) {
        if (hasApi && window.api.printPage) {
          const res = await window.api.printPage({ silent: true })
          if (res && res.ok === false) {
            showPrintError(res.reason)
            break // don't fire remaining copies into a failing printer
          }
        } else {
          window.print() // plain-browser dev fallback
        }
      }
    } finally {
      if (overlay) { overlay.remove(); document.body.classList.remove('slip-print') }
      if (pageStyle) pageStyle.remove()
    }
  }, [rates.slip_count])

  // WhatsApp share: build the SAME slip the printer gets (shop header → the
  // clicked receipt exactly as on screen → footer), show it briefly as a
  // centered card, snapshot that card to the system CLIPBOARD as an image via
  // the main process, then open the WhatsApp chat — the operator just presses
  // Ctrl+V and Send. Every step is guarded; on ANY failure it falls back to the
  // old text-only WhatsApp link, so the button can never break or crash.
  const shareSlipWhatsApp = useCallback(async (panelEl, mobile, text) => {
    // Main process picks the best route: WhatsApp DESKTOP app when installed
    // (auto-paste watcher), else the embedded web window (in-window auto-paste).
    // Plain wa.me window.open remains the last-resort fallback (browser dev).
    const openWa = async () => {
      if (hasApi && window.api.openWhatsApp) {
        try {
          const r = await window.api.openWhatsApp({ mobile, text: text || '' })
          if (r && r.ok) return
        } catch {}
      }
      const num = String(mobile || '').replace(/[^0-9]/g, '')
      const url = `https://wa.me/${num}?text=${encodeURIComponent(text || '')}`
      if (typeof window !== 'undefined') window.open(url, '_blank')
    }
    if (!panelEl || typeof document === 'undefined' || !hasApi || !window.api.captureToClipboard) {
      openWa()
      return
    }
    let overlay = null
    try {
      const DESIGN_W = 341 // same design width the thermal print path uses
      const designH = panelEl.offsetHeight || 456
      overlay = document.createElement('div')
      overlay.dir = 'ltr' // html is rtl; keep the slip's internal grids unmirrored
      overlay.className = 'no-print'
      overlay.style.cssText =
        'position:fixed;inset:0;z-index:9997;background:rgba(0,0,0,.45);' +
        'display:flex;align-items:flex-start;justify-content:center;padding-top:12px'
      const card = document.createElement('div')
      card.style.cssText = 'background:#fff;overflow:hidden;box-shadow:0 8px 30px rgba(0,0,0,.4)'
      const inner = document.createElement('div')
      inner.style.cssText = `width:${DESIGN_W}px;transform-origin:top left;background:#fff;padding:4px`
      const clone = panelEl.cloneNode(true)
      clone.style.height = `${designH}px`
      // cloneNode copies attributes, NOT live input state — sync every field.
      const srcFields = panelEl.querySelectorAll('input, textarea, select')
      const dstFields = clone.querySelectorAll('input, textarea, select')
      dstFields.forEach((f, i) => {
        const s = srcFields[i]
        if (!s) return
        f.value = s.value
        if (f.type === 'checkbox' || f.type === 'radio') f.checked = s.checked
      })
      // The print path hides .no-print (action bar / Saved / buttons) via CSS at
      // print time; this is a SCREEN capture, so drop them from the clone — the
      // shared picture matches the printed slip exactly. (Field sync above runs
      // first, on the identical index order of panel vs clone.)
      clone.querySelectorAll('.no-print').forEach((n) => { try { n.remove() } catch {} })
      inner.appendChild(buildSlipHeader())
      inner.appendChild(clone)
      inner.appendChild(buildSlipFooter(panelEl.getAttribute('data-receipt') || ''))
      card.appendChild(inner)
      overlay.appendChild(card)
      document.body.appendChild(overlay)
      // Two-phase: measure at natural size, then scale UP as far as the window
      // allows (max 2x) so the WhatsApp image is crisp but never clipped.
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      const naturalH = inner.offsetHeight || designH
      const scale = Math.max(0.5, Math.min(2,
        (window.innerHeight - 34) / naturalH,
        (window.innerWidth - 34) / DESIGN_W))
      inner.style.transform = `scale(${scale})`
      card.style.width = `${Math.floor(DESIGN_W * scale)}px`
      card.style.height = `${Math.floor(naturalH * scale)}px`
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      await new Promise((r) => setTimeout(r, 80)) // let paint settle before capture
      const b = card.getBoundingClientRect()
      const res = await window.api.captureToClipboard({ x: b.x, y: b.y, width: b.width, height: b.height })
      overlay.remove()
      overlay = null
      if (res && res.ok) {
        showToast('رسید کی تصویر تیار ہے — چیٹ کھلتے ہی خود لگ جائے گی، صرف Send دبائیں (نہ لگے تو Ctrl+V)', true)
      } else {
        showToast('تصویر کاپی نہیں ہو سکی — صرف تحریری پیغام بھیجا جائے گا', false)
      }
    } catch (e) {
      console.error('WhatsApp slip share failed:', e)
      if (overlay) { try { overlay.remove() } catch {} }
    }
    openWa()
  }, [])

  // Change a top weight (gross / water). Changing a weight reruns the forward
  // calc fresh for all 5 rows, so any per-row manual edits (e.g. Baqi Raqam
  // reverse-calc) are dropped.
  const setWeight = useCallback((field, value) => {
    setInput((s) => ({ ...s, [field]: value }))
    setOverrides({})
    // Entering وزن کانٹے پر starts the وصولی رسید UNticked: both پرچوں لیا and
    // اجرت کا سونا clear, so the operator opts in deliberately (later ticking
    // پرچوں لیا re-ticks اجرت کا سونا via the coupling effect below).
    if (field === 'wazan') { setParchunLiya(false); setUjratKaSona(false) }
  }, [])

  const setCell = useCallback((rowKey, field, value) => {
    setOverrides((o) => ({
      ...o,
      [rowKey]: { ...(o[rowKey] || {}), [field]: value }
    }))
  }, [])

  const clearCell = useCallback((rowKey, field) => {
    setOverrides((o) => {
      const row = { ...(o[rowKey] || {}) }
      delete row[field]
      return { ...o, [rowKey]: row }
    })
  }, [])

  const toggleParchi = useCallback((rowKey) => {
    setOverrides((o) => {
      const wasOn = !!(o[rowKey] && o[rowKey].parchi)
      const next = {}

      for (const key of Object.keys(o)) {
        next[key] = { ...o[key], parchi: false }
      }

      next[rowKey] = { ...(o[rowKey] || {}), parchi: !wasOn }
      return next
    })
  }, [])

  const toggleUjratKaSona = useCallback(() => setUjratKaSona((v) => !v), [])
  const toggleParchunLiya = useCallback(() => setParchunLiya((v) => !v), [])

  const resetEntry = useCallback(() => {
    setInput({ wazan: '', malawat: '' })
    setOverrides({})
  }, [])

  const newCustomer = useCallback(() => {
    setCustomer({ id: null, name: '', mobile: '', mobile2: '', telephone: '', address: '', imagePath: null })
  }, [])

  // Save the given customer (e.g. the modal form's working copy) or, with no
  // argument, the current global customer (the inline Save button). The DB
  // assigns the id on insert and returns the full row, which we set back so the
  // form shows the real id.
  const saveCustomer = useCallback(async (override) => {
    const toSave = override || customer
    if (!hasApi) {
      setCustomer(toSave)
      return toSave
    }
    const saved = await window.api.upsertCustomer(toSave)
    setCustomer(saved)
    refresh()
    return saved
  }, [customer, refresh])

  // Load a saved receipt (as returned by window.api.getReceiptByNo) back into the
  // live entry: customer, top weights, receipt number, and any cell overrides.
  // Tolerant of shape — the row may carry the fields at the top level or nested
  // under a `payload` (string or object), since saveReceipt stores payload JSON.
  const loadReceipt = useCallback((data) => {
    if (!data) return
    let payload = data.payload ?? data
    if (typeof payload === 'string') {
      try { payload = JSON.parse(payload) } catch { payload = {} }
    }
    const rcptNo = data.receipt_no ?? payload.receipt_no ?? payload.receiptNo
    if (DEBUG_SAVE) console.log('[loadReceipt] receipt_no', rcptNo, 'rows', data.rows)
    if (rcptNo != null) { setReceiptNo(rcptNo); setOpenReceiptNo(rcptNo) }

    const cust = payload.customer ?? data.customer
    if (cust) {
      setCustomer({
        id: cust.id ?? data.customer_id ?? null,
        name: cust.name ?? '',
        mobile: cust.mobile ?? ''
      })
    }

    // Restore the rate context the parchi was saved under, so the purity rows
    // recompute to EXACTLY the values that were saved (khalis/qeemat depend on it).
    if (payload.rates) setRates((r) => ({ ...r, ...payload.rates }))

    // Purity-table line-items (Local/Copper/Standard/Silver/Pure Silver) are fully
    // determined by the top weights + per-row overrides + rates. Restore them.
    const inp = payload.input ?? data.input
    setInput({ wazan: inp?.wazan ?? '', malawat: inp?.malawat ?? '' })
    setOverrides(payload.overrides ?? data.overrides ?? {})

    // نقد / ادھار entries — reconstruct from the TRANSACTION ROWS: the SAME rows
    // Save writes and reports read. This single source of truth guarantees a
    // reopened parchi reflects exactly what was last saved (removed entries gone,
    // changed values updated) and never a divergent JSON snapshot. The payload's
    // `entries` is used only as a fallback for parchis with no rows.
    const blankGold = () => ({ wazan: '', point: '100', rate: '' })
    const rows = Array.isArray(data.rows) ? data.rows : []
    if (rows.length) {
      let cs = blankGold(), cb = blankGold(), ug = blankGold(), ut = blankGold(), cg = '', ct = ''
      const asGold = (r) => ({
        wazan: r.sona_wazan != null ? String(r.sona_wazan) : '',
        point: r.point != null ? String(r.point) : '100',
        rate: r.rate ? String(r.rate) : ''
      })
      for (const r of rows) {
        if (r.category === 'gold_sell') cs = asGold(r)
        else if (r.category === 'gold_buy') cb = asGold(r)
        else if (r.category === 'gold_give') ug = asGold(r)
        else if (r.category === 'gold_take') ut = asGold(r)
        else if (r.category === 'cash_give') cg = r.cash_amount != null ? String(r.cash_amount) : ''
        else if (r.category === 'cash_take') ct = r.cash_amount != null ? String(r.cash_amount) : ''
      }
      setCashSell(cs); setCashBuy(cb); setUdharGive(ug); setUdharTake(ut)
      setUdharCashGive(cg); setUdharCashTake(ct)
    } else if (payload.entries) {
      const e = payload.entries
      setCashSell(e.cashSell ?? blankGold())
      setCashBuy(e.cashBuy ?? blankGold())
      setUdharGive(e.udharGive ?? blankGold())
      setUdharTake(e.udharTake ?? blankGold())
      setUdharCashGive(e.udharCashGive ?? '')
      setUdharCashTake(e.udharCashTake ?? '')
    } else {
      setCashSell(blankGold()); setCashBuy(blankGold())
      setUdharGive(blankGold()); setUdharTake(blankGold())
      setUdharCashGive(''); setUdharCashTake('')
    }

    // Sidebar toggles (وصولی رسید) — restore for full fidelity when snapshotted.
    const sb = payload.sidebar
    if (sb) {
      if (sb.ujratKaSona != null) setUjratKaSona(sb.ujratKaSona)
      if (sb.parchunLiya != null) setParchunLiya(sb.parchunLiya)
      if (sb.sonaDiya != null) setSonaDiya(sb.sonaDiya)
      setCashDiya(sb.cashDiya != null ? sb.cashDiya : '')
    }

    // ادھار comment (collector's name / note) — restore from the saved payload.
    setUdharComment(payload.comment ?? '')
  }, [])

  // Fetch a saved parchi by receipt_no and load it via the shared loadReceipt
  // flow, so the FULL parchi (header + purity line-items + نقد/ادھار entries) is
  // restored. Returns { ok, receipt_no? , message? }.
  const loadReceiptNo = useCallback(async (n) => {
    if (n == null) return { ok: false }
    if (!hasApi) return { ok: false }
    const data = await window.api.getReceiptByNo(n)
    if (!data) return { ok: false, message: 'یہ رسید نمبر موجود نہیں' }
    loadReceipt(data)
    return { ok: true, receipt_no: n }
  }, [loadReceipt])

  // ── Parchi navigation ───────────────────────────────────────────────────────
  // Each resolves a target receipt_no on the backend (gap-tolerant), then loads
  // it. No saved receipts → gentle Urdu note. At an edge (Next past last / Prev
  // before first) → no-op note, no wrap-around. Next/Prev with nothing open load
  // First/Last respectively.
  const NONE = { ok: false, message: 'کوئی رسید محفوظ نہیں' }
  const gotoFirstReceipt = useCallback(async () => {
    if (!hasApi) return { ok: false }
    const n = await window.api.getFirstReceiptNo()
    if (n == null) return NONE
    return loadReceiptNo(n)
  }, [loadReceiptNo])

  const gotoLastReceipt = useCallback(async () => {
    if (!hasApi) return { ok: false }
    const n = await window.api.getLastReceiptNo()
    if (n == null) return NONE
    return loadReceiptNo(n)
  }, [loadReceiptNo])

  const gotoNextReceipt = useCallback(async () => {
    if (!hasApi) return { ok: false }
    const n = openReceiptNo == null
      ? await window.api.getFirstReceiptNo()
      : await window.api.getNextReceiptNo(openReceiptNo)
    if (n == null) return { ok: false, message: openReceiptNo == null ? 'کوئی رسید محفوظ نہیں' : 'آخری رسید' }
    return loadReceiptNo(n)
  }, [openReceiptNo, loadReceiptNo])

  const gotoPrevReceipt = useCallback(async () => {
    if (!hasApi) return { ok: false }
    const n = openReceiptNo == null
      ? await window.api.getLastReceiptNo()
      : await window.api.getPrevReceiptNo(openReceiptNo)
    if (n == null) return { ok: false, message: openReceiptNo == null ? 'کوئی رسید محفوظ نہیں' : 'پہلی رسید' }
    return loadReceiptNo(n)
  }, [openReceiptNo, loadReceiptNo])

  const addTransaction = useCallback(async (t) => {
    const txn = {
      receipt_no: receiptNo,
      customer_id: customer.id,
      date: rates.date,
      ...t
    }
    if (hasApi) await window.api.addTransaction(txn)
    refresh()
    return txn
  }, [receiptNo, customer.id, rates.date, refresh])

  // A customer is mandatory for any cash/udhar (ledger) save. Returns the customer
  // with a REAL id, or null when none is selected. IMPORTANT: a typed name is NOT
  // auto-created any more — a receipt may only carry an ALREADY-SAVED customer. If
  // the operator typed a name without picking from the list, we try to resolve it
  // to an EXACT saved-customer match (findCustomers does a contains-search, so we
  // keep only exact, case-insensitive name matches). Exactly one match → adopt it;
  // unknown name or an ambiguous duplicate → null, so the caller blocks the save.
  // New customers must be added deliberately (the "+" customer form, or Save with
  // just a name and no entries).
  const ensureCustomer = useCallback(async () => {
    if (customer.id) return customer
    const name = (customer.name || '').trim()
    if (!name || !hasApi) return null
    const hits = (await window.api.findCustomers(name)) || []
    const exact = hits.filter((c) => (c.name || '').trim().toLowerCase() === name.toLowerCase())
    if (exact.length === 1) { setCustomer(exact[0]); return exact[0] }
    return null
  }, [customer])

  // Stage 2 — Save the current نقد + ادھار entries as transactions under the
  // current receipt_no, then auto-tick the matching "Saved" boxes and advance to
  // the next parchi number. Returns { ok, message?, receipt_no? }.
  const saveParchi = useCallback(async () => {
    const rateTola = Number(rates.rate_tezabi_tola) || 0
    const sell = goldFigures(cashSell, rateTola)
    const buy = goldFigures(cashBuy, rateTola)
    const give = goldFigures(udharGive, rateTola)
    const take = goldFigures(udharTake, rateTola)
    const cGive = Number(udharCashGive) || 0
    const cTake = Number(udharCashTake) || 0

    const txns = []
    // نقد (cash trade): sell = shop gives gold / gets cash (out), buy = gets gold / pays cash (in)
    if (sell) txns.push({ section: 'naqad', kind: 'cash', direction: 'out', category: 'gold_sell', sona_wazan: sell.wazan, point: sell.point, khalis_sona: sell.khalis, rate: sell.rate, qeemat: sell.qeemat, note: 'نقد فروخت' })
    if (buy) txns.push({ section: 'naqad', kind: 'cash', direction: 'in', category: 'gold_buy', sona_wazan: buy.wazan, point: buy.point, khalis_sona: buy.khalis, rate: buy.rate, qeemat: buy.qeemat, note: 'نقد خرید' })
    // ادھار (credit): give gold = out, take gold = in; cash give = out, cash take = in
    if (give) txns.push({ section: 'udhar', kind: 'udhar', direction: 'out', category: 'gold_give', sona_wazan: give.wazan, point: give.point, khalis_sona: give.khalis, rate: give.rate, qeemat: give.qeemat, note: 'تیزابی دیا' })
    if (take) txns.push({ section: 'udhar', kind: 'udhar', direction: 'in', category: 'gold_take', sona_wazan: take.wazan, point: take.point, khalis_sona: take.khalis, rate: take.rate, qeemat: take.qeemat, note: 'تیزابی لیا' })
    if (cGive) txns.push({ section: 'udhar', kind: 'udhar', direction: 'out', category: 'cash_give', cash_amount: cGive, note: 'ادھار کیش دیا' })
    if (cTake) txns.push({ section: 'udhar', kind: 'udhar', direction: 'in', category: 'cash_take', cash_amount: cTake, note: 'ادھار کیش لیا' })

    // کچا سونا لیا: on Save, record the top scale-weight (وزن کانٹے پر) as a raw-
    // gold-received transaction. sona_wazan = the raw scale weight (this ALONE
    // feeds the bottom-bar کچا سونا total). khalis_sona = the خالص سونا of the
    // TICKED purity row (پرچی checkbox), so the report can show that row's khalis.
    // getShopTotals skips this category, so the stored khalis never pollutes the
    // تیزابی/کیش/سونا totals — کچا سونا still accumulates ONLY وزن کانٹے پر.
    const kachaWazan = Number(input.wazan) || 0
    // کچا سونا is recorded ONLY when پرچوں لیا is ticked. If it's off, NO
    // kacha_gold_take row is written — so nothing is added to the bottom-bar
    // کچا سونا total even when the parchi is saved.
    if (parchunLiya && kachaWazan > 0) {
      const tickedRow = computedRows.find((r) => r.parchi)
      const tickedKhalis = tickedRow ? (Number(tickedRow.khalisSona) || 0) : 0
      // The sidebar "پرچوں لیا" checkbox GATES the سونا دیا / کیش دیا values (data,
      // not display): ticked → the two-way-bound values (سونا دیا grams, کیش دیا
      // cash — each derived from the other via the rate) are saved/counted;
      // unticked → they are zeroed for this record (report shows 0/blank).
      // کچا سونا (weight) and خالص سونا are always recorded.
      const sonaDiyaVal = parchunLiya ? (Number(sonaDiya) || 0) : 0
      const cashDiyaVal = parchunLiya ? (Number(cashDiya) || 0) : 0
      txns.push({
        section: 'kacha', kind: 'udhar', direction: 'in', category: 'kacha_gold_take',
        sona_wazan: kachaWazan, point: 0, khalis_sona: tickedKhalis,
        sona_diya: sonaDiyaVal,
        cash_diya: cashDiyaVal,
        note: 'کچا سونا لیا (کانٹے پر)'
      })
    }

    // Editing an already-open parchi (its number is currently loaded) vs a brand-
    // new one. Compute EARLY, because it changes the empty-guard below: an edit
    // that zeroed/removed all its entries is STILL a valid save (it must overwrite
    // the receipt so the emptied state persists), whereas a brand-new blank parchi
    // has nothing to save yet.
    const rno = receiptNo
    const isEdit = openReceiptNo != null && Number(openReceiptNo) === Number(rno)

    // A parchi is worth saving if it has any نقد/ادھار entry OR any REAL purity-
    // table data (top weights, or an override carrying an actual field value). A
    // bare پرچی row-tick ({ parchi: true }) is NOT data — the lab flow auto-ticks
    // Standard, so counting it would make a لیب parchi impossible to empty/free
    // (Part 2). This makes the empty-check identical for lab / نقد / ادھار.
    const hasRealOverrides = Object.values(overrides || {}).some((row) =>
      Object.entries(row || {}).some(([k, v]) => k !== 'parchi' && String(v ?? '').trim() !== '')
    )
    const hasPurity =
      String(input.wazan ?? '').trim() !== '' ||
      String(input.malawat ?? '').trim() !== '' ||
      hasRealOverrides
    if (!isEdit && !txns.length && !hasPurity) return { ok: false, message: 'کوئی اندراج نہیں — پہلے مقدار درج کریں' }

    // Two-step "parchi free" — ORDER ENFORCED. On an already-open receipt, the NAME
    // may only be removed AFTER the entries were emptied first (Step 1). So when the
    // name is empty on an edit:
    //   • entries also empty  → STEP 2: FREE the number (delete #rno entirely, leave
    //     it on screen with openReceiptNo=null so it can be reused by a new customer).
    //   • entries STILL exist → WRONG ORDER: block with an Urdu error and change
    //     nothing (don't free, don't overwrite — the saved data stays intact).
    // STEP 1 (name still present) never enters here; it saves an empty-but-named
    // parchi below.
    const nameEmpty = !customer.id && !(customer.name && customer.name.trim())
    const entriesEmpty = !txns.length && !hasPurity
    if (isEdit && nameEmpty) {
      if (entriesEmpty) {
        if (hasApi) await window.api.freeReceipt(rno)
        setSavedFlags(NO_SAVED)
        setOpenReceiptNo(null)
        refresh()
        return { ok: true, receipt_no: rno, freed: true }
      }
      return { ok: false, message: 'پہلے تمام اندراج ختم کریں، پھر نام ہٹائیں' }
    }

    // Name mandatory for any parchi save (ledger + snapshot are keyed to a customer).
    // The customer must ALREADY be saved — ensureCustomer never creates one now.
    const cust = await ensureCustomer()
    if (!cust || !cust.id) {
      const typed = (customer.name || '').trim()
      return {
        ok: false,
        message: typed
          ? 'یہ کسٹمر محفوظ نہیں — فہرست سے منتخب کریں یا "+" سے نیا کسٹمر شامل کریں'
          : 'پہلے کسٹمر منتخب کریں'
      }
    }

    // Current line-items for this receipt (strip the UI-only `section` tag).
    const rows = txns.map(({ section, ...row }) => ({ customer_id: cust.id, date: rates.date, ...row }))

    // FULL snapshot payload so reopening restores every entry (purity line-items
    // via input+overrides+rates, plus the نقد/ادھار entries) — symmetric with
    // loadReceipt, which reads exactly these fields back.
    const payload = {
      receipt_no: rno,
      customer: { id: cust.id, name: cust.name, mobile: cust.mobile },
      input: { wazan: input.wazan, malawat: input.malawat },
      overrides,
      rates,
      entries: { cashSell, cashBuy, udharGive, udharTake, udharCashGive, udharCashTake },
      sidebar: { ujratKaSona, parchunLiya, sonaDiya, cashDiya },
      comment: udharComment
    }

    // UPSERT: atomically delete this receipt_no's prior rows then insert the
    // current ones. Editing replaces the parchi (removed entries stay removed,
    // changed values overwrite) — one receipt_no → exactly one current version.
    if (hasApi) {
      // Guard: if the app was updated but Electron wasn't fully restarted, the
      // preload bridge won't yet expose replaceReceipt. Surface a clear message
      // instead of a silent throw that looks like "save did nothing".
      if (typeof window.api.replaceReceipt !== 'function') {
        return { ok: false, message: 'ایپ کو دوبارہ شروع کریں (Restart) — سیو اپڈیٹ ہوا ہے' }
      }
      if (DEBUG_SAVE) console.log('[saveParchi] replaceReceipt', { rno, isEdit, rows })
      const res = await window.api.replaceReceipt({
        receipt: { receipt_no: rno, type: 'parchi', customer_id: cust.id, date: rates.date, payload },
        transactions: rows
      })
      if (DEBUG_SAVE) console.log('[saveParchi] replaceReceipt result', res)
      if (res && res.ok === false) return { ok: false, message: res.message || 'محفوظ نہیں ہو سکا' }
    }

    // Auto-tick the sections that were saved.
    setSavedFlags((f) => ({
      ...f,
      naqad: txns.some((t) => t.section === 'naqad') || f.naqad,
      udhar: txns.some((t) => t.section === 'udhar') || f.udhar
    }))
    refresh()

    if (!isEdit) {
      // Brand-new parchi: it is now recorded in the ledger. CLEAR the entry fields
      // and advance to a fresh blank parchi. This is what fixes the "doubling": the
      // live receipt previews compute باقی = (ledger balance) + (current form
      // entries). After saving, the ledger ALREADY includes these amounts, so
      // leaving them in the form would count them a SECOND time on screen — and a
      // second Save would record them again. The customer is also cleared so the
      // previous parchi's name does NOT carry into the fresh parchi.
      setCustomer({ id: null, name: '', mobile: '', mobile2: '', telephone: '', address: '', imagePath: null })
      setCashSell({ wazan: '', point: '100', rate: '' })
      setCashBuy({ wazan: '', point: '100', rate: '' })
      setUdharGive({ wazan: '', point: '100', rate: '' })
      setUdharTake({ wazan: '', point: '100', rate: '' })
      setUdharCashGive('')
      setUdharCashTake('')
      setUdharComment('')
      setInput({ wazan: '', malawat: '' })
      setOverrides({})
      setSonaDiya('')
      setCashDiya('')
      // Fresh parchi after save: وصولی رسید starts UNticked (پرچوں لیا + اجرت کا سونا).
      setParchunLiya(false); setUjratKaSona(false)
      setSavedFlags(NO_SAVED)
      setOpenReceiptNo(null)
      if (hasApi) {
        const n = await window.api.nextReceiptNo()
        if (n) setReceiptNo(n)
      } else {
        setReceiptNo((r) => r + 1)
      }
    } else {
      // Editing an already-open parchi: keep it on screen (entries intact) so a
      // re-save overwrites the same receipt.
      setOpenReceiptNo(rno)
    }
    return { ok: true, receipt_no: rno, saved: rows.length, edited: isEdit }
  }, [rates, cashSell, cashBuy, udharGive, udharTake, udharCashGive, udharCashTake, udharComment, input, overrides, computedRows, ujratKaSona, parchunLiya, sonaDiya, cashDiya, receiptNo, openReceiptNo, customer, ensureCustomer, refresh])

  // Stage 3 — Save one udhar action-button transaction (kind/direction/category
  // supplied by the caller). `explicit` (optional) is the customer to record for
  // ({id} or {name}); when omitted we fall back to the global selected customer.
  // The ادھار form passes its OWN selected customer so it stays decoupled from the
  // main screen. Name mandatory. Returns { ok, message?, receipt_no? }.
  const saveUdharTxn = useCallback(async (t, explicit) => {
    let cust
    if (explicit && (explicit.id || (explicit.name && String(explicit.name).trim()))) {
      cust = explicit.id
        ? explicit
        : (hasApi ? await window.api.upsertCustomer({ name: String(explicit.name).trim() }) : { id: null, ...explicit })
    } else {
      cust = await ensureCustomer()
    }
    if (!cust || !cust.id) return { ok: false, message: 'پہلے کسٹمر کا نام منتخب کریں / درج کریں' }
    const rno = receiptNo
    if (hasApi) await window.api.addTransaction({ receipt_no: rno, customer_id: cust.id, date: rates.date, ...t })
    setSavedFlags((f) => ({ ...f, udhar: true }))
    refresh()
    if (hasApi) {
      const n = await window.api.nextReceiptNo()
      if (n) setReceiptNo(n)
    } else {
      setReceiptNo((r) => r + 1)
    }
    return { ok: true, receipt_no: rno, customer: cust }
  }, [ensureCustomer, receiptNo, rates.date, refresh])

  // Stage 6 — start a fresh, blank parchi at the next receipt number.
  const newParchi = useCallback(() => {
    setInput({ wazan: '', malawat: '' })
    setOverrides({})
    setCashSell({ wazan: '', point: '100', rate: '' })
    setCashBuy({ wazan: '', point: '100', rate: '' })
    setUdharGive({ wazan: '', point: '100', rate: '' })
    setUdharTake({ wazan: '', point: '100', rate: '' })
    setUdharCashGive('')
    setUdharCashTake('')
    setUdharComment('')
    setSonaDiya('')
    setCashDiya('')
    // A fresh parchi starts with the وصولی رسید UNticked (پرچوں لیا + اجرت کا سونا).
    setParchunLiya(false); setUjratKaSona(false)
    // Clear the customer so the previous parchi's name does NOT carry over.
    setCustomer({ id: null, name: '', mobile: '', mobile2: '', telephone: '', address: '', imagePath: null })
    // A fresh parchi always starts on TODAY'S date — even if the user set a past
    // date on the previous parchi, clicking "New" snaps the تاریخ back to today
    // (no app restart needed). Historical parchis keep their own saved date.
    setRates((r) => ({ ...r, date: todayISO() }))
    setSavedFlags(NO_SAVED)
    setOpenReceiptNo(null) // composing a fresh, unsaved parchi
    if (hasApi) window.api.nextReceiptNo().then((n) => n && setReceiptNo(n))
    else setReceiptNo((r) => r + 1)
  }, [])

  // Stage 1 — one-time fresh start: clear all transactions/receipts, numbering → 1.
  const resetData = useCallback(async () => {
    if (hasApi) await window.api.resetTransactions()
    setReceiptNo(1)
    setSavedFlags(NO_SAVED)
    refresh()
  }, [refresh])

  // Reset ONLY کچا سونا لیا data (kacha transactions + their own receipts). Other
  // data and the receipt numbering are untouched. refresh() so the bottom-bar کچا
  // سونا total re-reads to 0. Returns { ok, removedTxns?, removedReceipts? }.
  const resetKachaData = useCallback(async () => {
    if (!hasApi) return { ok: false }
    const res = await window.api.resetKachaGold()
    refresh()
    return res || { ok: true }
  }, [refresh])

  // Reset ONLY the bottom-bar کچا سونا COUNTER (display → 0) WITHOUT deleting any
  // کچا سونا لیا record — the اُدھار report keeps them. refresh() so the bottom-bar
  // re-reads (sum − baseline) = 0. Returns { ok, kacha_sona? }.
  const resetKachaCounter = useCallback(async () => {
    if (!hasApi) return { ok: false }
    const res = await window.api.resetKachaCounter()
    refresh()
    return res || { ok: true }
  }, [refresh])

  // Add an expense (کھرچہ): writes to the expenses table (so it shows in reports)
  // and refresh()es so the bottom-bar cash DISPLAY re-derives (cash − today's
  // expenses). Does NOT touch any cash transaction / ledger balance.
  const addExpense = useCallback(async (e) => {
    if (hasApi) await window.api.addExpense(e)
    refresh()
    return { ok: true }
  }, [refresh])

  // Edit / delete a single expense (from the اخراجات reports). Both refresh() so
  // the bottom-bar cash DISPLAY re-derives immediately: if an expense dated today
  // is increased, today's cash shown drops by that much; delete restores it.
  const editExpense = useCallback(async (id, fields) => {
    if (hasApi) await window.api.updateExpense(id, fields)
    refresh()
    return { ok: true }
  }, [refresh])

  const removeExpense = useCallback(async (id) => {
    if (hasApi) await window.api.deleteExpense(id)
    refresh()
    return { ok: true }
  }, [refresh])

  // Delete ALL expenses (fresh start). Reports go empty; refresh() re-derives the
  // cash display (today's expenses → 0). Only the expenses table is cleared.
  const resetExpensesData = useCallback(async () => {
    if (!hasApi) return { ok: false }
    const res = await window.api.resetExpenses()
    refresh()
    return res || { ok: true }
  }, [refresh])

  // Stage 4/5 — fetch a filtered customer report ({ rows, total_gold, total_cash }).
  const getReport = useCallback(async (opts) => {
    if (!hasApi) return { rows: [], total_gold: 0, total_cash: 0 }
    return await window.api.getReport(opts)
  }, [])

  // Group-1 balance report: one aggregated row per customer for a category.
  const getReportGroup1 = useCallback(async (opts) => {
    if (!hasApi) return { rows: [], total_gold: 0, total_cash: 0 }
    return await window.api.reportGroup1(opts)
  }, [])

  // "کچا سونا لیا" report: one aggregated row per customer with the 5 columns
  // (نام / کچا سونا / خالص سونا / سونا دیا / کیش دیا) + summed totals.
  const getKachaReport = useCallback(async (opts) => {
    const empty = { rows: [], totals: { kacha_sona: 0, khalis_sona: 0, sona_diya: 0, cash_diya: 0 } }
    if (!hasApi) return empty
    return (await window.api.reportKachaGold(opts)) || empty
  }, [])

  // Part 1 — edit / delete a saved transaction. Both refresh() so balances +
  // any open report re-query immediately.
  const editTransaction = useCallback(async (id, fields) => {
    if (hasApi) await window.api.updateTransaction(id, fields)
    refresh()
    return { ok: true }
  }, [refresh])

  const removeTransaction = useCallback(async (id) => {
    if (hasApi) await window.api.deleteTransaction(id)
    refresh()
    return { ok: true }
  }, [refresh])

  // Part 2 — record a settlement / return. Creates a NEW opposite-direction
  // transaction (tagged meta.settle) for the customer; the original is untouched.
  // kind: 'gold' | 'cash'; direction: 'in' (we receive) | 'out' (we give).
  const recordSettle = useCallback(async ({ customer: cust, kind, direction, amount, note }) => {
    const amt = Number(amount) || 0
    if (!(amt > 0)) return { ok: false, message: 'رقم / مقدار درج کریں' }
    let c = cust
    if ((!c || !c.id) && c && c.name && String(c.name).trim() && hasApi) {
      c = await window.api.upsertCustomer({ name: String(c.name).trim() })
    }
    if (!c || !c.id) return { ok: false, message: 'پہلے کسٹمر منتخب کریں / نام درج کریں' }
    const category = kind === 'gold'
      ? (direction === 'in' ? 'gold_take' : 'gold_give')
      : (direction === 'in' ? 'cash_take' : 'cash_give')
    const t = { kind: 'udhar', direction, category, note: note || 'قسط/واپسی', meta: { settle: true } }
    if (kind === 'gold') { t.sona_wazan = amt; t.point = 100; t.khalis_sona = amt } else t.cash_amount = amt
    const rno = receiptNo
    if (hasApi) await window.api.settleTransaction({ receipt_no: rno, customer_id: c.id, date: rates.date, ...t })
    refresh()
    if (hasApi) { const n = await window.api.nextReceiptNo(); if (n) setReceiptNo(n) } else setReceiptNo((r) => r + 1)
    return { ok: true, receipt_no: rno }
  }, [receiptNo, rates.date, refresh])

  const value = {
    screen, setScreen,
    rates, saveRates,
    receiptNo, setReceiptNo,
    customer, setCustomer, newCustomer, saveCustomer,
    totals, refresh, bump,
    cashDisplay, addExpense, editExpense, removeExpense, resetExpensesData,
    input, setInput, setWeight,
    overrides, setCell, clearCell, toggleParchi, resetEntry,
    ujratKaSona, toggleUjratKaSona,
    parchunLiya, toggleParchunLiya,
    sonaDiya, setSonaDiya,
    cashDiya, setSonaDiyaLinked, setCashDiyaLinked,
    cashSell, setCashSell,
    cashBuy, setCashBuy,
    udharGive, setUdharGive,
    udharTake, setUdharTake,
    udharCashGive, setUdharCashGive,
    udharCashTake, setUdharCashTake,
    udharComment, setUdharComment,
    computedRows,
    loadReceipt, loadReceiptNo,
    openReceiptNo,
    hasPrevReceipt: receiptBounds.hasPrev,
    hasNextReceipt: receiptBounds.hasNext,
    gotoFirstReceipt, gotoLastReceipt, gotoNextReceipt, gotoPrevReceipt,
    addTransaction,
    saveParchi, saveUdharTxn, newParchi, resetData, resetKachaData, resetKachaCounter, getReport, getReportGroup1, getKachaReport,
    editTransaction, removeTransaction, recordSettle,
    savedFlags, setSavedFlags,
    udharOpen, openUdhar, closeUdhar,
    akhrajatOpen, openAkhrajat, closeAkhrajat,
    printSlips,
    shareSlipWhatsApp,
    hasApi
  }

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>
}
