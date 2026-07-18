// Shared نیا سودا amount maths — the ONE owner of "what a سودا row is worth".
//
// ریٹ is per TOLA (the field is ریٹ تیزابی فی تولہ) but وزن is stored in GRAMS, so
// grams must be converted to tolas BEFORE multiplying. Multiplying a per-tola rate
// by a gram weight gives a figure 11.664× too large — it is not money at all.
// Keeping the formula in one file is what stops that bug coming back; the report
// and the حساب cash position both import from here. `GRAMS_PER_TOLA` is the single
// source of the 11.664 constant (never retype it).
import { GRAMS_PER_TOLA } from './units.js'

// Weight of one row in tolas (grams ÷ 11.664).
export const tolaOf = (r) => (Number(r.wazan) || 0) / GRAMS_PER_TOLA
// رقم for one row = ریٹ (per tola) × وزن (in tolas).
export const amountOf = (r) => (Number(r.rate) || 0) * tolaOf(r)
// Σ رقم over a row list.
export const sumAmount = (list) => list.reduce((s, r) => s + amountOf(r), 0)
// Σ tolas over a row list.
export const sumTola = (list) => list.reduce((s, r) => s + tolaOf(r), 0)
// Σ وزن (grams) over a row list — the metal side of what a سودا row is worth.
export const sumWazan = (list) => list.reduce((s, r) => s + (Number(r.wazan) || 0), 0)
