import React, { useEffect } from 'react'
import { useApp } from './state/store.jsx'
import MainScreen from './screens/MainScreen.jsx'
import Daybook from './screens/Daybook.jsx'
import Udhar from './screens/Udhar.jsx'
import UdharForm from './components/UdharForm.jsx'
import AkhrajatForm from './components/AkhrajatForm.jsx'
import HisabForm from './components/HisabForm.jsx'
import { applyTheme, THEME_FIELDS } from './logic/theme.js'

export default function App() {
  const { screen, udharOpen, closeUdhar, akhrajatOpen, closeAkhrajat, hisabOpen, closeHisab, rates } = useApp()
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
