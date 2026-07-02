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

  // Bottom-bar "کچا سونا" is a DISPLAY-ONLY accumulator. Each parchi Save with the
  // sidebar "پرچوں لیا" checkbox TICKED adds that parchi's وزن کانٹے پر (input.wazan)
  // — and nothing else — to this on-screen number. It resets on a date change and
  // via the manual reset button. It NEVER reads or writes the DB or the کچا سونا
  // لیا report (that report is fed only by کچا سونا لیا transactions, unchanged).
  const [kachaDisplay, setKachaDisplay] = useState(0)
  const kachaDateRef = useRef(null)

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

  // Today's expenses total (read-only) — recomputed on every write (bump, e.g.
  // after adding an expense) and on a date change. Reduces ONLY the cash DISPLAY.
  useEffect(() => {
    if (!hasApi) return
    window.api.getExpensesTotalForDate(rates.date).then((s) => setExpensesToday(Number(s) || 0))
  }, [rates.date, bump])

  // Date change → reset the کچا سونا display counter for the new day (display-only).
  // Keyed on rates.date ONLY (never `bump`), so a normal save doesn't wipe the
  // running accumulator — only an actual date change does.
  useEffect(() => {
    if (kachaDateRef.current == null) { kachaDateRef.current = rates.date; return }
    if (kachaDateRef.current !== rates.date) {
      kachaDateRef.current = rates.date
      setKachaDisplay(0)
    }
  }, [rates.date])

  // DISPLAY-ONLY manual reset — zeros the on-screen number; DB/report untouched.
  const resetKachaDisplay = useCallback(() => setKachaDisplay(0), [])

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

  // PART 2 — سونا دیا ↔ کیش دیا two-way binding, using the EXISTING rate basis:
  //   ratePerGram = selected purity row's rate (ریٹ فی تولہ) ÷ GRAMS_PER_TOLA
  //   cash = gold × ratePerGram    gold = cash ÷ ratePerGram
  // (Identical to LeftSidebar/saveParchi's cashForLeftover = gold × ratePerGram.)
  // The selected row is the پرچی-ticked one, else Standard — same as the sidebar.
  const sidebarRatePerGram = useCallback(() => {
    const sel = computedRows.find((r) => r.parchi) || computedRows[2]
    return sel ? (Number(sel.rate) || 0) / GRAMS_PER_TOLA : 0
  }, [computedRows])

  // These are called ONLY from the user's onChange on each input. They set the
  // SIBLING field's state directly (not via its onChange), so a programmatic
  // update never re-fires the other handler → no feedback loop.
  const setSonaDiyaLinked = useCallback((v) => {
    setSonaDiya(v)
    const rpg = sidebarRatePerGram()
    const n = Number(v)
    if (String(v).trim() === '' || !Number.isFinite(n)) setCashDiya('')
    else if (rpg > 0) setCashDiya(String(round(n * rpg, 0)))
  }, [sidebarRatePerGram])

  const setCashDiyaLinked = useCallback((v) => {
    setCashDiya(v)
    const rpg = sidebarRatePerGram()
    const n = Number(v)
    if (String(v).trim() === '' || !Number.isFinite(n)) setSonaDiya('')
    else if (rpg > 0) setSonaDiya(String(round(n / rpg, 3)))
  }, [sidebarRatePerGram])

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
  const printSlips = useCallback(() => {
    const n = Math.max(1, parseInt(rates.slip_count, 10) || 1)
    for (let i = 0; i < n; i++) window.print()
  }, [rates.slip_count])

  // Change a top weight (gross / water). Changing a weight reruns the forward
  // calc fresh for all 5 rows, so any per-row manual edits (e.g. Baqi Raqam
  // reverse-calc) are dropped.
  const setWeight = useCallback((field, value) => {
    setInput((s) => ({ ...s, [field]: value }))
    setOverrides({})
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

  // A customer/name is mandatory for any cash/udhar (ledger) save. Returns the
  // customer with a real id (creating it if the operator only typed a name), or
  // null when nothing is selected/typed.
  const ensureCustomer = useCallback(async () => {
    if (customer.id) return customer
    if (!(customer.name && customer.name.trim())) return null
    if (!hasApi) return customer
    return await saveCustomer(customer)
  }, [customer, saveCustomer])

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
    if (kachaWazan > 0) {
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
    const cust = await ensureCustomer()
    if (!cust || !cust.id) return { ok: false, message: 'پہلے کسٹمر کا نام منتخب کریں / درج کریں' }

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
      sidebar: { ujratKaSona, parchunLiya, sonaDiya, cashDiya }
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
    // The just-saved parchi is now the "current open" one for Next/Prev nav.
    setOpenReceiptNo(rno)
    refresh()

    // Bottom-bar کچا سونا (DISPLAY-ONLY): when the sidebar "پرچوں لیا" checkbox is
    // ticked, add this parchi's وزن کانٹے پر (input.wazan) — and ONLY that — to the
    // on-screen counter. This touches no transaction/receipt/report.
    if (parchunLiya) {
      const w = Number(input.wazan) || 0
      if (w > 0) setKachaDisplay((v) => v + w)
    }

    // Only a BRAND-NEW parchi advances to the next number; editing keeps #rno so
    // the screen stays on it and re-saving overwrites the same receipt again.
    if (!isEdit) {
      if (hasApi) {
        const n = await window.api.nextReceiptNo()
        if (n) setReceiptNo(n)
      } else {
        setReceiptNo((r) => r + 1)
      }
    }
    return { ok: true, receipt_no: rno, saved: rows.length, edited: isEdit }
  }, [rates, cashSell, cashBuy, udharGive, udharTake, udharCashGive, udharCashTake, input, overrides, computedRows, ujratKaSona, parchunLiya, sonaDiya, cashDiya, receiptNo, openReceiptNo, customer, ensureCustomer, refresh])

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
    setSonaDiya('')
    setCashDiya('')
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

  // Add an expense (کھرچہ): writes to the expenses table (so it shows in reports)
  // and refresh()es so the bottom-bar cash DISPLAY re-derives (cash − today's
  // expenses). Does NOT touch any cash transaction / ledger balance.
  const addExpense = useCallback(async (e) => {
    if (hasApi) await window.api.addExpense(e)
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
    kachaDisplay, resetKachaDisplay,
    cashDisplay, addExpense, resetExpensesData,
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
    computedRows,
    loadReceipt, loadReceiptNo,
    openReceiptNo,
    gotoFirstReceipt, gotoLastReceipt, gotoNextReceipt, gotoPrevReceipt,
    addTransaction,
    saveParchi, saveUdharTxn, newParchi, resetData, resetKachaData, getReport, getReportGroup1, getKachaReport,
    editTransaction, removeTransaction, recordSettle,
    savedFlags, setSavedFlags,
    udharOpen, openUdhar, closeUdhar,
    akhrajatOpen, openAkhrajat, closeAkhrajat,
    printSlips,
    hasApi
  }

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>
}
