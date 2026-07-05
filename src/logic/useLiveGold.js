import { useEffect, useState } from 'react'

// Live gold spot (display-only reference). Subscribes to the main process's
// poll pushes and keeps the previous price so the UI can tick green/red.
// { price, prevPrice, ok, ts } — price stays at the LAST GOOD value when the
// feed drops (ok goes false); price is null until a first value ever arrives.
export default function useLiveGold() {
  const [st, setSt] = useState({ price: null, prevPrice: null, ok: false, ts: null })

  useEffect(() => {
    if (!(window.api && window.api.onLiveGold)) return undefined
    let mounted = true
    const apply = (d) => {
      if (!mounted || !d) return
      setSt((old) => ({
        price: d.price != null ? d.price : old.price, // never lose the last good value
        prevPrice: old.price,
        ok: !!d.ok,
        ts: d.ts || old.ts
      }))
    }
    const off = window.api.onLiveGold(apply)
    // seed immediately (one fetch) instead of waiting for the next poll push
    if (window.api.getLiveGold) window.api.getLiveGold().then(apply).catch(() => {})
    return () => { mounted = false; if (typeof off === 'function') off() }
  }, [])

  return st
}
