import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react'
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

export function AppProvider({ children }) {
  const [screen, setScreen] = useState('main') // 'main' | 'daybook' | 'udhar'
  const [rates, setRates] = useState(FALLBACK_RATES)
  const [receiptNo, setReceiptNo] = useState(1)
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

  // Purity table inputs + per-cell manual overrides.
  const [input, setInput] = useState({ wazan: '', malawat: '' })
  const [overrides, setOverrides] = useState({}) // { rowKey: { field: value } }

  // وصولی رسید sidebar toggles + the gold the customer hands over (سونا دیا, grams).
  const [ujratKaSona, setUjratKaSona] = useState(true) // اجرت کا سونا (default on)
  const [parchunLiya, setParchunLiya] = useState(false) // پرچوں لیا
  const [sonaDiya, setSonaDiya] = useState('') // سونا دیا (grams, editable)

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

  const computedRows = useMemo(
    () => computeTable(input, rates, overrides),
    [input, rates, overrides]
  )

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
    if (rcptNo != null) setReceiptNo(rcptNo)

    const cust = payload.customer ?? data.customer
    if (cust) {
      setCustomer({
        id: cust.id ?? data.customer_id ?? null,
        name: cust.name ?? '',
        mobile: cust.mobile ?? ''
      })
    }

    const inp = payload.input ?? data.input
    if (inp) {
      setInput({ wazan: inp.wazan ?? '', malawat: inp.malawat ?? '' })
    }

    setOverrides(payload.overrides ?? data.overrides ?? {})
  }, [])

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

    if (!txns.length) return { ok: false, message: 'کوئی اندراج نہیں — پہلے مقدار درج کریں' }

    // Name mandatory for cash/udhar.
    const cust = await ensureCustomer()
    if (!cust || !cust.id) return { ok: false, message: 'پہلے کسٹمر منتخب کریں / نام درج کریں' }

    const rno = receiptNo
    for (const t of txns) {
      const { section, ...row } = t
      if (hasApi) await window.api.addTransaction({ receipt_no: rno, customer_id: cust.id, date: rates.date, ...row })
    }

    // Auto-tick the sections that were saved.
    setSavedFlags((f) => ({
      ...f,
      naqad: txns.some((t) => t.section === 'naqad') || f.naqad,
      udhar: txns.some((t) => t.section === 'udhar') || f.udhar
    }))
    refresh()

    // Advance to the next parchi number so the next entry is a new record.
    if (hasApi) {
      const n = await window.api.nextReceiptNo()
      if (n) setReceiptNo(n)
    } else {
      setReceiptNo((r) => r + 1)
    }
    return { ok: true, receipt_no: rno, saved: txns.length }
  }, [rates.rate_tezabi_tola, rates.date, cashSell, cashBuy, udharGive, udharTake, udharCashGive, udharCashTake, receiptNo, ensureCustomer, refresh])

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
    if (!cust || !cust.id) return { ok: false, message: 'پہلے کسٹمر منتخب کریں / نام درج کریں' }
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
    setSavedFlags(NO_SAVED)
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
    input, setInput, setWeight,
    overrides, setCell, clearCell, toggleParchi, resetEntry,
    ujratKaSona, toggleUjratKaSona,
    parchunLiya, toggleParchunLiya,
    sonaDiya, setSonaDiya,
    cashSell, setCashSell,
    cashBuy, setCashBuy,
    udharGive, setUdharGive,
    udharTake, setUdharTake,
    udharCashGive, setUdharCashGive,
    udharCashTake, setUdharCashTake,
    computedRows,
    loadReceipt,
    addTransaction,
    saveParchi, saveUdharTxn, newParchi, resetData, getReport, getReportGroup1,
    editTransaction, removeTransaction, recordSettle,
    savedFlags, setSavedFlags,
    udharOpen, openUdhar, closeUdhar,
    akhrajatOpen, openAkhrajat, closeAkhrajat,
    printSlips,
    hasApi
  }

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>
}
