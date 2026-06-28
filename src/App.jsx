import React from 'react'
import { useApp } from './state/store.jsx'
import MainScreen from './screens/MainScreen.jsx'
import Daybook from './screens/Daybook.jsx'
import Udhar from './screens/Udhar.jsx'

export default function App() {
  const { screen } = useApp()
  return (
    <div className="h-screen w-screen overflow-hidden bg-panel">
      {screen === 'main' && <MainScreen />}
      {screen === 'daybook' && <Daybook />}
      {screen === 'udhar' && <Udhar />}
    </div>
  )
}
