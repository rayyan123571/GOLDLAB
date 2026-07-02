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
  onKeyDown,
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
          onKeyDown={onKeyDown}
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
          onKeyDown={onKeyDown}
          placeholder={placeholder}
        />
      )}
    </div>
  )
}

export default function CustomerEntry() {
  const {
    customer, setCustomer, newCustomer, saveCustomer, saveParchi, newParchi, receiptNo, hasApi,
    gotoFirstReceipt, gotoLastReceipt, gotoNextReceipt, gotoPrevReceipt
  } = useApp()
  const [matches, setMatches] = useState([])
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1) // highlighted suggestion (keyboard)
  const [showForm, setShowForm] = useState(false)
  const [showList, setShowList] = useState(false)
  const [saveMsg, setSaveMsg] = useState(null) // { ok, text }
  const nameTimer = useRef(null)

  // Stage 2 — Save the current parchi (نقد + ادھار entries) to the DB. Name is
  // mandatory for a ledger save; with no entries at all, just save the customer.
  const onSave = async () => {
    const res = await saveParchi()
    if (res.ok && res.freed) {
      // STEP 2: the receipt number was freed and is now reusable for a new customer.
      setSaveMsg({ ok: true, text: `رسید ${res.receipt_no} فارغ ہو گئی — نئے کسٹمر کے لیے تیار` })
    } else if (res.ok) {
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

  // Parchi navigation (⏮ First · ◀ Previous · ▶ Next · ⏭ Last). Each runs the
  // shared loadReceipt flow, so the full parchi (header + entries) is restored.
  // A failed/edge nav shows a brief Urdu note instead of erroring.
  const navigate = (fn) => async () => {
    const res = await fn()
    if (res && !res.ok && res.message) {
      setSaveMsg({ ok: false, text: res.message })
      setTimeout(() => setSaveMsg(null), 2000)
    }
  }

  // Live name suggestions: query as the user types the name, debounced.
  const onNameChange = (e) => {
    const value = e.target.value
    if (nameTimer.current) clearTimeout(nameTimer.current)
    if (!value.trim()) {
      // Name cleared → FULLY de-select the customer (id, name, mobile, …), not
      // just the visible text. Otherwise the old customer.id lingers and the
      // receipt panels keep pulling that customer's ledger (سابقہ سونا/کیش). A
      // blank name must leave NO customer selected → no previous balances.
      newCustomer()
      setOpen(false)
      setMatches([])
      setActiveIndex(-1)
      return
    }
    setCustomer((c) => ({ ...c, name: value }))
    if (!hasApi) return
    nameTimer.current = setTimeout(async () => {
      const res = await window.api.findCustomers(value)
      setMatches(res || [])
      setActiveIndex(-1) // nothing highlighted until the user arrows down
      setOpen(true)
    }, 200)
  }

  // Pick a suggestion: FULL selection. findCustomers returns SELECT *, so `c`
  // already carries id/name/mobile/address/image — set it as the active customer
  // everywhere (same effect as picking from the customer list), then close.
  const pick = (c) => {
    setCustomer(c)
    setOpen(false)
    setMatches([])
    setActiveIndex(-1)
  }

  // Keyboard navigation over the suggestion dropdown: ↓/↑ highlight, Enter selects
  // the highlighted match (same full setCustomer as a click), Esc closes. Tab and
  // ArrowRight are consumed earlier by GhostNameInput for ghost-accept, so they
  // never reach here.
  const onNameKeyDown = (e) => {
    if (!open || matches.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => (i + 1) % matches.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => (i <= 0 ? matches.length - 1 : i - 1))
    } else if (e.key === 'Enter') {
      if (activeIndex >= 0 && activeIndex < matches.length) {
        e.preventDefault()
        pick(matches[activeIndex])
      }
    } else if (e.key === 'Escape') {
      setOpen(false)
      setActiveIndex(-1)
    }
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
          onBlur={() => setTimeout(() => { setOpen(false); setActiveIndex(-1) }, 150)}
          onKeyDown={onNameKeyDown}
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
        <button
          className="flex-1 flex items-center justify-center font-bold text-[14px] px-4 py-1.5 rounded-md border border-blue-300 bg-blue-100 text-blue-800 shadow-sm hover:bg-blue-200 hover:border-blue-400 active:bg-blue-300 active:translate-y-px focus:outline-none focus:ring-2 focus:ring-blue-400 transition-colors"
          onClick={onSave}
        >
          Save
        </button>
        <button className="btn font-bold w-6" title="پہلی رسید — First" onClick={navigate(gotoFirstReceipt)}>⏮</button>
        <button className="btn text-redX font-bold w-6" title="پچھلی رسید — Previous" onClick={navigate(gotoPrevReceipt)}>◀</button>
        <button className="btn text-redX font-bold w-6" title="اگلی رسید — Next" onClick={navigate(gotoNextReceipt)}>▶</button>
        <button className="btn font-bold w-6" title="آخری رسید — Last" onClick={navigate(gotoLastReceipt)}>⏭</button>
      </div>

      {saveMsg && (
        <div className={`urdu text-[11px] mt-1 px-2 py-1 rounded ${saveMsg.ok ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
          {saveMsg.text}
        </div>
      )}

      {open && matches.length > 0 && (
        <div className="absolute z-20 top-full right-0 left-0 bg-white border border-line max-h-40 overflow-auto shadow-lg">
          {matches.map((m, i) => (
            <div
              key={m.id}
              className={`px-2 py-1 cursor-pointer border-b border-gray-200 text-[11px] ${i === activeIndex ? 'bg-mint' : 'hover:bg-mint'}`}
              // onMouseDown (not onClick) + preventDefault: fires before the input's
              // blur and stops it, so the selection always registers — no blur race.
              onMouseDown={(e) => { e.preventDefault(); pick(m) }}
              onMouseEnter={() => setActiveIndex(i)}
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
