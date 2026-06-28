// ============================================================================
//  PURITY / ASSAY CALCULATION ENGINE   (THE ONE FILE TO REPLACE)
// ============================================================================
//
//  This is the single source of truth for the left-hand purity table:
//     Local | Copper | Standard | Silver | Pure Silver
//
//  The user accepted "standard gold-assay rules" as a best-guess model.
//  Every number on the main screen is derived here. If your shop's real
//  method differs, you ONLY need to edit this file — the UI, receipts and
//  database stay exactly the same.
//
//  INPUTS the operator types (per the screenshot, top-left box):
//     wazan   = وزن کنڈے پر (گرام)  -> gross weight on the scale, in grams
//     malawat = وزن پانی میں / assay -> alloy/impurity content from the acid
//                                        (تیزاب) test, in grams
//
//  Each table row has columns (RTL order in the UI, plain order here):
//     khalisPerGram (خالص سونا فی گرام)  pure-gold fineness per gram (0..1)
//     malawatPerGram (ملاوٹ فی گرام)     alloy fraction per gram (0..1)
//     tola / masha / ratti               weight broken into TMR units
//     rate (سونا ریٹ)                     per-gram rate applied to this row
//     totalRaqam (ٹوٹل رقم)              gross amount = khalisGrams * rate
//     labCharges (لیب چارجز)             lab fee for this row
//     baqiRaqam (باقی رقم)               net = totalRaqam - labCharges
//     parchi (پرچی)                      checkbox -> generates receipts
//
// ----------------------------------------------------------------------------
//  ROW MODEL — best-guess fineness factors. REPLACE WITH YOUR REAL VALUES.
//  `fineness` = fraction of the row that is recoverable pure gold (or silver).
// ----------------------------------------------------------------------------

import { gramsToTMR, round } from './units.js'

export const ROW_KEYS = ['Local', 'Copper', 'Standard', 'Silver', 'PureSilver']

export const ROW_LABELS = {
  Local: 'Local',
  Copper: 'Copper',
  Standard: 'Standard',
  Silver: 'Silver',
  PureSilver: 'Pure Silver'
}

// Default assay coefficients (PLACEHOLDER — swap for real shop values).
//   finenessOfPure: how much of the *pure* assay content this row carries.
//   metal: which rate to use ('gold' or 'silver').
export const ROW_MODEL = {
  Local: { metal: 'gold', label: 'Local', defaultFineness: 0.875 },
  Copper: { metal: 'gold', label: 'Copper', defaultFineness: 0.0 },
  Standard: { metal: 'gold', label: 'Standard', defaultFineness: 0.916 },
  Silver: { metal: 'silver', label: 'Silver', defaultFineness: 0.5 },
  PureSilver: { metal: 'silver', label: 'Pure Silver', defaultFineness: 0.999 }
}

// Silver is typically priced as a fraction of the gold rate. Adjust freely.
const SILVER_RATE_FACTOR = 0.012

/**
 * Compute one purity row from the raw inputs + current rates.
 *
 * @param {string} key            one of ROW_KEYS
 * @param {object} input          { wazan, malawat }  grams
 * @param {object} rates          settings row from DB
 * @param {object} overrides      per-cell manual overrides for THIS row
 *                                e.g. { khalisSona: 12.5, labCharges: 200 }
 */
export function computeRow(key, input, rates, overrides = {}) {
  const model = ROW_MODEL[key]
  const wazan = num(input.wazan)
  const malawat = num(input.malawat)

  // Pure assay content from the acid test = wazan - malawat (alloy removed).
  const assayPure = Math.max(0, wazan - malawat)

  // This row's share of the recoverable pure metal.
  const fineness = has(overrides.fineness)
    ? num(overrides.fineness)
    : model.defaultFineness

  // خالص سونا (pure metal grams attributed to this row)
  const khalisSona = has(overrides.khalisSona)
    ? num(overrides.khalisSona)
    : round(assayPure * fineness, 3)

  // ملاوٹ (alloy grams) — what's left of this row's gross after pure removed.
  const grossForRow = wazan * (assayPure === 0 ? 0 : 1) // gross attributed
  const malawatGrams = has(overrides.malawat)
    ? num(overrides.malawat)
    : round(Math.max(0, grossForRow - khalisSona), 3)

  // خالص سونا فی گرام / ملاوٹ فی گرام (per-gram fineness display values)
  const khalisPerGram = wazan ? round(khalisSona / wazan, 4) : 0
  const malawatPerGram = wazan ? round(malawatGrams / wazan, 4) : 0

  // Weight broken into tola / masha / ratti (based on khalis content).
  const tmr = has(overrides.tola)
    ? { tola: num(overrides.tola), masha: num(overrides.masha), ratti: num(overrides.ratti) }
    : gramsToTMR(khalisSona)

  // Rate per gram for this row's metal.
  const goldRatePerGram = num(rates.rate_tezabi_gram) // 772
  const rate = has(overrides.rate)
    ? num(overrides.rate)
    : model.metal === 'silver'
      ? round(goldRatePerGram * SILVER_RATE_FACTOR, 2)
      : goldRatePerGram

  // ٹوٹل رقم = pure grams * rate
  const totalRaqam = has(overrides.totalRaqam)
    ? num(overrides.totalRaqam)
    : round(khalisSona * rate, 0)

  // لیب چارجز = per-gram lab fee (فی گرام چار جز) applied to gross weight.
  const labCharges = has(overrides.labCharges)
    ? num(overrides.labCharges)
    : round(wazan * num(rates.fc_per_gram), 0)

  // باقی رقم = total - lab charges
  const baqiRaqam = has(overrides.baqiRaqam)
    ? num(overrides.baqiRaqam)
    : round(totalRaqam - labCharges, 0)

  return {
    key,
    label: model.label,
    metal: model.metal,
    khalisPerGram,
    malawatPerGram,
    khalisSona,
    malawat: malawatGrams,
    tola: tmr.tola,
    masha: tmr.masha,
    ratti: tmr.ratti,
    rate,
    totalRaqam,
    labCharges,
    baqiRaqam,
    parchi: !!overrides.parchi
  }
}

/**
 * Compute the whole table.
 * @param {object} input      { wazan, malawat }
 * @param {object} rates      settings
 * @param {object} overrideMap { Local: {...}, Standard: {...}, ... }
 */
export function computeTable(input, rates, overrideMap = {}) {
  return ROW_KEYS.map((k) => computeRow(k, input, rates, overrideMap[k] || {}))
}

/** Build the lab + recovery receipt figures for a selected (parchi) row. */
export function buildLabReceipt(row, input, rates) {
  const ratePerTola = num(rates.rate_tezabi_tola)
  return {
    aamadWazan: num(input.wazan), // آمدوزن
    malawatWazan: row.malawat, // ملاوٹ وزن
    khalisWazan: row.khalisSona, // خالص وزن
    malawatPerGram: row.malawatPerGram, // ملاوٹ فی گرام
    keerat: row.khalisPerGram ? round(row.khalisPerGram * 24, 2) : 0, // کیرٹ
    ratePerTola,
    parchiCharges: num(rates.parchi_charges),
    charges: row.labCharges,
    totalRaqam: row.totalRaqam,
    baqi: row.baqiRaqam
  }
}

function num(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
function has(v) {
  return v !== undefined && v !== null && v !== ''
}
