import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useApp } from '../state/store.jsx'
import { fmtMoney } from '../logic/units'

// Bottom-bar notification bell for نیا سودا that is still بقایا and DUE — i.e.
// status='bakaya' AND date <= today. Future-dated deals are not due yet, so they
// never count. The badge shows the total; clicking the bell opens a panel split
// into گزر چکے (date < today) and آج والے (date === today). Marking a row
// «بھگتان ہو گیا» flips its status and removes it instantly (no page refresh).
//
// No DB migration: the "already reminded today" flag lives in localStorage, not
// a settings column. Everything reads the EXISTING naya_soda rows through the
// existing listNayaSoda / setNayaSodaStatus IPC — no schema is touched.

const todayISO = () => {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

const TYPE_LABEL = { khareed: 'خرید', farokht: 'فروخت' }
// Weight, same rounding the نیا سودا report uses (0.0001g precision).
const fmtW = (n) => String(Math.round((Number(n) || 0) * 10000) / 10000)
const REMINDER_KEY = 'goldlab_soda_reminder_seen_on'

// One سودا row inside the panel.
function Row({ r, onPaid }) {
  return (
    <div className="flex items-center gap-2 px-2.5 py-1.5 border-b border-gray-100 last:border-b-0">
      <div className="flex-1 min-w-0">
        <div className="urdu text-[13px] font-bold text-gray-800 truncate">{r.name || '—'}</div>
        <div className="flex items-center gap-2 text-[11px] text-gray-500" dir="rtl">
          <span className="urdu">{TYPE_LABEL[r.type] || r.type || ''}</span>
          <span dir="ltr" className="tabular-nums">وزن {fmtW(r.wazan)}</span>
          <span dir="ltr" className="tabular-nums">ریٹ {fmtMoney(r.rate)}</span>
          <span dir="ltr" className="tabular-nums">{r.date || ''}</span>
        </div>
      </div>
      <button
        type="button"
        onClick={() => onPaid(r.id)}
        className="shrink-0 urdu text-[11px] font-bold text-white bg-emerald-600 rounded px-2.5 py-1 hover:bg-emerald-700 active:bg-emerald-800"
      >
        بھگتان ہو گیا
      </button>
    </div>
  )
}

function Section({ title, rows, onPaid }) {
  if (!rows.length) return null
  return (
    <div>
      <div className="urdu text-[11px] font-bold text-gray-500 bg-gray-100 px-2.5 py-1 sticky top-0">{title}</div>
      {rows.map((r) => <Row key={r.id} r={r} onPaid={onPaid} />)}
    </div>
  )
}

export default function SodaBell() {
  const { bump, refresh } = useApp()
  const hasApi = typeof window !== 'undefined' && window.api && window.api.listNayaSoda
  const [past, setPast] = useState([])       // date < today
  const [todayList, setTodayList] = useState([]) // date === today
  const [open, setOpen] = useState(false)
  const [toast, setToast] = useState(0)      // >0 → show the first-of-day toast
  const wrapRef = useRef(null)
  const toastTimer = useRef(null)
  const remindedRef = useRef(false)          // fire the daily toast at most once per mount

  const count = past.length + todayList.length

  // Load the DUE بقایا rows (date <= today) and split past / today. Excludes
  // future-dated deals by asking listNayaSoda for `to = today`.
  const load = useCallback(async () => {
    if (!hasApi) return
    const today = todayISO()
    let rows = []
    try { rows = (await window.api.listNayaSoda('bakaya', '', today)) || [] } catch { rows = [] }
    setPast(rows.filter((r) => String(r.date || '') < today))
    setTodayList(rows.filter((r) => String(r.date || '') === today))
  }, [hasApi])

  // Mount + whenever the app signals a data change (bump) — so adding or paying a
  // سودا anywhere keeps the badge correct without a manual refresh.
  useEffect(() => { load() }, [load, bump])

  // First time the app is opened on a given day: if anything is due, show a small
  // self-dismissing toast ONCE (never open the panel). localStorage remembers the
  // date so it does not reappear that day; next day it fires again.
  useEffect(() => {
    if (remindedRef.current || count <= 0) return
    remindedRef.current = true
    let seen = null
    try { seen = window.localStorage.getItem(REMINDER_KEY) } catch { seen = null }
    const today = todayISO()
    if (seen === today) return
    try { window.localStorage.setItem(REMINDER_KEY, today) } catch { /* private mode — just skip persistence */ }
    setToast(count)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(0), 3000)
  }, [count])

  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current) }, [])

  // Close the panel on any click outside it (bell click is inside, so it toggles
  // normally). Only listens while open.
  useEffect(() => {
    if (!open) return undefined
    const onDown = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  // Mark one سودا paid: remove it instantly (optimistic → badge drops now), then
  // persist and let the rest of the app re-read. On an API failure, reload so the
  // row reappears rather than silently vanishing.
  const markPaid = async (id) => {
    setPast((xs) => xs.filter((r) => r.id !== id))
    setTodayList((xs) => xs.filter((r) => r.id !== id))
    try {
      await window.api.setNayaSodaStatus(id, 'bhugtan')
      if (typeof refresh === 'function') refresh()
    } catch { load() }
  }

  const toastText = toast === 1 ? 'آپ کے پاس 1 اطلاع ہے' : `آپ کے پاس ${toast} اطلاعات ہیں`

  return (
    <div ref={wrapRef} className="relative self-center">
      {/* first-of-day toast — in-app, non-blocking, clickable to open the panel.
          bottom-full keeps it above the bell whatever the bell's height. */}
      {toast > 0 && (
        <button
          type="button"
          onClick={() => { setToast(0); setOpen(true) }}
          className="absolute bottom-full right-0 mb-2 z-50 urdu text-[12px] font-bold text-white bg-slate-800 rounded-md px-3 py-1.5 shadow-lg whitespace-nowrap hover:bg-slate-900"
        >
          🔔 {toastText}
        </button>
      )}

      {/* Bigger, colourful bell — a rich indigo→violet gradient: distinct from the
          nearby green (رسید نکالیں), orange (اندراج) and blue (Defaults) buttons,
          and the red badge pops crisply on it. Neutral slate when nothing is due. */}
      <button
        type="button"
        title="بقایا سودا کی اطلاعات"
        onClick={() => setOpen((o) => !o)}
        className={`relative flex items-center justify-center w-[34px] h-[34px] rounded-xl text-white shadow-md transition-all focus:outline-none focus:ring-2 focus:ring-indigo-300 ${
          count > 0
            ? 'bg-gradient-to-b from-indigo-500 to-violet-600 hover:from-indigo-600 hover:to-violet-700 active:from-indigo-700 active:to-violet-800'
            : 'bg-gradient-to-b from-slate-400 to-slate-500 hover:from-slate-500 hover:to-slate-600'
        }`}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true">
          <path d="M12 2.2a1.2 1.2 0 0 1 1.2 1.2v.5a6.3 6.3 0 0 1 5 6.16c0 3.9 1.35 5.2 2.2 5.98.44.4.6 1 .38 1.55-.22.53-.74.86-1.32.86H4.54c-.58 0-1.1-.33-1.32-.86-.22-.55-.06-1.15.38-1.55.85-.78 2.2-2.08 2.2-5.98a6.3 6.3 0 0 1 5-6.16v-.5A1.2 1.2 0 0 1 12 2.2z" />
          <path d="M9.5 20.2a2.5 2.5 0 0 0 5 0z" />
        </svg>
        {count > 0 && (
          <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-red-600 text-white text-[11px] font-bold leading-none tabular-nums ring-2 ring-white shadow">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute bottom-full right-0 mb-2 z-40 w-[360px] max-h-[60vh] overflow-y-auto rounded-lg border border-gray-300 bg-white shadow-2xl">
          <div className="urdu text-[12px] font-bold text-gray-700 px-2.5 py-2 border-b border-gray-200 bg-gray-50 sticky top-0">
            بقایا سودا کی اطلاعات
          </div>
          {count === 0 ? (
            <div className="urdu text-[12px] text-gray-500 text-center px-3 py-6">کوئی بقایا سودا نہیں</div>
          ) : (
            <>
              <Section title="گزر چکے" rows={past} onPaid={markPaid} />
              <Section title="آج والے" rows={todayList} onPaid={markPaid} />
            </>
          )}
        </div>
      )}
    </div>
  )
}
