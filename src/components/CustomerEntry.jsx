import React, { useState } from 'react'
import { useApp } from '../state/store.jsx'

// Editable combo box: a green text field with a ▼ dropdown button on the left.
function Combo({ value, onChange, onArrow, placeholder }) {
  return (
    <div className="relative flex-1 min-w-0 flex">
      <button
        type="button"
        onClick={onArrow}
        className="w-4 flex items-center justify-center border border-sunken bg-[#dcdcdc] text-[8px] leading-none"
        title="فہرست"
      >
        ▼
      </button>
      <input
        className="inp-g flex-1 min-w-0 border-l-0"
        value={value}
        onChange={onChange}
        placeholder={placeholder}
      />
    </div>
  )
}

export default function CustomerEntry() {
  const { customer, setCustomer, newCustomer, saveCustomer, receiptNo, hasApi } = useApp()
  const [matches, setMatches] = useState([])
  const [open, setOpen] = useState(false)

  const find = async () => {
    if (!hasApi) return
    const res = await window.api.findCustomers(customer.name || customer.mobile || '')
    setMatches(res)
    setOpen(true)
  }

  const pick = (c) => {
    setCustomer(c)
    setOpen(false)
  }

  return (
    <div dir="rtl" className="border border-line bg-panel p-1 relative">
      {/* Name row — New (red) | نام | combo | + */}
      <div className="flex items-stretch gap-1 mb-1">
        <button className="link-red w-12" onClick={newCustomer}>New</button>
        <div className="hdr urdu w-12">نام</div>
        <Combo
          value={customer.name}
          onChange={(e) => setCustomer((c) => ({ ...c, name: e.target.value }))}
          onArrow={find}
          placeholder="نام"
        />
        <button className="btn w-6" title="نیا اندراج" onClick={newCustomer}>+</button>
      </div>
      {/* Mobile row — Find (red) | موبائل | combo */}
      <div className="flex items-stretch gap-1 mb-1">
        <button className="link-red w-12" onClick={find}>Find</button>
        <div className="hdr urdu w-12">موبائل</div>
        <Combo
          value={customer.mobile}
          onChange={(e) => setCustomer((c) => ({ ...c, mobile: e.target.value }))}
          onArrow={find}
          placeholder="موبائل"
        />
      </div>
      {/* Receipt no | Save | nav arrows */}
      <div className="flex items-stretch gap-1">
        <div className="hdr urdu w-16">رسید نمبر</div>
        <input className="inp w-16 text-center font-bold" value={receiptNo} readOnly />
        <button className="btn flex-1 font-bold" onClick={saveCustomer}>Save</button>
        <button className="btn font-bold w-6">⏮</button>
        <button className="btn text-redX font-bold w-6">◀</button>
        <button className="btn text-redX font-bold w-6">▶</button>
        <button className="btn font-bold w-6">⏭</button>
      </div>

      {open && matches.length > 0 && (
        <div className="absolute z-20 top-full right-0 left-0 bg-white border border-line max-h-40 overflow-auto shadow-lg">
          {matches.map((m) => (
            <div
              key={m.id}
              className="px-2 py-1 hover:bg-mint cursor-pointer border-b border-gray-200 text-[11px]"
              onClick={() => pick(m)}
            >
              {m.name} {m.mobile ? `— ${m.mobile}` : ''}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
