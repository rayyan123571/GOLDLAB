import React, { useEffect, useRef, useState } from 'react'
import { useApp } from '../state/store.jsx'
import useLiveGold from '../logic/useLiveGold.js'
import DefaultsForm from './DefaultsForm.jsx'
import IndrajForm from './IndrajForm.jsx'
import SodaBell from './SodaBell.jsx'

const DAY_MS = 24 * 60 * 60 * 1000
const BACKUP_STALE_DAYS = 7 // older than this → the "! بیک اپ کریں" nudge appears

// Urdu message for each failure reason electron/manualBackup.cjs can return. A
// backup must NEVER fail silently, so every path here ends in a visible message.
const BACKUP_ERROR = {
  'no-folder': 'بیک اپ فولڈر منتخب نہیں کیا گیا',
  'not-writable': 'بیک اپ فولڈر نہیں ملا یا اس میں لکھا نہیں جا سکتا',
  'no-db': 'ڈیٹا بیس فائل نہیں ملی',
  'busy': 'بیک اپ پہلے سے جاری ہے',
  'copy-failed': 'بیک اپ محفوظ نہیں ہو سکا — جگہ یا اجازت چیک کریں'
}

// Live gold spot box (display-only reference — no rates/receipts involvement).
// MT5 Market-Watch style: bid (bold, larger) / ask (smaller, muted) side by
// side, digits flash green/red on tick up/down and the whole box gets a subtle
// tint, both fading over ~600ms so rapid 1s ticks stay visible. Grey stale
// state with a tiny آف لائن hint when the feed drops; "--" before first value.
function GoldTicker() {
  const { bid, ask, prevBid, ok } = useLiveGold()
  const [flash, setFlash] = useState(null) // 'up' | 'down' | null

  useEffect(() => {
    if (bid == null || prevBid == null || bid === prevBid) return undefined
    setFlash(bid > prevBid ? 'up' : 'down')
    const t = setTimeout(() => setFlash(null), 600) // short fade — rapid ticks visible
    return () => clearTimeout(t)
  }, [bid, prevBid])

  // stale grey ALWAYS wins — a dead feed must never keep flashing green/red
  const bidColor = !ok ? '#9ca3af' : flash === 'up' ? '#16a34a' : flash === 'down' ? '#dc2626' : '#000000'
  const askColor = !ok ? '#9ca3af' : '#6b7280'
  // subtle per-tick background tint like MT5 rows; no tint while stale (grey wins)
  const bg = !ok ? '#ffffff' : flash === 'up' ? 'rgba(22,163,74,0.12)' : flash === 'down' ? 'rgba(220,38,38,0.12)' : '#ffffff'
  return (
    <div
      className="self-center flex items-center gap-1.5 h-[30px] px-3 min-w-[200px] flex-shrink-0 overflow-hidden rounded-md border border-gray-300"
      style={{ backgroundColor: bg, transition: 'background-color 600ms ease-out' }}
      title="Live gold spot (bid / ask) — صرف حوالہ، ریٹ/حساب سے الگ"
      data-gold-ticker
    >
      <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${ok ? 'bg-green-500' : 'bg-gray-400'}`} />
      <span className="text-[14px] font-bold leading-none">Gold</span>
      <span dir="ltr" className="flex items-baseline gap-1 whitespace-nowrap leading-none">
        <span className="text-[19px] font-extrabold tabular-nums" style={{ color: bidColor }}>
          {bid != null ? bid.toFixed(2) : '--'}
        </span>
        <span className="text-[11px] tabular-nums" style={{ color: askColor }}>/</span>
        <span className="text-[14px] font-semibold tabular-nums" style={{ color: askColor }}>
          {ask != null ? ask.toFixed(2) : '--'}
        </span>
      </span>
      {!ok && bid != null && <span className="urdu text-[9px] text-gray-400 whitespace-nowrap leading-none">آف لائن</span>}
    </div>
  )
}

export default function StatusBar() {
  const { resetEntry, searchReceiptNo } = useApp()
  const [search, setSearch] = useState('')
  const [searchMsg, setSearchMsg] = useState('')
  const [showDefaults, setShowDefaults] = useState(false)
  const [showIndraj, setShowIndraj] = useState(false) // اندراج (manual balance adjust) modal
  const [backupBusy, setBackupBusy] = useState(false)
  const [backupMsg, setBackupMsg] = useState(null) // { text, ok } | null — self-dismissing
  const [lastBackupAt, setLastBackupAt] = useState(null)
  const backupTimer = useRef(null)

  // Last manual-backup time — drives the overdue nudge beside the button. Read
  // once on mount and refreshed after every successful backup.
  useEffect(() => {
    if (!window.api || !window.api.manualBackupStatus) return
    window.api.manualBackupStatus()
      .then((s) => { if (s && s.ok) setLastBackupAt(s.lastBackupAt || null) })
      .catch(() => { /* status is advisory only — never block the bar */ })
  }, [])

  useEffect(() => () => { if (backupTimer.current) clearTimeout(backupTimer.current) }, [])

  // Brief inline message in the bar itself — never a blocking dialog.
  const flashBackup = (text, ok) => {
    setBackupMsg({ text, ok })
    if (backupTimer.current) clearTimeout(backupTimer.current)
    backupTimer.current = setTimeout(() => setBackupMsg(null), 4000)
  }

  // One click = one dated snapshot copied into the chosen folder. With no folder
  // chosen yet the picker opens first, then the backup continues in the same click.
  const doBackup = async () => {
    if (backupBusy) return
    if (!window.api || !window.api.manualBackupRun) { flashBackup('بیک اپ اس موڈ میں دستیاب نہیں', false); return }
    setBackupBusy(true)
    try {
      const status = await window.api.manualBackupStatus()
      if (!status || !status.folder) {
        const picked = await window.api.manualBackupPickFolder()
        if (!picked || !picked.ok) {
          flashBackup(BACKUP_ERROR[picked && picked.reason] || BACKUP_ERROR['no-folder'], false)
          return
        }
      }
      const res = await window.api.manualBackupRun()
      if (res && res.ok) {
        setLastBackupAt(res.lastBackupAt || null)
        flashBackup(`ڈیٹا محفوظ ہو گیا — ${res.fileName}`, true)
      } else {
        flashBackup(BACKUP_ERROR[res && res.reason] || 'بیک اپ محفوظ نہیں ہو سکا', false)
      }
    } catch (e) {
      console.warn('Manual backup failed:', e)
      flashBackup('بیک اپ محفوظ نہیں ہو سکا', false)
    } finally {
      setBackupBusy(false)
    }
  }

  // Overdue = never backed up at all, or more than a week since the last one.
  const backupOverdue = !lastBackupAt || (Date.now() - new Date(lastBackupAt).getTime()) > BACKUP_STALE_DAYS * DAY_MS


  // Look up a parchi by its number, triggered by pressing Enter in the رسید نمبر
  // field. Delegates to the store's searchReceiptNo, which walks the merged
  // saved+draft timeline (so unsaved DRAFT parchis are found too, not just
  // receipts already in the ledger). Empty → do nothing; non-numeric → Urdu
  // error; no match anywhere → "does not exist"; a match → parked-then-loaded.
  const doSearch = async () => {
    const raw = String(search).trim()
    if (!raw) { setSearchMsg(''); return } // empty — gentle no-op
    if (!/^\d+$/.test(raw)) { setSearchMsg('صرف نمبر لکھیں'); return }
    setSearchMsg('')
    try {
      // Walk the merged saved+draft timeline (nav arrows use the same one) so a
      // parchi that only exists as an unsaved DRAFT is still found, not just
      // receipts already written to the ledger.
      const res = await searchReceiptNo(Number(raw))
      setSearchMsg(res && res.ok ? '' : (res && res.message) || 'یہ رسید نمبر موجود نہیں')
    } catch (e) {
      console.warn('Receipt lookup failed:', e)
      setSearchMsg('یہ رسید نمبر موجود نہیں')
    }
  }

  return (
    <div dir="rtl" className="flex items-stretch gap-1 px-1 py-1 bg-panel border-t border-line h-[40px]">
      {/* The live shop totals (کیش | کچا سونا | تیزابی) no longer live here —
          they moved, unchanged, into the top bar's ٹوٹل panel (TotalsPanel.jsx). */}

      {/* بیک اپ — manual snapshot of the database into the chosen (Google Drive)
          folder. FIRST DOM child on purpose: this bar is dir="rtl", so the first
          child renders at the far RIGHT, and the flex-1 spacer below then pushes
          everything else to the left. Moving this after the spacer would put it
          on the wrong end of the bar. */}
      <div className="self-center flex items-center gap-1.5 flex-shrink-0">
        <button
          type="button"
          onClick={doBackup}
          disabled={backupBusy}
          title="ڈیٹا کا بیک اپ منتخب فولڈر میں محفوظ کریں"
          className="self-center flex items-center gap-1.5 px-4 h-[26px] rounded-md bg-purple-600 text-white text-[12px] font-bold urdu shadow-sm hover:bg-purple-700 active:bg-purple-800 disabled:opacity-60 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-purple-400 transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M20 16.6A5 5 0 0 0 18 7h-1.26A8 8 0 1 0 4 15.25" />
            <path d="M12 12v9" />
            <path d="m16 16-4-4-4 4" />
          </svg>
          {backupBusy ? 'محفوظ ہو رہا ہے…' : 'بیک اپ'}
        </button>
        {backupMsg ? (
          <span className={`urdu text-[10px] whitespace-nowrap ${backupMsg.ok ? 'text-emerald-700' : 'text-red-600'}`}>
            {backupMsg.text}
          </span>
        ) : backupOverdue ? (
          <span className="urdu text-[10px] text-red-600 whitespace-nowrap" title="سات دن سے بیک اپ نہیں ہوا">
            ! بیک اپ کریں
          </span>
        ) : null}
      </div>

      <div className="flex-1" />

      {/* بقایا سودا notifications — FIRST item of the left cluster (right AFTER the
          flex-1 spacer). In this dir="rtl" bar that lands it at the RIGHT edge of
          the رسید نکالیں cluster, in the open space beside رسید نمبر — not cramped
          between the buttons. Opens ONLY on click; the red badge hides at zero. */}
      <SodaBell />

      {/* receipt search on the LEFT (replaces the old 1..U buttons) */}
      <div className="flex items-center gap-1.5">
        <input
          className="self-center h-[26px] w-[120px] px-3 rounded-md border border-gray-300 bg-white text-[13px] font-semibold text-center outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
          inputMode="numeric"
          dir="ltr"
          placeholder="رسید نمبر"
          title="رسید نمبر لکھ کر Enter دبائیں — type a receipt no. and press Enter"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') doSearch() }}
        />
        {searchMsg && <span className="urdu text-[10px] text-red-600 whitespace-nowrap px-1">{searchMsg}</span>}
      </div>
      <button
        type="button"
        onClick={resetEntry}
        className="self-center flex items-center px-4 h-[26px] rounded-md bg-emerald-600 text-white text-[12px] font-bold urdu shadow-sm hover:bg-emerald-700 active:bg-emerald-800 focus:outline-none focus:ring-2 focus:ring-emerald-400 transition-colors"
      >
        رسید نکالیں
      </button>
      {/* اندراج — manual bottom-bar کیش / تیزابی balance adjustment */}
      <button
        type="button"
        title="دستی اندراج (کیش / تیزابی)"
        onClick={() => setShowIndraj(true)}
        className="self-center flex items-center px-4 h-[26px] rounded-md bg-amber-600 text-white text-[12px] font-bold urdu shadow-sm hover:bg-amber-700 active:bg-amber-800 focus:outline-none focus:ring-2 focus:ring-amber-400 transition-colors"
      >
        اندراج
      </button>
      <button
        type="button"
        title="ڈیفالٹ سیٹنگز"
        onClick={() => setShowDefaults(true)}
        className="self-center flex items-center gap-1.5 px-3 h-[26px] rounded-md bg-blue-600 text-white text-[12px] font-bold shadow-sm hover:bg-blue-700 active:bg-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-400 transition-colors"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
        </svg>
        Defaults
      </button>

      <GoldTicker />

      <DefaultsForm open={showDefaults} onClose={() => setShowDefaults(false)} />
      <IndrajForm open={showIndraj} onClose={() => setShowIndraj(false)} />

    </div>
  )
}
