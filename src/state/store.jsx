import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react'
import { computeTable } from '../logic/purity.js'

const AppCtx = createContext(null)
export const useApp = () => useContext(AppCtx)

// Fallback rates if the DB bridge isn't ready (e.g. running renderer in a
// plain browser without Electron). Keeps the UI alive for development.
const FALLBACK_RATES = {
  date: '2026-05-15',
  rate_tezabi_tola: 9000,
  parchi_charges: 100,
  fc_per_gram: 80,
  rate_tezabi_gram: 772,
  point: 100
}

const hasApi = typeof window !== 'undefined' && window.api

export function AppProvider({ children }) {
  const [screen, setScreen] = useState('main') // 'main' | 'daybook' | 'udhar'
  const [rates, setRates] = useState(FALLBACK_RATES)
  const [receiptNo, setReceiptNo] = useState(519)
  const [customer, setCustomer] = useState({ id: null, name: '', mobile: '' })
  const [totals, setTotals] = useState({ cash: 0, tezabi_sona: 0, parchun: 0 })
  const [bump, setBump] = useState(0)

  // Purity table inputs + per-cell manual overrides.
  const [input, setInput] = useState({ wazan: '', malawat: '' })
  const [overrides, setOverrides] = useState({}) // { rowKey: { field: value } }

  const refresh = useCallback(() => setBump((b) => b + 1), [])

  // Initial load
  useEffect(() => {
    if (!hasApi) return
    ;(async () => {
      const r = await window.api.getRates()
      if (r) setRates(r)
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

  // ---- actions ----
  const saveRates = useCallback(async (patch) => {
    const next = { ...rates, ...patch }
    setRates(next)
    if (hasApi) await window.api.saveRates(next)
  }, [rates])

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

  const resetEntry = useCallback(() => {
    setInput({ wazan: '', malawat: '' })
    setOverrides({})
  }, [])

  const newCustomer = useCallback(() => {
    setCustomer({ id: null, name: '', mobile: '' })
  }, [])

  const saveCustomer = useCallback(async () => {
    if (!hasApi) return customer
    const saved = await window.api.upsertCustomer(customer)
    setCustomer(saved)
    refresh()
    return saved
  }, [customer, refresh])

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

  const value = {
    screen, setScreen,
    rates, saveRates,
    receiptNo, setReceiptNo,
    customer, setCustomer, newCustomer, saveCustomer,
    totals, refresh, bump,
    input, setInput, setWeight,
    overrides, setCell, clearCell, toggleParchi, resetEntry,
    computedRows,
    addTransaction,
    hasApi
  }

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>
}
