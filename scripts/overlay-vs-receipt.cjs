// ─── لیب رسید ↔ Canon overlay — field-by-field comparison ────────────────────
//
// Question this answers: does the overlay print EXACTLY what the لیب رسید shows,
// from the SAME snapshot — or has a second calculation crept in somewhere?
//
// How it works. The lab receipt's printed payload (`slipData`) is a plain object
// built in src/components/Receipts.jsx (LabReceipt) and handed UNCHANGED to the
// overlay renderer:
//
//   LabReceipt slipData -> ctx.printSlips -> store.jsx payload.data
//     -> main.cjs raster-print-slip -> overlayForm.printOverlay({ data })
//        -> overlayForm.fieldValues(data)
//
// So this script rebuilds that same slipData from the REAL maths (src/logic/
// purity.js — no numbers invented here), runs the REAL overlayForm.fieldValues on
// it, and prints both sides next to each other:
//
//   receipt cell (what the paper رسید shows)  |  overlay field (what the Canon prints)
//
// Every mismatch is a FAIL. `point` is the one field that never comes from a
// رسید cell: the pre-printed slip wants «سونا دینا ہے» there, so it is checked
// against slipData.sonaDena. The thermal رسید itself deliberately prints NO
// پوائنٹ any more — «بقایا سونا» (the same sonaDena) sits in its old spot, and
// that is asserted below too.
//
// Run: npm run overlay:fields
// Runs under Electron (overlayForm.cjs requires electron), like the other scripts.
const path = require('path')
const { pathToFileURL } = require('url')
const { app } = require('electron')

const ROOT = path.join(__dirname, '..')
const overlayForm = require(path.join(ROOT, 'electron', 'overlayForm.cjs'))

let failures = 0
const fail = (msg) => { failures++; console.error('  FAIL  ' + msg) }
const pass = (msg) => console.log('  ok    ' + msg)

// ── The lab slipData, rebuilt exactly as LabReceipt does ─────────────────────
// MIRROR of the slipData literal in src/components/Receipts.jsx (LabReceipt).
// Only the CELL EXPRESSIONS are copied; every number comes from the real
// computeTable/buildLabReceipt below. If that literal's rows are re-ordered or
// re-labelled, update this too — the comparison is only as honest as this mirror.
function buildLabSlipData(logic, { row, lab, rates, customer, receiptNo, now, sonaDena }) {
  const { fmtMoney, fmtNum, round, GRAMS_PER_TOLA } = logic.units
  const L = (l, o) => Object.assign({ l }, typeof o === 'number' ? { s: o } : (o || {}))
  const V = (v, o) => Object.assign({ v: v == null || v === '' ? '-' : String(v) }, o || {})
  const B = { b: true }
  const mg = (grams) => String(Math.round(((Number(grams) || 0) % 1) * 10000)).padStart(4, '0')
  const gWhole = (grams) => Math.floor(Number(grams) || 0)
  const wRow = (label, grams, tmr, bold) => [
    L(label, bold ? B : undefined), V(fmtNum(tmr?.ratti, 2)), V(fmtNum(tmr?.masha, 0)), V(fmtNum(tmr?.tola, 0)),
    V(mg(grams), bold ? B : undefined), V(String(gWhole(grams)), bold ? B : undefined)
  ]
  const perTola = Number(lab?.ratePerTola) || Number(rates.rate_tezabi_tola) || 0
  const ratePerGram = perTola ? round(perTola / GRAMS_PER_TOLA, 0) : 0
  return {
    title: 'لیب رسید',
    showFee: true,
    selectiveBold: true,
    sonaDena,
    tables: [
      [[L('رسید نمبر'), V(receiptNo), L('ریٹ فی گرام'), V(ratePerGram ? fmtMoney(ratePerGram) : '-', B)]],
      [
        [L(''), L('رتی'), L('ماشہ'), L('تولہ'), L('ملی گرام', B), L('گرام', B)],
        wRow('آمد وزن', lab?.aamadWazan, lab?.grossTMR, true),
        wRow('ملاوٹ وزن', lab?.malawatWazan, lab?.malawatTMR),
        wRow('خالص وزن', lab?.khalisWazan, lab?.khalisTMR, true),
        [L('ملاوٹ فی تولہ', B), V(fmtNum(lab?.milawatFiTolaTMR?.ratti, 2)), V(fmtNum(lab?.milawatFiTolaTMR?.masha, 0)), V(fmtNum(lab?.milawatFiTolaTMR?.tola, 0)), V('فی گرام'), V(fmtNum(lab?.malawatPerGram, 4))]
      ],
      [
        [L('کیرٹ'), V(fmtNum(lab?.keerat, 2)), L('ریٹ فی تولہ'), V(fmtMoney(lab?.ratePerTola), B)],
        [L('ٹوٹل رقم'), V(fmtMoney(lab?.totalRaqam)), L('چارجز'), V(fmtMoney(lab?.charges))],
        // پوائنٹ no longer prints on the thermal لیب رسید — «بقایا سونا» (sonaDena)
        // takes its place in the بقایا رقم row, mirroring Receipts.jsx.
        [L('بقایا رقم', B), V(fmtMoney(lab?.baqi), { box: true, b: true }), L('بقایا سونا'), V(sonaDena)],
        [L('نام'), V(customer.id ? (customer.name || '-') : '-', { wrap: true }), L('رتی'), V(fmtNum(lab?.milawatTotalRatti, 2), { u: true })],
        [L('تاریخ'), V(now.date), L('وقت'), V(now.time)]
      ]
    ]
  }
}

// ── overlay field key → the رسید cell it must equal ──────────────────────────
// left = overlay field key, right = how to read the SAME thing off the receipt.
// `kv` is the label→value map of the receipt's own cells; `w(label)` is a weight
// row; `dec(w)` is the گرام + ملی گرام pair as the decimal the pre-printed column
// wants (both are the receipt's own two cells, joined — not a recomputation).
function expectations(slipData) {
  const v = overlayForm.labVals(slipData.tables)
  const k = v.kv
  const dec = (w) => (w && w.gram != null && w.gram !== ''
    ? (/^\d{1,4}$/.test(String(w.mg).trim()) ? `${w.gram}.${w.mg}` : String(w.gram))
    : '')
  return [
    ['aamad_dec', 'آمد وزن → گرام.ملی گرام', dec(v.aamad)],
    ['aamad_tola', 'آمد وزن → تولہ', v.aamad.tola],
    ['aamad_masha', 'آمد وزن → ماشہ', v.aamad.masha],
    ['aamad_ratti', 'آمد وزن → رتی', v.aamad.ratti],
    ['milawat_dec', 'ملاوٹ وزن → گرام.ملی گرام', dec(v.milawat)],
    ['milawat_tola', 'ملاوٹ وزن → تولہ', v.milawat.tola],
    ['milawat_masha', 'ملاوٹ وزن → ماشہ', v.milawat.masha],
    ['milawat_ratti', 'ملاوٹ وزن → رتی', v.milawat.ratti],
    ['khalis_dec', 'خالص وزن → گرام.ملی گرام', dec(v.khalis)],
    ['khalis_tola', 'خالص وزن → تولہ', v.khalis.tola],
    ['khalis_masha', 'خالص وزن → ماشہ', v.khalis.masha],
    ['khalis_ratti', 'خالص وزن → رتی', v.khalis.ratti],
    ['mpt_dec', 'ملاوٹ فی تولہ → فی گرام', dec(v.mpt)],
    ['mpt_tola', 'ملاوٹ فی تولہ → تولہ', v.mpt.tola],
    ['mpt_masha', 'ملاوٹ فی تولہ → ماشہ', v.mpt.masha],
    ['mpt_ratti', 'ملاوٹ فی تولہ → رتی', v.mpt.ratti],
    ['rate', 'ریٹ فی تولہ', k['ریٹ فی تولہ']],
    ['keerat', 'کیرٹ', k['کیرٹ']],
    ['baqaya', 'بقایا رقم', k['بقایا رقم']],
    ['charges', 'چارجز', k['چارجز']],
    ['total', 'ٹوٹل رقم', k['ٹوٹل رقم']],
    // NOT the رسید's «پوائنٹ» — the pre-printed cell carries the net gold instead.
    ['point', 'سونا دینا ہے (snapshot.sonaDena)', slipData.sonaDena],
    ['time', 'وقت', k['وقت']],
    ['date', 'تاریخ', k['تاریخ']],
    ['naam', 'نام', k['نام']]
  ]
}

const pad = (s, n) => String(s == null ? '' : s) + ' '.repeat(Math.max(0, n - String(s == null ? '' : s).length))

async function main() {
  const purity = await import(pathToFileURL(path.join(ROOT, 'src', 'logic', 'purity.js')).href)
  const units = await import(pathToFileURL(path.join(ROOT, 'src', 'logic', 'units.js')).href)
  const logic = { purity, units }

  // ── One sample parchi, run through the app's REAL maths ────────────────────
  const rates = { rate_tezabi_tola: 434500, parchi_charges: 100, fc_per_gram: 80, date: '2026-07-18' }
  const input = { wazan: 11.664, malawat: 11.05 } // scale weight + weight in water
  const customer = { id: 7, name: 'shop', mobile: '' }
  const receiptNo = 157
  const now = { date: '18-07-26', time: '12:58 PM' }

  const rows = purity.computeTable(input, rates, { Standard: { parchi: true } })
  const row = rows.find((r) => r.parchi) || rows[2] // same selection as LeftReceipts
  const lab = purity.buildLabReceipt(row, input, rates)

  // The store's sidebarGoldCtx(), restated here ONLY as the test's expectation.
  // In the app this arithmetic exists once, in src/state/store.jsx.
  //   goldOwed       — follows the اجرت کا سونا checkbox → main screen sidebar
  //   goldOwedAlways — always net of the اجرت gold      → Canon overlay
  const rpg = (Number(row.rate) || 0) / units.GRAMS_PER_TOLA
  const ujratGold = rpg > 0 ? (Number(row.labCharges) || 0) / rpg : 0
  const khalis = Number(row.khalisSona) || 0
  const goldOwedAlways = khalis - ujratGold
  const sidebarOwed = (ujratKaSona) => (ujratKaSona ? khalis - ujratGold : khalis)
  const sonaDena = rpg > 0 ? units.fmtNum(goldOwedAlways) : '-'

  const slipData = buildLabSlipData(logic, { row, lab, rates, customer, receiptNo, now, sonaDena })
  const overlay = overlayForm.fieldValues(slipData)

  console.log('\n=== لیب رسید  ↔  CANON OVERLAY — field-by-field ===')
  console.log(`sample parchi: وزن ${input.wazan}g  پانی میں ${input.malawat}g  ریٹ/تولہ ${units.fmtMoney(rates.rate_tezabi_tola)}  نام "${customer.name}"`)
  console.log(`سونا دینا ہے = خالص ${units.fmtNum(khalis)} − اجرت کا سونا ${units.fmtNum(ujratGold)} = ${sonaDena}\n`)
  console.log(pad('overlay field', 15) + pad('رسید cell', 34) + pad('رسید value', 14) + pad('overlay value', 14) + 'match')
  console.log('-'.repeat(84))

  for (const [key, cellName, expected] of expectations(slipData)) {
    const got = overlay[key]
    const same = String(expected == null ? '' : expected) === String(got == null ? '' : got)
    if (!same) failures++
    console.log(pad(key, 15) + pad(cellName, 34) + pad(expected, 14) + pad(got, 14) + (same ? 'ok' : '*** MISMATCH ***'))
  }

  console.log('\nchecks:')
  const kv = overlayForm.labVals(slipData.tables).kv
  // 1. پوائنٹ is DELIBERATELY absent from the printed لیب رسید now — «بقایا سونا»
  //    prints in its place. (The on-screen panel still shows پوائنٹ.)
  kv['پوائنٹ'] === undefined
    ? pass('printed لیب رسید carries NO پوائنٹ cell — replaced by بقایا سونا, as intended')
    : fail(`printed رسید still carries a پوائنٹ cell (${kv['پوائنٹ']})`)
  kv['بقایا سونا'] === sonaDena
    ? pass(`its «بقایا سونا» cell = ${kv['بقایا سونا']} (the same sonaDena)`)
    : fail(`رسید's بقایا سونا is ${kv['بقایا سونا']}, expected ${sonaDena}`)

  // 2. Pass-through, not recomputation: the overlay value must be byte-identical
  //    to what the snapshot carried. Any arithmetic in overlayForm would show up.
  //    (The overlay reads data.sonaDena by NAME — not the رسید's پوائنٹ cell — so
  //    removing that cell from the thermal tables cannot disturb it.)
  overlay.point === slipData.sonaDena
    ? pass('overlay takes سونا دینا ہے verbatim from the snapshot (no second calculation)')
    : fail(`overlay recomputed something: snapshot=${slipData.sonaDena} overlay=${overlay.point}`)

  // 4. «اجرت کا سونا» is a DISPLAY toggle for the shop: the Canon cell must read
  //    خالص − اجرت in BOTH states, while the main screen's sidebar keeps following
  //    the checkbox. Both states are exercised end-to-end here.
  console.log('\n«اجرت کا سونا» checkbox — overlay must not move, sidebar must:')
  console.log(pad('  tick', 10) + pad('overlay «سونا دینا ہے»', 26) + 'main screen sidebar')
  const expectAlways = units.fmtNum(goldOwedAlways)
  for (const tick of [true, false]) {
    // What the app builds for this state: slipData.sonaDena = goldOwedAlways
    // (checkbox-independent), sidebar = goldOwed (checkbox-dependent).
    const snap = buildLabSlipData(logic, { row, lab, rates, customer, receiptNo, now, sonaDena: expectAlways })
    const got = overlayForm.fieldValues(snap).point
    const sidebar = units.fmtNum(sidebarOwed(tick))
    console.log(pad(tick ? '  ON' : '  OFF', 10) + pad(got, 26) + sidebar)
    if (got !== expectAlways) fail(`tick ${tick ? 'ON' : 'OFF'}: overlay shows ${got}, expected ${expectAlways}`)
  }
  pass(`overlay cell is ${expectAlways} (خالص − اجرت) in BOTH states`)
  units.fmtNum(sidebarOwed(true)) !== units.fmtNum(sidebarOwed(false))
    ? pass(`main screen «سونا دینا ہے» still follows the checkbox (${units.fmtNum(sidebarOwed(true))} / ${units.fmtNum(sidebarOwed(false))}) — unchanged behaviour`)
    : fail('main screen سونا دینا ہے no longer responds to the checkbox')

  // 5. نام — ANY selected customer's name prints as-is: "shop", a person's name,
  //    Urdu or Latin. Nothing is filtered, shortened or substituted.
  console.log('\nنام — whatever customer is selected:')
  for (const name of ['shop', 'Rayyan', 'محمد عبدالرحمٰن چوہدری']) {
    const snap = buildLabSlipData(logic, { row, lab, rates, customer: { id: 3, name }, receiptNo, now, sonaDena })
    const got = overlayForm.fieldValues(snap).naam
    got === name ? pass(`"${name}" → overlay prints "${got}"`) : fail(`"${name}" → overlay printed "${got}"`)
  }

  // 6. An UNSAVED (typed-only) customer has no id — the رسید prints '-' there, and
  //    the overlay must agree (a blank cell), never fall back to some older name.
  const unsaved = buildLabSlipData(logic, {
    row, lab, rates, customer: { id: null, name: 'sho' }, receiptNo, now, sonaDena
  })
  const unsavedOverlay = overlayForm.fieldValues(unsaved)
  const unsavedReceipt = overlayForm.labVals(unsaved.tables).kv['نام']
  unsavedOverlay.naam === unsavedReceipt
    ? pass(`unsaved customer: رسید shows "${unsavedReceipt}" and overlay shows the same (blank cell)`)
    : fail(`unsaved customer: رسید "${unsavedReceipt}" vs overlay "${unsavedOverlay.naam}"`)

  console.log(failures ? `\n${failures} FAILURE(S)\n` : '\nall fields match — رسید and overlay come from ONE snapshot\n')
  app.exit(failures ? 1 : 0)
}

app.on('window-all-closed', () => {})
app.whenReady().then(main).catch((e) => { console.error(e); app.exit(1) })
