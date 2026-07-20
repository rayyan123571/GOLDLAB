// ─── Overlay defaults — the shop's CALIBRATED coordinate map, as code ────────
// Captured from the operator's running DB after they dragged every value into its
// cell on their pre-printed slip (215.9×139.7mm landscape, half-letter, 2-up). This
// is now the FALLBACK map (overlayForm.cjs) AND the fresh-install seed (db.cjs), so
// a brand-new install on ANY machine starts pre-aligned — no blank map, no dragging.
//
// Pure data, no deps, so BOTH db.cjs and overlayForm.cjs can require it and never
// drift. Existing installs keep their own DB values (saveRates COALESCE); only a
// fresh DB is seeded from here. x = value centre from the sheet's left edge (mm);
// y = value baseline from the top (mm). The RIGHT slip = these + right_dx / right_dy.
const DEFAULT_COORDS = {
  // آمد وزن row (decimal گرام.ملی گرام · تولہ · ماشہ · رتی)
  aamad_dec: { x: 27, y: 48.5 }, aamad_tola: { x: 48.5, y: 48.5 }, aamad_masha: { x: 62.5, y: 48.5 }, aamad_ratti: { x: 75.5, y: 48.5 },
  // ملاوٹ وزن row
  milawat_dec: { x: 27, y: 54 }, milawat_tola: { x: 49, y: 54.5 }, milawat_masha: { x: 63, y: 55 }, milawat_ratti: { x: 75.5, y: 55 },
  // خالص وزن row
  khalis_dec: { x: 27.5, y: 59.5 }, khalis_tola: { x: 48.5, y: 61.5 }, khalis_masha: { x: 61, y: 61.5 }, khalis_ratti: { x: 76.5, y: 61.5 },
  // ملاوٹ فی تولہ row (per-gram in the decimal column)
  mpt_dec: { x: 18, y: 69 }, mpt_tola: { x: 48.5, y: 68.5 }, mpt_masha: { x: 62, y: 68.5 }, mpt_ratti: { x: 77, y: 67.5 },
  // rate row
  rate: { x: 20, y: 77.5 }, keerat: { x: 75.5, y: 76.5 },
  // totals row
  baqaya: { x: 21, y: 84 }, charges: { x: 52.5, y: 85.5 }, total: { x: 88, y: 86 },
  // below totals + bottom row
  point: { x: 21.5, y: 90 },
  time: { x: 17.5, y: 104 }, date: { x: 44, y: 102.5 }, naam: { x: 79, y: 102.5 }
}

// Global geometry defaults (match the operator's DB + normalizeCfg fallbacks).
const DEFAULT_OFFSETS = {
  overlay_offx: 0, overlay_offy: 0, overlay_scalex: 1, overlay_scaley: 1,
  overlay_right_dx: 108, overlay_right_dy: 0, overlay_font_pt: 10
}

// Urdu display label per field — used by the calibration tool chips.
const FIELD_LABELS = {
  aamad_dec: 'آمد (گرام)', aamad_tola: 'آمد تولہ', aamad_masha: 'آمد ماشہ', aamad_ratti: 'آمد رتی',
  milawat_dec: 'ملاوٹ (گرام)', milawat_tola: 'ملاوٹ تولہ', milawat_masha: 'ملاوٹ ماشہ', milawat_ratti: 'ملاوٹ رتی',
  khalis_dec: 'خالص (گرام)', khalis_tola: 'خالص تولہ', khalis_masha: 'خالص ماشہ', khalis_ratti: 'خالص رتی',
  mpt_dec: 'ملاوٹ/تولہ (فی گرام)', mpt_tola: 'م/تولہ تولہ', mpt_masha: 'م/تولہ ماشہ', mpt_ratti: 'م/تولہ رتی',
  rate: 'ریٹ فی تولہ', keerat: 'کیرٹ',
  baqaya: 'بقایا رقم', charges: 'چارجز', total: 'ٹوٹل رقم',
  point: 'پوائنٹ', time: 'وقت', date: 'تاریخ', naam: 'نام'
}

module.exports = { DEFAULT_COORDS, DEFAULT_OFFSETS, FIELD_LABELS }
