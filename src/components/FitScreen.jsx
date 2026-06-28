import React, { useEffect, useState } from 'react'

// Renders children inside a fixed design canvas (default 1460×820) and scales
// the whole thing to fit the current viewport. Guarantees the UI always fits
// one screen with no scrolling, independent of monitor size or Windows DPI
// scaling (which shrinks the CSS viewport).
export default function FitScreen({ w = 1460, h = 820, children }) {
  const [scale, setScale] = useState(1)
  useEffect(() => {
    const fit = () => setScale(Math.min(window.innerWidth / w, window.innerHeight / h))
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [w, h])

  // Scale toward the top-left corner so the right/bottom edges always pull
  // inward and can never overflow the viewport.
  return (
    <div className="w-full h-full overflow-hidden bg-panel">
      <div
        style={{
          width: w,
          height: h,
          transform: `scale(${scale})`,
          transformOrigin: 'top left'
        }}
      >
        {children}
      </div>
    </div>
  )
}
