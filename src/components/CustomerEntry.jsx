import React, { useRef, useState } from 'react'
import { useApp } from '../state/store.jsx'
import CustomerForm from './CustomerForm.jsx'
import CustomerListModal from './CustomerListModal.jsx'
import GhostNameInput from './GhostNameInput.jsx'

// Editable combo box: a green text field with a ▼ dropdown button on the side.
// With `ghost`, the input gets the same inline autocomplete as the customer form;
// the overlay is confined to the input area and never overlaps the ▼ button.
function Combo({
  value,
  onChange,
  onArrow,
  onBlur,
  placeholder,
  ghost,
  hasApi,
  inputClassName = 'inp-g border-l-0',
  arrowClassName = 'w-4 text-[8px]'
}) {
  return (
    <div className="relative flex-1 min-w-0 flex">
      <button
        type="button"
        onClick={onArrow}
        className={`flex items-center justify-center border border-sunken bg-[#dcdcdc] leading-none hover:bg-[#cfcfcf] active:bg-[#c2c2c2] transition-colors ${arrowClassName}`}
        title="فہرست"
      >
        ▼
      </button>
      {ghost ? (
        <GhostNameInput
          value={value}
          onChange={onChange}
          onBlur={onBlur}
          hasApi={hasApi}
          dir="auto"
          wrapperClassName="flex-1 min-w-0"
          inputClassName={inputClassName}
          placeholder={placeholder}
        />
      ) : (
        <input
          className={`${inputClassName} flex-1 min-w-0`}
          value={value}
          onChange={onChange}
          onBlur={onBlur}
          placeholder={placeholder}
        />
      )}
    </div>
  )
}

export default function CustomerEntry() {
  const { customer, setCustomer, newCustomer, saveCustomer, saveParchi, newParchi, receiptNo, hasApi } = useApp()
  const [matches, setMatches] = useState([])
  const [open, setOpen] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [showList, setShowList] = useState(false)
  const [saveMsg, setSaveMsg] = useState(null) // { ok, text }
  const nameTimer = useRef(null)

  // Stage 2 — Save the current parchi (نقد + ادھار entries) to the DB. Name is
  // mandatory for a ledger save; with no entries at all, just save the customer.
  const onSave = async () => {
    const res = await saveParchi()
    if (res.ok) {
      setSaveMsg({ ok: true, text: `محفوظ ✓ — پرچی نمبر ${res.receipt_no}` })
    } else if (res.message && res.message.startsWith('کوئی اندراج')) {
      // No cash/udhar entries — fall back to saving just the customer name.
      if (customer.name && customer.name.trim()) {
        await saveCustomer()
        setSaveMsg({ ok: true, text: 'کسٹمر محفوظ ✓' })
      } else {
        setSaveMsg({ ok: false, text: 'پہلے کسٹمر منتخب کریں / نام درج کریں' })
      }
    } else {
      setSaveMsg({ ok: false, text: res.message })
    }
    setTimeout(() => setSaveMsg(null), 2500)
  }

  // Stage 6 — New: blank parchi with the next incremented number + fresh customer.
  const onNew = () => {
    newParchi()
    newCustomer()
    setSaveMsg(null)
  }

  // Live name suggestions: query as the user types the name, debounced.
  const onNameChange = (e) => {
    const value = e.target.value
    setCustomer((c) => ({ ...c, name: value }))
    if (!hasApi) return
    if (nameTimer.current) clearTimeout(nameTimer.current)
    if (!value.trim()) {
      setOpen(false)
      setMatches([])
      return
    }
    nameTimer.current = setTimeout(async () => {
      const res = await window.api.findCustomers(value)
      setMatches(res || [])
      setOpen(true)
    }, 200)
  }

  // Pick a suggestion: load the FULL saved record (findCustomers returns SELECT *).
  const pick = (c) => {
    setCustomer(c)
    setOpen(false)
    setMatches([])
  }

  // Select from the grid: load the complete customer (incl. address/image) into
  // global state so the main page / receipts show them, then close the list.
  // Selecting must NOT open CustomerForm — same effect as picking a name suggestion.
  const openFromList = async (row) => {
    const full = (hasApi && (await window.api.getCustomer(row.id))) || row
    setCustomer(full)
    setShowList(false)
  }

  return (
    <div dir="rtl" className="border border-line bg-panel p-2 relative">
      {/* Name row — the primary customer selector. New (red) | نام | big combo | + .
          The ID and Mobile rows were removed from the main screen; that freed space
          goes to a larger, roomier name field + a prominent primary "+" action. */}
      <div className="flex items-stretch gap-1.5 mb-2">
        <button className="link-red w-12" onClick={onNew}>New</button>
        <div className="hdr urdu w-12 flex items-center justify-center">نام</div>
        <Combo
          value={customer.name}
          onChange={onNameChange}
          onArrow={() => setShowList(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="نام"
          ghost
          hasApi={hasApi}
          inputClassName="inp-g border-l-0 px-3 py-2 text-[18px] font-bold"
          arrowClassName="w-7 text-[12px]"
        />
        <button
          className="px-4 rounded-md bg-blue-600 text-white text-[24px] font-bold leading-none flex items-center justify-center shadow-sm hover:bg-blue-700 active:bg-blue-800 transition-colors"
          title="نیا اندراج"
          onClick={() => { newCustomer(); setShowForm(true) }}
        >
          +
        </button>
      </div>
      {/* Receipt no | Save | nav arrows */}
      <div className="flex items-stretch gap-1">
        <div className="hdr urdu w-16">رسید نمبر</div>
        <input className="inp w-16 text-center font-bold" value={receiptNo} readOnly />
        <button className="btn flex-1 font-bold" onClick={onSave}>Save</button>
        <button className="btn font-bold w-6">⏮</button>
        <button className="btn text-redX font-bold w-6">◀</button>
        <button className="btn text-redX font-bold w-6">▶</button>
        <button className="btn font-bold w-6">⏭</button>
      </div>

      {saveMsg && (
        <div className={`urdu text-[11px] mt-1 px-2 py-1 rounded ${saveMsg.ok ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
          {saveMsg.text}
        </div>
      )}

      {open && matches.length > 0 && (
        <div className="absolute z-20 top-full right-0 left-0 bg-white border border-line max-h-40 overflow-auto shadow-lg">
          {matches.map((m) => (
            <div
              key={m.id}
              className="px-2 py-1 hover:bg-mint cursor-pointer border-b border-gray-200 text-[11px]"
              onClick={() => pick(m)}
            >
              {m.name} {m.mobile ? `— ${m.mobile}` : ''} {m.id != null ? `— ${m.id}` : ''}
            </div>
          ))}
        </div>
      )}

      <CustomerForm open={showForm} onClose={() => setShowForm(false)} />
      <CustomerListModal open={showList} onClose={() => setShowList(false)} onSelect={openFromList} />
    </div>
  )
}
