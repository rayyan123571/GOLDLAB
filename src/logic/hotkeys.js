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
//   Ctrl+S       → Save   (the «Save» button's own handler)
//   Ctrl+N       → New    (the «New» button's own handler — fresh parchi)
//
// TWO KINDS OF SHORTCUT. Everything above Ctrl+S moves the CURSOR to a tagged
// field; Ctrl+S / Ctrl+N RUN AN ACTION instead. That difference decides one rule:
// the action pair fires even while focus is INSIDE an input, because the
// shopkeeper presses Ctrl+S right after filling a box. The "only outside a field"
// rule below belongs to the bare digits alone — it exists because typing 11.6640
// must not tick a purity row, and an Alt/Ctrl combo types nothing into a field.
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
// The default menu has no Ctrl+N and no Ctrl+S either (checked: nothing in
// electron/ registers a Menu, an accelerator, or a globalShortcut), so those two
// only have to beat CHROMIUM's built-ins — "save page" on Ctrl+S, "new window"
// on Ctrl+N. preventDefault() + stopPropagation() on both is what stops them.

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

// makeHotkeyHandler({ getScreen, toggleParchi, saveParchi, newParchi }) → the
// keydown listener. Injected getters keep this file free of React/store imports.
// saveParchi/newParchi are the store's triggers, which run the Save/New BUTTONS'
// own handlers — so a shortcut can never behave differently from its button, and
// a button that refuses to act (nothing to save, save already running) refuses
// for the shortcut too. No extra condition is applied here.
export function makeHotkeyHandler({ getScreen, toggleParchi, saveParchi, newParchi }) {
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

    // ── Ctrl+S / Ctrl+N — the two ACTION keys ────────────────────────────────
    // Deliberately BEFORE the blanket Ctrl bail-out below, and deliberately
    // without the `inField` test: these must work mid-typing. Plain Ctrl only —
    // Ctrl+Shift+S / Ctrl+Alt+N stay untouched. stopPropagation joins
    // preventDefault so neither Chromium's save-page nor its new-window fires.
    // e.repeat is dropped: holding the keys down must save/open exactly once.
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (key === 's' || key === 'n')) {
      e.preventDefault()
      e.stopPropagation()
      if (e.repeat) return
      if (key === 's') saveParchi()
      else newParchi()
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
