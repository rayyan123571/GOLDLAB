import React from 'react'

// Far-left vertical strip attached to the وصولی رسید. Each item is two stacked
// cells: a grey label cell on top and a value cell below. Three value cells are
// green (اجرت وصول کی، کیش دیا، سونا دیا); the rest are white. No checkboxes.
const ITEMS = [
  { label: 'پرچوں لیا' },
  { label: 'کل اجرت لینی ہے' },
  { label: 'اجرت کا سونا' },
  { label: 'اجرت کی رقم' },
  { label: 'اجرت وصول کی', green: true },
  { label: 'ڈسکاؤنٹ' },
  { label: 'سونا دینا ہے' },
  { label: 'کیش دیا', green: true },
  { label: 'سونا دیا', green: true }
]

export default function LeftSidebar() {
  return (
    <div dir="rtl" className="flex flex-col border border-line bg-panel" style={{ width: '92px' }}>
      {ITEMS.map((it, i) => (
        <React.Fragment key={i}>
          {/* label cell (grey) */}
          <div className="flex-1 flex items-center justify-center border-b border-line bg-header px-[2px]" style={{ maxHeight: 30 }}>
            <span className="urdu text-[9px] leading-tight text-center">{it.label}</span>
          </div>
          {/* value cell (white, or green for highlighted rows) */}
          <div className={`flex-1 flex items-center justify-center border-b border-line ${it.green ? 'bg-mint' : 'bg-white'}`} style={{ maxHeight: 30 }}>
            <input
              className="w-full h-full bg-transparent text-center text-[10px] outline-none"
              placeholder="-"
            />
          </div>
        </React.Fragment>
      ))}
    </div>
  )
}