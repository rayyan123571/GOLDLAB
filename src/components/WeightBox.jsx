import React, { useRef, useState } from 'react'
import { useApp } from '../state/store.jsx'
import { gramsToTMR, tmrToGrams, round, fmtNum } from '../logic/units.js'
import { HK } from '../logic/hotkeys.js'

// Top-left scale-entry box. Column order (left -> right):
//   <row label> | (گرام) | تولہ | ماشہ | رتی
// `inputRef` lets the parent target this row's input; `onEnter` (if given) runs
// after the value is normalized when Enter is pressed (used to jump focus from
// the gross row to the water row). Without onEnter, Enter just blurs.
// `hotkey` tags the گرام input for the global shortcuts (src/logic/hotkeys.js):
// Alt+I lands in the gross row, F2 in the water row.
//
// BOTH directions are editable: grams -> tola/masha/ratti recomputes live (that
// is just gramsToTMR of the typed grams), and tola/masha/ratti -> grams runs
// through tmrToGrams. Neither conversion is written here — units.js owns both.
//
// The three TMR boxes are ONE group with ONE draft, which is what keeps two-way
// binding from eating half-typed digits: while the group has focus the boxes show
// the DRAFT and nothing recomputes them from grams, so typing "1" into تولہ can
// never be overwritten mid-keystroke.
//
// Because the draft owns the display, grams can be recalculated on EVERY
// keystroke — the operator sees the گرام box follow along as they type and never
// has to press Enter.
//
// WHICHEVER SIDE THE OPERATOR TYPED IN LAST IS THE TRUTH. رتی is displayed to 2
// decimals, so the boxes are a ROUNDED view of the real weight: 11.0000 g is
// 11 ماشہ 2.535 رتی, shown as 2.54. Rebuilding grams from that rounded view gives
// 11.0006 — the app overwriting a real weight with its own rounding. So the
// reverse calculation runs in exactly ONE place: an actual onChange on a TMR box
// (setTmrField). Never on focus, never on blur, never on Enter, never on a
// re-render. Entering grams and then clicking around cannot move the weight,
// because none of those paths can reach tmrToGrams.
function WeightRow({ label, grams, onGrams, inputRef, onEnter, hotkey }) {
  const tmr = gramsToTMR(grams)
  // null = not editing (boxes are derived from grams). An object = the operator is
  // inside the TMR group and these strings are what the boxes show.
  const [draft, setDraft] = useState(null)
  // Same value in a ref, because pressing Enter closes the draft and then MOVES
  // focus in the same tick: the group's blur fires before React re-renders, so a
  // state-only draft would still look open there.
  const draftRef = useRef(null)
  const putDraft = (d) => { draftRef.current = d; setDraft(d) }

  // Unfocused boxes keep the ORIGINAL display, dashes and all (fmtNum renders 0 as
  // '-'). The draft seeds those zeros as empty strings instead, so the box is blank
  // the moment the cursor lands in it and the operator can type straight away.
  const seedDraft = () => ({
    tola: tmr.tola ? String(round(tmr.tola, 0)) : '',
    masha: tmr.masha ? String(round(tmr.masha, 0)) : '',
    ratti: tmr.ratti ? String(round(tmr.ratti, 2)) : ''
  })

  const shown = {
    tola: draft ? draft.tola : fmtNum(tmr.tola, 0),
    masha: draft ? draft.masha : fmtNum(tmr.masha, 0),
    ratti: draft ? draft.ratti : fmtNum(tmr.ratti, 2)
  }

  // THE ONLY path from tola/masha/ratti back to grams — reached only by a real
  // keystroke in one of the three boxes. تولہ/ماشہ are whole numbers; رتی carries
  // the fraction, so it keeps the dot. An empty box counts as 0 (never NaN); all
  // three empty leaves grams alone.
  const setTmrField = (key, raw) => {
    const v = key === 'ratti' ? raw.replace(/[^\d.]/g, '') : raw.replace(/[^\d]/g, '')
    const d = { ...(draftRef.current || seedDraft()), [key]: v }
    putDraft(d)
    if (!d.tola.trim() && !d.masha.trim() && !d.ratti.trim()) return
    const n = (x) => { const y = Number(x); return Number.isFinite(y) ? y : 0 }
    onGrams(tmrToGrams({ tola: n(d.tola), masha: n(d.masha), ratti: n(d.ratti) }).toFixed(4))
  }

  // Leaving the group / Enter closes the draft and NOTHING ELSE — no arithmetic
  // here on purpose (see the note above). grams is already current from the
  // keystrokes, and a visit with no typing must leave the weight exactly as it was.
  const closeDraft = () => { putDraft(null) }

  // Focus moving BETWEEN the three boxes stays inside the group, so the draft (and
  // the operator's half-typed digits) survives; leaving it restores the derived
  // display, dashes included.
  const onGroupBlur = (e) => {
    if (!e.currentTarget.contains(e.relatedTarget)) closeDraft()
  }
  // Normalize the typed weight to exactly 4 decimals on Enter / blur, e.g.
  // "50" -> "50.0000", "46" -> "46.0000", "11.664" -> "11.6640". Writing the
  // padded string back to state also re-triggers the live recompute of all 5
  // rows + both receipt panels. The numeric value stays full-precision.
  const normalize = (raw) => {
    const n = Number(raw)
    if (raw === '' || !Number.isFinite(n)) return
    onGrams(n.toFixed(4))
  }
  return (
    <div className="flex" dir="ltr">
      <div className="hdr urdu w-28 justify-end pr-1 text-[15px] font-bold">{label}</div>
      <input
        ref={inputRef}
        dir="ltr"
        data-hotkey={hotkey}
        className="inp text-center w-24 bg-mint font-bold text-[15px]"
        value={grams ?? ''}
        onChange={(e) => onGrams(e.target.value)}
        onBlur={(e) => normalize(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            normalize(e.target.value)
            if (onEnter) onEnter()
            else e.currentTarget.blur()
          }
        }}
        placeholder="0"
      />
      {/* The three TMR boxes as ONE focus group (see commitTmr). The wrapper adds
          no border, padding or margin, so the row looks exactly as it did. */}
      <div className="flex" onBlur={onGroupBlur}>
        {['tola', 'masha', 'ratti'].map((key) => (
          <input
            key={key}
            dir="ltr"
            className="cell cell-c w-12 font-bold text-[15px] text-center bg-transparent outline-none"
            value={shown[key]}
            onFocus={() => { if (!draftRef.current) putDraft(seedDraft()) }}
            onChange={(e) => setTmrField(key, e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return
              e.preventDefault()
              closeDraft()
              if (onEnter) onEnter()
              else e.currentTarget.blur()
            }}
          />
        ))}
      </div>
    </div>
  )
}

export default function WeightBox() {
  const { input, setWeight } = useApp()
  // Ref to the water-weight input so pressing Enter in the gross field can jump
  // focus straight to it (and select its contents for easy overwrite).
  const waterRef = useRef(null)
  return (
    <div dir="ltr" className="border border-line bg-white self-start">
      <div className="flex">
        <div className="hdr w-28"> </div>
        <div className="hdr urdu w-24 font-bold text-[14px]">(گرام)</div>
        <div className="hdr urdu w-12 font-bold text-[14px]">تولہ</div>
        <div className="hdr urdu w-12 font-bold text-[14px]">ماشہ</div>
        <div className="hdr urdu w-12 font-bold text-[14px]">رتی</div>
      </div>
      <WeightRow
        label="وزن کنڈے پر"
        grams={input.wazan}
        onGrams={(v) => setWeight('wazan', v)}
        hotkey={HK.WAZAN_SCALE}
        onEnter={() => {
          const el = waterRef.current
          if (el) { el.focus(); el.select() }
        }}
      />
      <WeightRow
        label="وزن پانی میں"
        grams={input.malawat}
        onGrams={(v) => setWeight('malawat', v)}
        inputRef={waterRef}
        hotkey={HK.WAZAN_WATER}
      />
    </div>
  )
}
