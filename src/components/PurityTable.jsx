import React from 'react'
import { useApp } from '../state/store.jsx'
import { fmtNum, fmtMoney } from '../logic/units.js'

// Column definitions in display order (left -> right). The پرچی checkbox is the
// last (right-most) column; checking a row selects it for the لیب رسید.
const COLS = [
  { key: 'label', label: '', field: 'label', kind: 'rowlabel' },
  { key: 'khalisPerGram', label: 'خالص سونا(گرام)', field: 'khalisPerGram', editable: true, dp: 4 },
  { key: 'malawatPerGram', label: 'ملاوٹ فی گرام', field: 'malawat', editable: true, dp: 3 },
  { key: 'tola', label: 'تولہ', field: 'tola', editable: true, dp: 0 },
  { key: 'masha', label: 'ماشہ', field: 'masha', editable: true, dp: 0 },
  { key: 'ratti', label: 'رتی', field: 'ratti', editable: true, dp: 2 },
  { key: 'rate', label: 'سوناریٹ', field: 'rate', editable: true, money: true },
  { key: 'totalRaqam', label: 'ٹوٹل رقم', field: 'totalRaqam', editable: true, money: true },
  { key: 'labCharges', label: 'لیب چارجز', field: 'labCharges', editable: true, money: true },
  { key: 'baqiRaqam', label: 'باقی رقم', field: 'baqiRaqam', editable: true, money: true },
  { key: 'parchi', label: 'پرچی', field: 'parchi', kind: 'check' }
]

const OVR_KEY = {
  khalisPerGram: 'fineness',
  malawat: 'malawat',
  tola: 'tola',
  masha: 'masha',
  ratti: 'ratti',
  rate: 'rate',
  totalRaqam: 'totalRaqam',
  labCharges: 'labCharges',
  baqiRaqam: 'baqiRaqam'
}

// ONE shared grid template for the header and every data row, so all columns
// line up perfectly. Using CSS grid (not flex) is what guarantees alignment —
// flex + <input> intrinsic widths is what caused the brick-wall misalignment.
const GRID = '96px 1.5fr 1.1fr 0.55fr 0.55fr 0.55fr 1fr 1fr 1fr 1fr 34px'

function Cell({ col, row }) {
  const { overrides, setCell, clearCell, toggleParchi } = useApp()
  const ovrKey = OVR_KEY[col.field]
  const rowOvr = overrides[row.key] || {}
  const isOverridden = ovrKey && rowOvr[ovrKey] !== undefined && rowOvr[ovrKey] !== ''

  if (col.kind === 'rowlabel') {
    return <div className="hdr justify-end pr-1 text-[11px] whitespace-nowrap min-w-0">{row.label}</div>
  }

  if (col.kind === 'check') {
    return (
      <div className="cell cell-c min-w-0">
        <input
          type="checkbox"
          checked={!!row.parchi}
          onChange={() => toggleParchi(row.key)}
        />
      </div>
    )
  }

  const display = col.money
    ? row[col.field] ? fmtMoney(row[col.field]) : '-'
    : fmtNum(row[col.field], col.dp ?? 3)

  if (!col.editable) {
    return <div className="cell cell-c min-w-0">{display}</div>
  }

  return (
    <input
      className={`cell cell-c editable text-center min-w-0 w-full ${isOverridden ? 'overridden' : ''}`}
      value={isOverridden ? rowOvr[ovrKey] : ''}
      placeholder={display}
      title="کلک کر کے اپنی قیمت لکھیں — Edit to override the formula"
      onChange={(e) => {
        const v = e.target.value
        if (v === '') clearCell(row.key, ovrKey)
        else setCell(row.key, ovrKey, v)
      }}
    />
  )
}

export default function PurityTable() {
  const { computedRows } = useApp()
  return (
    <div className="border border-line bg-white">
      {/* header — same grid template as the rows */}
      <div className="grid" style={{ gridTemplateColumns: GRID, height: 34 }}>
        <div className="hdr min-w-0"> </div>
        {COLS.slice(1).map((c) => (
          <div key={c.key} className="hdr urdu leading-[1.1] text-[10px] min-w-0">{c.label}</div>
        ))}
      </div>
      {/* rows */}
      {computedRows.map((row) => (
        <div key={row.key} className="grid" style={{ gridTemplateColumns: GRID, height: 26 }}>
          {COLS.map((c) => (
            <Cell key={c.key} col={c} row={row} />
          ))}
        </div>
      ))}
    </div>
  )
}
