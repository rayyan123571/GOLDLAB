// ─── Keyboard shortcuts — THE one place they are defined ─────────────────────
// A single window-level keydown handler (installed once in App.jsx) drives every
// shortcut; components only TAG their input with data-hotkey="<id>". Changing or
// adding a shortcut is an edit to this file, never a hunt across components.
//
//   Alt+I        → «وزن کنڈے پر» گرام box
//   F2           → «وزن پانی میں» گرام box
//   Alt+R        → نقد فروخت row's سونا وزن box   (Down/Up ↔ نقد خریدا)
//   Alt+U        → تیزابی دیا row's سونا وزن box  (Down/Up cycles the 4 ادھار rows)
//   Alt+1/2/3/4/6, or a BARE 1/2/3/4/6 outside any field
//                → پرچی tick: 1 Standard · 2 Silver · 3 Copper · 4 PureSilver · 6 Local
//
// THE NUMBER-KEY TRAP: the app is full of numeric inputs, so a bare digit is a
// shortcut ONLY when focus is not in an input/textarea/select/contenteditable —
// typing 11.6640 into a weight box must never tick a purity row. Alt+digit works
// everywhere (Alt+digit types nothing into a field, so nothing is stolen).
// General rule, applied to every key here: if a field needs the key, the field wins.
//
// Arrows: Down/Up move between fields ONLY while focus is on a field of one of
// the two groups below (circular — from the last, Down wraps to the first).
// Everywhere else the arrow keys keep their native behaviour untouched.
//
// The handler is SILENT whenever any modal/dialog is open: every overlay in the
// app (PinGate, DefaultsForm, UdharForm, AkhrajatForm, HisabForm, customer
// forms/list, TotalsPanel, confirm popups) renders a `fixed inset-0` backdrop,
// so one DOM probe covers them all — including future modals that follow the
// same pattern. Shortcuts also only run on the MAIN screen.
//
// Menu-accelerator note: main.cjs never calls Menu.setApplicationMenu, so the
// default Electron menu is in effect and all its accelerators are Ctrl-based
// (Ctrl+R, Ctrl+Shift+I, …) — Alt+I/R/U, F2 and Alt+digits collide with nothing.

// Field ids — the value of the data-hotkey attribute on the target <input>.
export const HK = {
  WAZAN_SCALE: 'wazan-scale', // WeightBox «وزن کنڈے پر» grams
  WAZAN_WATER: 'wazan-water', // WeightBox «وزن پانی میں» grams
  NAQD_SELL: 'naqd-sell', // نقد فروخت — سونا وزن
  NAQD_BUY: 'naqd-buy', // نقد خریدا — سونا وزن
  UDHAR_GIVE: 'udhar-give', // تیزابی دیا — سونا وزن
  UDHAR_TAKE: 'udhar-take', // تیزابی لیا — سونا وزن
  UDHAR_CASH_GIVE: 'udhar-cash-give', // ادھار کیش دیا — amount
  UDHAR_CASH_TAKE: 'udhar-cash-take' // ادھار کیش لیا — amount
}

// Down/Up groups, in SCREEN order (top → bottom), circular.
const ARROW_GROUPS = [
  [HK.NAQD_SELL, HK.NAQD_BUY],
  [HK.UDHAR_GIVE, HK.UDHAR_TAKE, HK.UDHAR_CASH_GIVE, HK.UDHAR_CASH_TAKE]
]

// Alt+<letter> / F2 → which field gets the cursor.
const FOCUS_KEYS = {
  'alt+i': HK.WAZAN_SCALE,
  f2: HK.WAZAN_WATER,
  'alt+r': HK.NAQD_SELL,
  'alt+u': HK.UDHAR_GIVE
}

// digit → purity row key for toggleParchi (PurityTable's پرچی checkbox).
const PARCHI_KEYS = { 1: 'Standard', 2: 'Silver', 3: 'Copper', 4: 'PureSilver', 6: 'Local' }

const focusHotkey = (id) => {
  const el = document.querySelector(`[data-hotkey="${id}"]`)
  if (!el) return
  el.focus()
  if (typeof el.select === 'function') el.select()
}

// makeHotkeyHandler({ getScreen, toggleParchi }) → the keydown listener.
// Injected getters keep this file free of React/store imports.
export function makeHotkeyHandler({ getScreen, toggleParchi }) {
  return (e) => {
    // Main screen only, and never while any modal overlay is up.
    if (getScreen() !== 'main') return
    if (document.querySelector('.fixed.inset-0')) return

    const t = e.target
    const inField = !!(t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable))
    const key = String(e.key || '').toLowerCase()

    // ── Down/Up inside a tagged group (and nowhere else) ─────────────────────
    if ((key === 'arrowdown' || key === 'arrowup') && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      const id = t && t.getAttribute ? t.getAttribute('data-hotkey') : null
      const group = id && ARROW_GROUPS.find((g) => g.includes(id))
      if (!group) return // native arrows everywhere else — untouched
      e.preventDefault()
      const i = group.indexOf(id)
      focusHotkey(group[(i + (key === 'arrowdown' ? 1 : group.length - 1)) % group.length])
      return
    }

    if (e.ctrlKey || e.metaKey) return // never shadow Ctrl/Cmd accelerators

    if (e.altKey) {
      const target = FOCUS_KEYS['alt+' + key]
      if (target) { e.preventDefault(); focusHotkey(target); return }
      if (PARCHI_KEYS[key] && !e.repeat) { e.preventDefault(); toggleParchi(PARCHI_KEYS[key]) }
      return
    }

    if (key === 'f2') { e.preventDefault(); focusHotkey(FOCUS_KEYS.f2); return }

    // Bare digit — ONLY outside every field (the number-key trap).
    if (PARCHI_KEYS[key] && !inField && !e.repeat) {
      e.preventDefault()
      toggleParchi(PARCHI_KEYS[key])
    }
  }
}
