import React from 'react'
import { useApp } from './state/store.jsx'
import MainScreen from './screens/MainScreen.jsx'
import Daybook from './screens/Daybook.jsx'
import Udhar from './screens/Udhar.jsx'
import UdharForm from './components/UdharForm.jsx'
import AkhrajatForm from './components/AkhrajatForm.jsx'
import HisabForm from './components/HisabForm.jsx'

export default function App() {
  const { screen, udharOpen, closeUdhar, akhrajatOpen, closeAkhrajat, hisabOpen, closeHisab } = useApp()
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
