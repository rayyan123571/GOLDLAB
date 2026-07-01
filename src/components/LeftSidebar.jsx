import React from 'react'
import { useApp } from '../state/store.jsx'
import { GRAMS_PER_TOLA, fmtNum, fmtMoney } from '../logic/units.js'

// Far-left vertical strip attached to the وصولی رسید. Each item is two stacked
// cells: a grey label cell on top and a value cell below. The green cells are
// کیش دیا (computed) and سونا دیا (editable); the rest are white. Two items
// (پرچوں لیا، اجرت کا سونا) carry an inline checkbox in their grey label cell,
// wired to app state. سونا دیا is the editable grams input; کیش دیا shows the
// PKR value of the leftover gold not handed over.
const ITEMS = [
  { key: 'parchunLiya', label: 'پرچوں لیا', check: true, flag: 'parchunLiya' },
  { key: 'kulUjrat', label: 'کل اجرت لینی ہے' },
  { key: 'ujratKaSona', label: 'اجرت کا سونا', check: true, flag: 'ujratKaSona' },
  { key: 'ujratKiRaqam', label: 'اجرت کی رقم' },
  { key: 'sonaDena', label: 'سونا دینا ہے' },
  { key: 'cashDiya', label: 'کیش دیا', green: true },
  { key: 'sonaDiya', label: 'سونا دیا', green: true, edit: true }
]

export default function LeftSidebar() {
  const {
    computedRows, input,
    ujratKaSona, toggleUjratKaSona,
    parchunLiya, toggleParchunLiya,
    sonaDiya, setSonaDiya
  } = useApp()

  const flags = { ujratKaSona, parchunLiya }
  const toggles = { ujratKaSona: toggleUjratKaSona, parchunLiya: toggleParchunLiya }

  // Selected row = the parchi-checked one, else Standard (index 2), like Receipts.jsx.
  const selected = computedRows.find((r) => r.parchi) || computedRows[2]
  // Per-gram gold rate = per-tola rate / 11.664. Guard against divide-by-zero.
  const ratePerGram = selected ? selected.rate / GRAMS_PER_TOLA : 0
  // Labour charges of the selected row converted into gold grams.
  const ujratGold = ratePerGram > 0 ? selected.labCharges / ratePerGram : 0
  // Gold actually owed (سونا دینا ہے) — when labour is taken as gold it comes off
  // the pure gold. The operator types how much gold they hand over (سونا دیا);
  // کیش دیا shows the cash value of whatever gold is still owed after that.
  const goldOwed = selected
    ? (ujratKaSona ? selected.khalisSona - ujratGold : selected.khalisSona)
    : 0
  const goldGiven = Number(sonaDiya) || 0
  const leftoverGold = Math.max(0, goldOwed - goldGiven)

  // Compute the value shown under each grey label.
  const valueFor = (key) => {
    if (!selected) return '-'
    switch (key) {
      case 'parchunLiya':
        return parchunLiya ? fmtNum(input.wazan) : '-'
      case 'kulUjrat':
        return fmtMoney(selected.labCharges)
      case 'ujratKaSona':
        return ujratKaSona ? (ratePerGram > 0 ? fmtNum(ujratGold) : '-') : '-'
      case 'ujratKiRaqam':
        return ujratKaSona ? '-' : fmtMoney(selected.labCharges)
      case 'sonaDena':
        if (ratePerGram <= 0) return '-'
        return fmtNum(goldOwed)
      case 'cashDiya': {
        // Cash value of the leftover gold not handed over: the less gold given,
        // the more leftover, the higher the cash. Give it all -> '-'.
        if (ratePerGram <= 0) return '-'
        const cashForLeftover = leftoverGold * ratePerGram
        return cashForLeftover > 0 ? fmtMoney(cashForLeftover) : '-'
      }
      default:
        return '-' // اجرت وصول کی and any unlisted item: plain placeholder.
    }
  }

  return (
    <div dir="rtl" className="flex flex-col border border-line bg-panel" style={{ width: '92px' }}>
      {ITEMS.map((it, i) => (
        <React.Fragment key={i}>
          {/* label cell (grey) — checkbox items show a bold/larger label + a box on one line */}
          <div className="flex-1 flex items-center justify-center gap-[2px] border-b border-line bg-header px-[2px]" style={{ maxHeight: 30 }}>
            <span className="urdu leading-tight text-center text-[11px] font-bold">{it.label}</span>
            {it.check && (
              <input
                type="checkbox"
                className="accent-blue-600 w-4 h-4"
                checked={flags[it.flag]}
                onChange={toggles[it.flag]}
              />
            )}
          </div>
          {/* value cell (white, or green for highlighted rows) */}
          <div className={`flex-1 flex items-center justify-center border-b border-line ${it.green ? 'bg-mint' : 'bg-white'}`} style={{ maxHeight: 30 }}>
            {it.edit ? (
              <input
                className="w-full h-full bg-transparent text-center text-[13px] font-bold cursor-text outline-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white"
                placeholder="-"
                inputMode="decimal"
                value={sonaDiya}
                onChange={(e) => setSonaDiya(e.target.value)}
              />
            ) : (
              <input
                className="w-full h-full bg-transparent text-center text-[13px] font-bold outline-none"
                placeholder="-"
                value={valueFor(it.key)}
                readOnly
              />
            )}
          </div>
        </React.Fragment>
      ))}
    </div>
  )
}
