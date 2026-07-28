import React, { useEffect, useRef } from 'react'
import { useApp } from './state/store.jsx'
import { makeHotkeyHandler } from './logic/hotkeys.js'
import MainScreen from './screens/MainScreen.jsx'
import Daybook from './screens/Daybook.jsx'
import Udhar from './screens/Udhar.jsx'
import UdharForm from './components/UdharForm.jsx'
import AkhrajatForm from './components/AkhrajatForm.jsx'
import HisabForm from './components/HisabForm.jsx'
import { applyTheme, THEME_FIELDS } from './logic/theme.js'

export default function App() {
  const {
    screen, udharOpen, closeUdhar, akhrajatOpen, closeAkhrajat, hisabOpen, closeHisab, rates, toggleParchi,
    triggerSaveParchi, triggerNewParchi
  } = useApp()

  // Global keyboard shortcuts — ONE window-level listener; every key, target
  // field and guard (modals, number-key trap) lives in src/logic/hotkeys.js.
  // Installed once; refs feed it the CURRENT screen/toggleParchi so the listener
  // never has to be torn down and re-added on state changes.
  const screenRef = useRef(screen)
  screenRef.current = screen
  const toggleParchiRef = useRef(toggleParchi)
  toggleParchiRef.current = toggleParchi
  // Alt+S / Alt+N. Both triggers run the Save / New buttons' own handlers
  // (CustomerEntry registers them with the store), so shortcut and button are the
  // same action; with CustomerEntry unmounted they are no-ops.
  const saveParchiRef = useRef(triggerSaveParchi)
  saveParchiRef.current = triggerSaveParchi
  const newParchiRef = useRef(triggerNewParchi)
  newParchiRef.current = triggerNewParchi
  useEffect(() => {
    const onKeyDown = makeHotkeyHandler({
      getScreen: () => screenRef.current,
      toggleParchi: (rowKey) => toggleParchiRef.current(rowKey),
      saveParchi: () => saveParchiRef.current(),
      newParchi: () => newParchiRef.current()
    })
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
  // Apply the SAVED theme whenever it loads/changes (app start after the DB read,
  // and again after a save). This is also what reverts a live Defaults preview if
  // the dialog is closed without saving — the saved rates re-apply here. Unset
  // colours remove their variable, so the built-in hex fallback is used.
  useEffect(() => {
    applyTheme(rates)
    // Depend only on the theme fields so unrelated rate edits don't re-run it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, THEME_FIELDS.map((f) => (rates ? rates[f.key] : undefined)))
  return (
    <div className="h-screen w-screen overflow-hidden bg-panel">
      {screen === 'main' && <MainScreen />}
      {screen === 'daybook' && <Daybook />}
      {screen === 'udhar' && <Udhar />}
      {/* ادھار form + report — opened from the top "ادھار" tab, overlays any screen */}
      <UdharForm open={udharOpen} onClose={closeUdhar} />
      {/* اخراجات (expenses) form — opened from the top "اخراجات" tab */}
      <AkhrajatForm open={akhrajatOpen} onClose={closeAkhrajat} />
      {/* حساب — read-only cash-position panel, opened from the top "حساب" tab */}
      <HisabForm open={hisabOpen} onClose={closeHisab} />
    </div>
  )
}
