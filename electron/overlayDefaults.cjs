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
  // below totals + bottom row. `point` is a HISTORICAL key name: the cell now
  // carries «سونا دینا ہے» (خالص سونا − اجرت کا سونا), not the پوائنٹ fraction —
  // see overlayForm.cjs fieldValues. The key must NOT be renamed or every shop's
  // calibrated settings.overlay_coords entry for this cell is orphaned.
  point: { x: 21.5, y: 90 },
  time: { x: 17.5, y: 104 }, date: { x: 44, y: 102.5 }, naam: { x: 79, y: 102.5 }
}

// Global geometry defaults (match the operator's DB + normalizeCfg fallbacks).
//
// font_pt was 10 and printed lighter than the reference slip the shop showed us;
// 11 plus the text stroke in overlayForm.cjs matches it. Still per-shop settable.
//
// landscape stays 0: the sheet is ALREADY described as a wide 215.9×139.7 page,
// so a landscape flag on top of that is a second rotation — which is how the
// values ended up sideways. rotate180 is the escape hatch for a slip loaded the
// other way round. engine 'pdf' = exact-size PDF spooled with scaling disabled
// (deterministic); 'driver' hands the page to the Windows driver, which is free
// to rescale it, and exists only as a fallback.
// The «بقایا رقم» outline box (overlay_box_*) is OFF by default: until a shop
// turns it on, the printed sheet is byte-for-byte what it was.
//
// overlay_box_y is the box's CENTRE, and that is NOT the same number as the
// field's y. A field's y is its BASELINE (the values hang from it, translate
// -100%), so باقیہ at y=84 actually paints 79.34 → 84; a box centred on 84 hangs
// ~2.3mm below the digits and crosses into «سونا دینا ہے». Measured on the real
// rendered sheet (npm run overlay:dryrun), the clear band between «ریٹ» (ends
// 77.5) and «سونا دینا ہے» (starts 85.34) is 7.84mm, so a 7mm square-cornered box
// centred at 81.4 sits in the middle of it with ~0.4mm to spare each side. That
// is also why 7mm is the ceiling: any taller and one edge touches a neighbour.
const DEFAULT_OFFSETS = {
  overlay_offx: 0, overlay_offy: 0, overlay_scalex: 1, overlay_scaley: 1,
  overlay_right_dx: 108, overlay_right_dy: 0, overlay_font_pt: 11,
  overlay_box_on: 0, overlay_box_x: 21, overlay_box_y: 81.4,
  overlay_box_w: 26, overlay_box_h: 7, overlay_box_pt: 0.3,
  overlay_landscape: 0, overlay_rotate180: 0, overlay_engine: 'pdf',
  // Spool orientation token, SEPARATE from overlay_landscape (which only rotates
  // the rendered page). 'auto' matches the printed page's real aspect; 'portrait'
  // / 'landscape' force it when a driver disagrees.
  overlay_print_orientation: 'auto'
}

// Urdu display label per field — used by the calibration tool chips.
const FIELD_LABELS = {
  aamad_dec: 'آمد (گرام)', aamad_tola: 'آمد تولہ', aamad_masha: 'آمد ماشہ', aamad_ratti: 'آمد رتی',
  milawat_dec: 'ملاوٹ (گرام)', milawat_tola: 'ملاوٹ تولہ', milawat_masha: 'ملاوٹ ماشہ', milawat_ratti: 'ملاوٹ رتی',
  khalis_dec: 'خالص (گرام)', khalis_tola: 'خالص تولہ', khalis_masha: 'خالص ماشہ', khalis_ratti: 'خالص رتی',
  mpt_dec: 'ملاوٹ/تولہ (فی گرام)', mpt_tola: 'م/تولہ تولہ', mpt_masha: 'م/تولہ ماشہ', mpt_ratti: 'م/تولہ رتی',
  rate: 'ریٹ فی تولہ', keerat: 'کیرٹ',
  baqaya: 'بقایا رقم', charges: 'چارجز', total: 'ٹوٹل رقم',
  // Label only — the drag chip must say what the operator now sees printed there.
  // The key stays `point` (calibration compatibility); the cell holds net gold.
  point: 'سونا دینا ہے', time: 'وقت', date: 'تاریخ', naam: 'نام'
}

module.exports = { DEFAULT_COORDS, DEFAULT_OFFSETS, FIELD_LABELS }
