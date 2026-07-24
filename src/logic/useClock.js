import { useState, useEffect } from 'react'

// Returns a Date that keeps the displayed clock live. It is polled every second,
// but the state is only REPLACED when the visible value actually changes — every
// consumer prints hours:minutes (fmtTime) and the date, never seconds. Returning
// the previous Date makes React bail out of the render entirely.
//
// This matters for speed: the four receipts each call this, and each one's تاریخ /
// وقت field feeds a shrink-to-fit measurement (Receipts.jsx FitValue). Ticking a
// new Date every second re-rendered all four receipt subtrees and re-ran those
// layout measurements 60× more often than the display could ever change, which is
// what made the whole screen feel heavy while navigating parchis.
export function useClock(intervalMs = 1000) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => {
      setNow((prev) => {
        const d = new Date()
        const same =
          d.getMinutes() === prev.getMinutes() &&
          d.getHours() === prev.getHours() &&
          d.getDate() === prev.getDate() &&
          d.getMonth() === prev.getMonth() &&
          d.getFullYear() === prev.getFullYear()
        return same ? prev : d
      })
    }, intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}
