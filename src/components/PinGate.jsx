import React, { useEffect, useRef, useState } from 'react'

// ٹوٹل پن — the login screen in front of TotalsPanel. It ONLY asks for / sets the
// pin; it never reads a total, a rate, or a receipt. All hashing and storage live
// in the main process (electron/pinGate.cjs + the two settings columns in
// db.cjs); this component just sends what was typed and reacts to ok/not-ok.
//
// The DEVELOPER RECOVERY CODE is deliberately NOT here — it sits at the top of
// electron/pinGate.cjs, out of the renderer bundle. It is entered through the
// "پن بھول گئے؟" field below and recognised by the main process, which then
// switches this screen to "set a new pin".
//
// SESSION UNLOCK. Module-level (not React state) so it survives every remount for
// the life of the window, and dies with it: unlock once, open ٹوٹل freely all
// session; on the next app start the gate is back. Nothing is persisted.
let sessionUnlocked = false
export const isUnlocked = () => sessionUnlocked
export const lockSession = () => { sessionUnlocked = false }

const hasApi = () => typeof window !== 'undefined' && window.api

// The pin is EXACTLY four digits — four cells, nothing more to type, nothing
// less accepted. Enforced at every point the UI can produce a pin: the cells
// take 0-9 only, and both submit paths below re-check the length.
const PIN_LEN = 4
const isFourDigits = (v) => new RegExp(`^\\d{${PIN_LEN}}$`).test(String(v || ''))

/* ── Four masked digit cells ───────────────────────────────────────────────────
 * value is the string typed so far (0–4 chars). The row itself is LTR on purpose
 * (see the dir="ltr" below): a pin fills LEFT to RIGHT like every banking app,
 * even though the card around it is RTL Urdu. Typing auto-advances, Backspace on
 * an empty cell steps back, and pasting four digits fills the row. `error` paints
 * them red and shakes them.
 */
function PinCells({ value, onChange, onComplete, error, autoFocus, label }) {
  const refs = useRef([])

  useEffect(() => {
    if (autoFocus && refs.current[0]) refs.current[0].focus()
  }, [autoFocus])

  // After a wrong pin the row is cleared — put the caret back on the first cell
  // so the next attempt is just typing, no clicking.
  useEffect(() => {
    if (value === '' && autoFocus && refs.current[0]) refs.current[0].focus()
  }, [value, autoFocus])

  // `value` is always a left-packed prefix ("12" = cells 1-2 filled), so writing
  // at cell i is a truncate-and-append — no holes to reason about.
  const setAt = (i, digit) => {
    const at = Math.min(i, value.length)
    const next = (value.slice(0, at) + digit).slice(0, PIN_LEN)
    onChange(next)
    const focusAt = Math.min(next.length, PIN_LEN - 1)
    if (refs.current[focusAt]) refs.current[focusAt].focus()
    if (next.length === PIN_LEN && onComplete) onComplete(next)
  }

  const onKeyDown = (i) => (e) => {
    if (e.key === 'Backspace') {
      e.preventDefault()
      // Filled cell → clear it; empty cell → clear the one before it.
      const cut = value[i] ? i : Math.max(0, Math.min(i, value.length) - 1)
      onChange(value.slice(0, cut))
      if (refs.current[cut]) refs.current[cut].focus()
    } else if (e.key === 'ArrowLeft' && refs.current[i - 1]) {
      refs.current[i - 1].focus()   // LTR row: left is the PREVIOUS cell
    } else if (e.key === 'ArrowRight' && refs.current[i + 1]) {
      refs.current[i + 1].focus()
    }
  }

  const onPaste = (e) => {
    const digits = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, PIN_LEN)
    if (!digits) return
    e.preventDefault()
    onChange(digits)
    const last = Math.min(digits.length, PIN_LEN - 1)
    if (refs.current[last]) refs.current[last].focus()
    if (digits.length === PIN_LEN && onComplete) onComplete(digits)
  }

  return (
    <div className="flex flex-col gap-1.5">
      {label && <span className="urdu text-[12px] font-semibold text-slate-500">{label}</span>}
      {/* dir="ltr": cell 0 is the LEFT-most box, so the first digit typed lands on
          the left and entry runs left → right. The label above and the card around
          it stay RTL. */}
      <div dir="ltr" className={`flex justify-center gap-2.5 ${error ? 'pin-shake' : ''}`}>
        {Array.from({ length: PIN_LEN }, (_, i) => (
          <input
            key={i}
            ref={(el) => { refs.current[i] = el }}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            maxLength={1}
            aria-label={`${i + 1}`}
            // The dot is what's PAINTED; the real digit lives in `value`. A
            // password input can't be centred as reliably across the four cells,
            // so the mask is drawn instead of relying on type="password".
            value={value[i] ? '●' : ''}
            onChange={(e) => {
              const d = e.target.value.replace(/\D/g, '').slice(-1)   // digits only
              if (d) setAt(i, d)
            }}
            onKeyDown={onKeyDown(i)}
            onPaste={onPaste}
            onFocus={(e) => e.target.select()}
            className={
              'w-[52px] h-[58px] rounded-xl border text-center text-[24px] leading-none font-bold ' +
              'bg-white outline-none transition-all duration-150 shadow-sm ' +
              (error
                ? 'border-red-500 text-red-600 bg-red-50 ring-2 ring-red-100'
                : 'border-slate-300 text-slate-800 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100')
            }
          />
        ))}
      </div>
    </div>
  )
}

// The pin is typed on the PHYSICAL keyboard — there is no on-screen keypad. The
// cells take digits, auto-advance, and Backspace walks back a box (see PinCells).

// view: 'enter'  — a pin exists, type it
//       'create' — no pin yet: pick one, twice
//       'current'— change flow: prove the current pin first
//       'new'    — set a new pin, twice (after create/recovery/current passes)
//
// mode 'unlock' starts at enter/create; mode 'change' starts at 'current'.
export default function PinGate({ open, mode = 'unlock', onUnlocked, onClose }) {
  const [view, setView] = useState('enter')
  const [pin, setPin] = useState('')
  const [pin2, setPin2] = useState('')
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [shake, setShake] = useState(false)
  const [row, setRow] = useState(1)          // which cell row holds the caret
  const [recovery, setRecovery] = useState('')     // the "پن بھول گئے؟" field
  const [showRecovery, setShowRecovery] = useState(false)
  // The code that ALREADY passed pinCheck (current pin or recovery code). Held
  // only in memory, only until pinSet is called, so the main process can
  // re-authorise the change; cleared whenever the gate opens or closes.
  const authRef = useRef('')

  // Fresh start every time it opens: nothing typed is kept around.
  useEffect(() => {
    if (!open) return
    setPin(''); setPin2(''); setErr(''); setMsg(''); setBusy(false)
    setRow(1); setRecovery(''); setShowRecovery(false); setShake(false)
    authRef.current = ''
    if (mode === 'change') { setView('current'); return }
    setView('enter')
    if (hasApi()) {
      window.api.pinStatus()
        .then((s) => setView(s && s.hasPin ? 'enter' : 'create'))
        .catch(() => setView('enter'))
    }
  }, [open, mode])

  if (!open) return null

  const twoRows = view === 'create' || view === 'new'

  // Wrong pin: shake + red for a beat, then wipe the cells so the next try is
  // just typing. Same error text as before.
  const rejectPin = (text) => {
    setErr(text)
    setShake(true)
    setTimeout(() => {
      setShake(false)
      setPin(''); setPin2(''); setRow(1)
    }, 450)
  }

  // Unlock (or, in the change flow, authorise) with a typed pin / recovery code.
  // `code` is passed explicitly so the auto-submit can use the value that just
  // completed the row rather than waiting for state to settle.
  const submitCheck = async (code, next) => {
    if (!hasApi() || busy) return
    const raw = String(code == null ? '' : code)
    // Only the recovery field may be non-numeric; a pin is ALWAYS four digits.
    if (next !== 'recovery' && !isFourDigits(raw)) { rejectPin('پن 4 ہندسوں کا ہونا چاہیے'); return }
    setBusy(true); setErr('')
    try {
      const res = await window.api.pinCheck(raw)
      if (res && res.recovery) {
        // Recovery code: never opens the panel by itself — it opens the reset.
        authRef.current = raw
        setPin(''); setPin2(''); setRow(1); setRecovery(''); setShowRecovery(false)
        setMsg('ریکوری کوڈ درست — نیا پن بنائیں'); setView('new')
        return
      }
      if (res && res.ok) {
        authRef.current = raw
        if (next === 'unlock') { sessionUnlocked = true; setPin(''); onUnlocked && onUnlocked() }
        else { setPin(''); setPin2(''); setRow(1); setMsg(''); setView('new') }
        return
      }
      if (next === 'recovery') setErr('غلط ریکوری کوڈ')
      else rejectPin('غلط پن')
    } catch {
      setErr('ناکام — دوبارہ کوشش کریں')
    } finally {
      setBusy(false)
    }
  }

  // Save a brand-new pin (first-time create, post-recovery reset, or change).
  const submitNew = async () => {
    if (!hasApi() || busy) return
    if (!isFourDigits(pin) || !isFourDigits(pin2)) { setErr('پن 4 ہندسوں کا ہونا چاہیے'); return }
    if (pin !== pin2) { rejectPin('دونوں پن ایک جیسے نہیں'); return }
    setBusy(true); setErr('')
    try {
      // `auth` is ignored by the main process when no pin exists yet; in the
      // change/recovery flows it is the code that was already accepted above.
      const res = await window.api.pinSet(pin, authRef.current)
      if (res && res.ok) {
        sessionUnlocked = true
        authRef.current = ''
        setPin(''); setPin2('')
        onUnlocked && onUnlocked()
      } else {
        setErr(res && res.error === 'invalid' ? 'پن 4 ہندسوں کا ہونا چاہیے' : 'اجازت نہیں — پرانا پن غلط ہے')
      }
    } catch {
      setErr('ناکام — دوبارہ کوشش کریں')
    } finally {
      setBusy(false)
    }
  }

  // A completed row: on the single-row views submit straight away (banking-app
  // feel); on the two-row views just hop to the confirm row.
  const onRowComplete = (which) => (val) => {
    if (twoRows) { if (which === 1) setRow(2); return }
    submitCheck(val, view === 'current' ? 'change' : 'unlock')
  }

  const title = view === 'create' ? 'نیا پن بنائیں'
    : view === 'new' ? 'نیا پن مقرر کریں'
      : view === 'current' ? 'پن تبدیل کریں' : 'پن درج کریں'

  const subtitle = view === 'create' ? 'پہلی بار — 4 ہندسوں کا پن بنائیں'
    : view === 'new' ? '4 ہندسوں کا نیا پن، تصدیق کے لیے دو بار'
      : view === 'current' ? 'جاری رکھنے کے لیے موجودہ پن درج کریں'
        : 'ٹوٹل دیکھنے کے لیے اپنا 4 ہندسوں کا پن درج کریں'

  const canSave = isFourDigits(pin) && pin === pin2

  return (
    <div
      className="fixed inset-0 z-[70] bg-slate-900/60 backdrop-blur-[2px] flex items-start justify-center p-4 pt-[10vh]"
      onClick={onClose}
    >
      {/* Shake keyframes — scoped to this component, injected with it. */}
      <style>{`
        @keyframes pinShake {
          0%,100% { transform: translateX(0) }
          20% { transform: translateX(-7px) }
          40% { transform: translateX(6px) }
          60% { transform: translateX(-4px) }
          80% { transform: translateX(3px) }
        }
        .pin-shake { animation: pinShake 420ms cubic-bezier(.36,.07,.19,.97) }
      `}</style>

      <div
        dir="rtl"
        className="relative w-[380px] max-w-[95vw] max-h-[86vh] overflow-y-auto rounded-2xl bg-white shadow-[0_24px_60px_-12px_rgba(15,23,42,0.45)] ring-1 ring-slate-900/10 flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header — deep slate band with a single lock mark. */}
        <div className="relative bg-gradient-to-b from-slate-800 to-slate-900 px-6 pt-6 pb-5 rounded-t-2xl text-center">
          <button
            type="button"
            onClick={onClose}
            title="بند کریں"
            className="absolute top-3 left-3 w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:bg-white/10 hover:text-white transition-colors"
          >
            ✕
          </button>
          <div className="mx-auto mb-3 w-11 h-11 rounded-full bg-white/10 ring-1 ring-white/15 flex items-center justify-center">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#e2e8f0" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <rect x="4" y="10" width="16" height="10" rx="2.5" />
              <path d="M8 10V7a4 4 0 0 1 8 0v3" />
            </svg>
          </div>
          <h2 className="urdu text-[18px] font-bold text-white leading-tight">{title}</h2>
          <p className="urdu mt-1 text-[12px] text-slate-300 leading-snug">{subtitle}</p>
        </div>

        {/* Body */}
        <div className="px-6 py-5 flex flex-col gap-4 bg-slate-50 rounded-b-2xl">
          <PinCells
            value={pin}
            onChange={(v) => { setErr(''); setPin(v) }}
            onComplete={onRowComplete(1)}
            error={shake}
            autoFocus={row === 1}
            label={twoRows ? 'نیا پن' : null}
          />

          {twoRows && (
            <PinCells
              value={pin2}
              onChange={(v) => { setErr(''); setPin2(v) }}
              onComplete={onRowComplete(2)}
              error={shake}
              autoFocus={row === 2}
              label="دوبارہ لکھیں"
            />
          )}

          {/* Messages sit in a fixed slot so the card never jumps in height. */}
          <div className="min-h-[18px] text-center">
            {err && <span className="urdu text-[13px] font-bold text-red-600">{err}</span>}
            {!err && msg && <span className="urdu text-[13px] font-bold text-emerald-700">{msg}</span>}
          </div>

          {twoRows && (
            <button
              type="button"
              disabled={busy || !canSave}
              onClick={submitNew}
              className={
                'urdu w-full h-[44px] rounded-xl text-[15px] font-bold text-white shadow-sm transition-colors ' +
                'bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 ' +
                'disabled:bg-slate-300 disabled:text-slate-500 disabled:cursor-not-allowed disabled:shadow-none'
              }
            >
              محفوظ کریں
            </button>
          )}

          {/* Forgot-pin → the recovery code (letters + digits, so it needs its own
              plain field; the digit cells only ever hold a 4-digit pin). */}
          {view === 'enter' && !showRecovery && (
            <button
              type="button"
              onClick={() => { setShowRecovery(true); setErr('') }}
              className="urdu mx-auto text-[12px] font-semibold text-slate-500 hover:text-indigo-600 underline underline-offset-2 transition-colors"
            >
              پن بھول گئے؟
            </button>
          )}

          {view === 'enter' && showRecovery && (
            <div className="flex flex-col gap-2 pt-1 border-t border-slate-200">
              <span className="urdu text-[12px] font-semibold text-slate-500 pt-2">ریکوری کوڈ درج کریں</span>
              <div className="flex gap-2">
                <input
                  dir="ltr"
                  type="password"
                  autoFocus
                  value={recovery}
                  onChange={(e) => { setErr(''); setRecovery(e.target.value) }}
                  onKeyDown={(e) => { if (e.key === 'Enter') submitCheck(recovery, 'recovery') }}
                  placeholder="Recovery code"
                  className="flex-1 h-[40px] px-3 rounded-xl border border-slate-300 bg-white text-[14px] text-slate-800 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 transition-all"
                />
                <button
                  type="button"
                  disabled={busy || !recovery}
                  onClick={() => submitCheck(recovery, 'recovery')}
                  className="urdu px-4 h-[40px] rounded-xl bg-slate-800 text-white text-[13px] font-bold hover:bg-slate-900 active:bg-black disabled:bg-slate-300 disabled:text-slate-500 transition-colors"
                >
                  تصدیق
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
