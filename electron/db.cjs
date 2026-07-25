/*
 * SQLite persistence layer using sql.js (WASM build of SQLite).
 * Chosen over better-sqlite3 so `npm install` never needs a native compiler
 * toolchain on the user's Windows machine — it "just runs".
 *
 * The whole database lives in memory and is flushed to a single .sqlite file
 * in the Electron userData folder after every write (debounced).
 */
const path = require('path')
const fs = require('fs')
const initSqlJs = require('sql.js')
// ٹوٹل-panel pin gate: hashing + the developer recovery code (see pinGate.cjs).
const pinGate = require('./pinGate.cjs')
const { SHOP_FIELDS, SHOP_DEFAULTS, SLIP_TERMS_DEFAULT, SLIP_WARNING_DEFAULT, WA_REMINDER_DEFAULT, SLIP_TEXT_FIELDS, SLIP_TEXT_DEFAULTS, FORM_THEME_DEFAULT, FORM_FOOTER_DEFAULT } = require('./shopDefaults.cjs')
const { DEFAULT_COORDS: OVERLAY_DEFAULT_COORDS, DEFAULT_OFFSETS: OVERLAY_DEFAULT_OFFSETS } = require('./overlayDefaults.cjs')

let SQL = null
let db = null
let dbFilePath = null
let saveTimer = null

function locateFile(file) {
  // sql.js ships sql-wasm.wasm next to its dist entry point.
  const dir = path.dirname(require.resolve('sql.js'))
  const full = path.join(dir, file)
  // In a PACKAGED build the .wasm is asarUnpack'd (see electron-builder "asarUnpack"),
  // so it physically lives under `app.asar.unpacked`, NOT inside the read-only
  // `app.asar` archive that require.resolve() points at. Remap so sql.js reads the
  // real on-disk file. In dev there is no "app.asar" segment, so the path is
  // returned unchanged. This only changes WHERE the wasm is read from — no DB
  // query, schema, or behaviour is affected.
  const marker = `app.asar${path.sep}`
  return full.includes(marker) ? full.replace(marker, `app.asar.unpacked${path.sep}`) : full
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(flush, 200)
}

function flush() {
  if (!db || !dbFilePath) return
  try {
    const data = db.export()
    fs.writeFileSync(dbFilePath, Buffer.from(data))
  } catch (e) {
    console.error('DB flush failed:', e)
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  date TEXT,
  rate_tezabi_tola REAL,
  parchi_charges REAL,
  fc_per_gram REAL,
  rate_tezabi_gram REAL,
  point REAL,
  slip_count INTEGER,
  raw_print_mode TEXT,   -- 'auto' (regex-match thermal) | 'force' (always raw)
  print_scale REAL,      -- thermal render magnification, 1.0–1.35 (default 1.15)
  -- Shop identity printed in the slip HEADER (see electron/shopDefaults.cjs).
  -- Seeded with the real Chaudhary values, editable in ڈیفالٹ سیٹنگز. An empty
  -- value HIDES that line on the slip; it never falls back to the default.
  shop_name TEXT,
  shop_tagline TEXT,
  shop_owner TEXT,
  shop_phone1 TEXT,
  shop_phone2 TEXT,
  shop_phone3 TEXT,
  shop_address TEXT,
  shop_seeded INTEGER,   -- 1 once the header defaults have been filled in (see migrateSchema)
  slip_terms TEXT,       -- لیب رسید terms/fee paragraph; blank hides the box (see migrateSchema)
  whatsapp_reminder_text TEXT  -- واٹس ایپ یاد دہانی template, {رقم} placeholder (see migrateSchema)
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  mobile TEXT,
  address TEXT,
  image TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  receipt_no INTEGER,
  customer_id INTEGER,
  date TEXT,
  ts TEXT,
  kind TEXT,        -- 'cash' | 'udhar' | 'lab'
  direction TEXT,   -- 'in' | 'out' (shop perspective)
  category TEXT,    -- gold_sell, gold_buy, gold_give, gold_take, cash_give, cash_take, lab_job
  sona_wazan REAL,
  point REAL,
  khalis_sona REAL,
  rate REAL,
  qeemat REAL,
  cash_amount REAL,
  sona_diya REAL,   -- کچا سونا لیا: gold given, stored on the kacha record
  cash_diya REAL,   -- کچا سونا لیا: cash given, stored on the kacha record
  updated_at TEXT,  -- ISO date (yyyy-mm-dd) the row was last inserted/edited
  note TEXT,
  meta TEXT
);

CREATE TABLE IF NOT EXISTS receipts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  receipt_no INTEGER,
  type TEXT,
  customer_id INTEGER,
  date TEXT,
  ts TEXT,
  payload TEXT
);

CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  amount REAL,
  comment TEXT,
  date TEXT,        -- YYYY-MM-DD for reliable range filtering
  ts TEXT           -- full ISO timestamp (date + time) recorded
);

-- Scratch store for in-progress UNSAVED parchis (openReceiptNo == null on screen).
-- One row per unsaved parchi (the operator may keep several open at once via New);
-- each holds a JSON snapshot of the composing form ONLY. Read/written exclusively
-- by listDrafts/upsertDraft/deleteDraft/clearDrafts. Nothing in the transactions
-- ledger, getShopTotals, any report, or any customer balance ever touches this
-- table — so unsaved drafts are invisible to totals/reports by construction.
CREATE TABLE IF NOT EXISTS drafts (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  payload TEXT
);

-- نیا سودا — deals list (khareed/farokht). Self-contained: nothing in the
-- transactions ledger, totals, or any existing report reads these tables.
-- receipt_no tags the saved entry with the parchi it was entered under.
CREATE TABLE IF NOT EXISTS naya_soda (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  rate REAL,
  wazan REAL,
  type TEXT,                        -- 'khareed' | 'farokht'
  date TEXT,                        -- YYYY-MM-DD
  status TEXT DEFAULT 'bakaya',     -- 'bhugtan' | 'bakaya'
  receipt_no INTEGER,               -- parchi the entry was saved under (nullable)
  created_at TEXT
);

-- Per-receipt in-progress نیا سودا form values (ONE row per parchi number). The
-- form auto-persists here as it is typed, so unsaved values are never lost and
-- reappear when that parchi number is reopened. Cleared when the entry is saved
-- (محفوظ کریں) or the form is emptied. Pure scratch — no report reads it.
CREATE TABLE IF NOT EXISTS naya_soda_draft (
  receipt_no INTEGER PRIMARY KEY,
  payload TEXT,
  updated_at TEXT
);

-- Indexes. Every lookup below was a full table scan before these existed, which
-- is invisible on a new shop and painful after a year of trading (a روزنامچہ open
-- on a 100k-row ledger read all 100k rows to find one day's 40). Only ORIGINAL
-- columns are indexed — this block runs BEFORE migrateSchema(), so a column added
-- by a later migration must never appear here. Creating an index is idempotent and
-- costs a few ms at startup; it changes no data and no query's RESULT, only speed.
-- (date, category) not date alone: روزنامچہ and listDates both filter on the date
-- AND read the category, so the wider index answers them from the index itself.
-- With date only, listDates had to fetch every matching row from the table just to
-- check its category, which was measurably SLOWER than the old full scan.
CREATE INDEX IF NOT EXISTS idx_txn_date_category ON transactions(date, category);
CREATE INDEX IF NOT EXISTS idx_txn_customer ON transactions(customer_id);
CREATE INDEX IF NOT EXISTS idx_txn_receipt ON transactions(receipt_no);
CREATE INDEX IF NOT EXISTS idx_receipts_no ON receipts(receipt_no);
CREATE INDEX IF NOT EXISTS idx_receipts_date ON receipts(date);
CREATE INDEX IF NOT EXISTS idx_receipts_customer ON receipts(customer_id);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date);
CREATE INDEX IF NOT EXISTS idx_naya_soda_date ON naya_soda(date);
`

// Lightweight, idempotent migration. `CREATE TABLE IF NOT EXISTS` never alters
// an existing table, so databases created before the address/image columns
// existed must be patched in place. Safe to run on every startup: we only ADD a
// column when PRAGMA table_info shows it is missing.
function migrateSchema() {
  // The unsaved-parchi draft store started as a single-row `draft` table; it is now
  // the multi-row `drafts` table. Drop the obsolete one (it only ever held transient
  // scratch data, never ledger data) so nothing stale lingers.
  try { db.run('DROP TABLE IF EXISTS draft') } catch (e) { /* ignore */ }

  const cols = query('PRAGMA table_info(customers)').map((r) => r.name)
  if (!cols.includes('address')) db.run('ALTER TABLE customers ADD COLUMN address TEXT')
  if (!cols.includes('image')) db.run('ALTER TABLE customers ADD COLUMN image TEXT')

  // settings.slip_count — number of slip copies to print. Default to 1 on old DBs.
  const sCols = query('PRAGMA table_info(settings)').map((r) => r.name)
  if (!sCols.includes('slip_count')) {
    db.run('ALTER TABLE settings ADD COLUMN slip_count INTEGER')
    db.run('UPDATE settings SET slip_count = 1 WHERE slip_count IS NULL')
  }

  // settings.kacha_baseline — offset for the bottom-bar کچا سونا COUNTER. The
  // display shows (Σ kacha weight − baseline); the ↺ reset sets baseline to the
  // current sum so the counter zeroes WITHOUT deleting any کچا سونا لیا record
  // (the اُدھار report keeps them). Default 0 on old DBs.
  if (!sCols.includes('kacha_baseline')) {
    db.run('ALTER TABLE settings ADD COLUMN kacha_baseline REAL')
    db.run('UPDATE settings SET kacha_baseline = 0 WHERE kacha_baseline IS NULL')
  }

  // settings.raw_print_mode — thermal routing: 'auto' (regex-match the default
  // printer name) or 'force' (always use the raw ESC/POS path). Default 'auto'.
  if (!sCols.includes('raw_print_mode')) {
    db.run("ALTER TABLE settings ADD COLUMN raw_print_mode TEXT")
    db.run("UPDATE settings SET raw_print_mode = 'auto' WHERE raw_print_mode IS NULL")
  }
  // settings.print_scale — thermal render magnification (1.0–1.35). Default 1.15:
  // the approved final receipt design was approved printed at printScale 1.15, so
  // real receipts match that physical size. The setting stays adjustable.
  if (!sCols.includes('print_scale')) {
    db.run('ALTER TABLE settings ADD COLUMN print_scale REAL')
    db.run('UPDATE settings SET print_scale = 1.15 WHERE print_scale IS NULL')
  }
  // ONE-TIME: align existing DBs with the approved 1.15 default (older builds had
  // 1.0). Guarded by a flag column so it runs exactly once and never stomps a
  // value the user deliberately picks later in Defaults.
  if (!sCols.includes('print_scale_115')) {
    db.run('ALTER TABLE settings ADD COLUMN print_scale_115 INTEGER')
    db.run('UPDATE settings SET print_scale = 1.15')
    db.run('UPDATE settings SET print_scale_115 = 1')
  }

  // ── Colour-form / thermal print mode (electron/colorFormPrint.cjs) ─────────
  // settings.print_mode — which print PATH receipts take: 'thermal' (default,
  // the raw ESC/POS raster path, unchanged) or 'color_form' (the software draws
  // the WHOLE receipt in colour and prints it on plain paper via the Canon
  // driver). One setting, same build for every customer.
  if (!sCols.includes('print_mode')) {
    db.run('ALTER TABLE settings ADD COLUMN print_mode TEXT')
    db.run("UPDATE settings SET print_mode = 'thermal' WHERE print_mode IS NULL")
  }
  // The colour form replaced the earlier pre-printed-form "overlay" approach,
  // whose mode value was 'laser_form'. Rename any DB still carrying it. Idempotent
  // (no rows match after the first run), so it is safe on every launch.
  // The colour full-form mode ('color_form') was removed — the shop only uses
  // thermal + overlay. Normalise any DB still on it (or the older 'laser_form') to
  // 'thermal' so no one is stuck in a removed mode. Idempotent, safe every launch.
  db.run("UPDATE settings SET print_mode = 'thermal' WHERE print_mode IN ('laser_form', 'color_form')")
  // settings.form_paper — the plain-paper sheet the colour form is printed on:
  // 'A5' (default) | 'A4' | 'Letter' | 'custom' (then form_paper_w_mm /
  // form_paper_h_mm apply).
  if (!sCols.includes('form_paper')) {
    db.run('ALTER TABLE settings ADD COLUMN form_paper TEXT')
    db.run("UPDATE settings SET form_paper = 'A5' WHERE form_paper IS NULL")
  }
  if (!sCols.includes('form_paper_w_mm')) db.run('ALTER TABLE settings ADD COLUMN form_paper_w_mm REAL')
  if (!sCols.includes('form_paper_h_mm')) db.run('ALTER TABLE settings ADD COLUMN form_paper_h_mm REAL')
  // The offset/scale/font/template columns below belonged to the old coordinate-
  // overlay approach. They are NO LONGER READ (the software owns the whole colour
  // layout now), but the columns are kept so old DBs migrate cleanly — harmless.
  if (!sCols.includes('form_offset_x_mm')) {
    db.run('ALTER TABLE settings ADD COLUMN form_offset_x_mm REAL')
    db.run('UPDATE settings SET form_offset_x_mm = 0 WHERE form_offset_x_mm IS NULL')
  }
  if (!sCols.includes('form_offset_y_mm')) {
    db.run('ALTER TABLE settings ADD COLUMN form_offset_y_mm REAL')
    db.run('UPDATE settings SET form_offset_y_mm = 0 WHERE form_offset_y_mm IS NULL')
  }
  if (!sCols.includes('form_scale_x')) {
    db.run('ALTER TABLE settings ADD COLUMN form_scale_x REAL')
    db.run('UPDATE settings SET form_scale_x = 1.0 WHERE form_scale_x IS NULL')
  }
  if (!sCols.includes('form_scale_y')) {
    db.run('ALTER TABLE settings ADD COLUMN form_scale_y REAL')
    db.run('UPDATE settings SET form_scale_y = 1.0 WHERE form_scale_y IS NULL')
  }
  if (!sCols.includes('form_font_pt')) {
    db.run('ALTER TABLE settings ADD COLUMN form_font_pt REAL')
    db.run('UPDATE settings SET form_font_pt = 11 WHERE form_font_pt IS NULL')
  }
  if (!sCols.includes('form_template')) {
    db.run('ALTER TABLE settings ADD COLUMN form_template TEXT')
    db.run("UPDATE settings SET form_template = 'default' WHERE form_template IS NULL")
  }
  // settings.shop_logo_path — optional header logo for the colour form (a data
  // URL the shop uploads in ڈیفالٹ سیٹنگز, or a file path). Blank → a CSS diamond
  // gem is drawn instead. Additive, no backfill (blank is the valid default).
  if (!sCols.includes('shop_logo_path')) db.run('ALTER TABLE settings ADD COLUMN shop_logo_path TEXT')

  // settings.form_theme — the colour-form PALETTE (JSON blob of the seven themed
  // colours; see shopDefaults.cjs FORM_THEME_DEFAULT). Read by colorFormPrint.cjs
  // to drive both the preview and the Canon print, so a shop can recolour its
  // parchi from ڈیفالٹ سیٹنگز. Seeded once with the reference palette; a missing
  // key falls back to the default at render time, so partial blobs are safe.
  if (!sCols.includes('form_theme')) {
    db.run('ALTER TABLE settings ADD COLUMN form_theme TEXT')
    db.run('UPDATE settings SET form_theme = ? WHERE form_theme IS NULL OR form_theme = ?', [JSON.stringify(FORM_THEME_DEFAULT), ''])
  }
  // settings.form_footer — the editable footer press line on the colour form
  // (above the fixed Rayyan brand line). Same one-time guard as slip_warning: the
  // column being absent IS the guard, so the default is seeded exactly once and a
  // shop that later clears it (blank → the line hides) is never re-seeded.
  if (!sCols.includes('form_footer')) {
    db.run('ALTER TABLE settings ADD COLUMN form_footer TEXT')
    db.run('UPDATE settings SET form_footer = ? WHERE form_footer IS NULL OR form_footer = ?', [FORM_FOOTER_DEFAULT, ''])
  }
  // settings.form_style — the Canon-form look: 'bw' (black-and-white line-art, the
  // default — prints crisp on a mono laser like the Canon LBP6030) or 'color' (the
  // themed colour design, for a colour printer). Default 'bw'.
  if (!sCols.includes('form_style')) {
    db.run('ALTER TABLE settings ADD COLUMN form_style TEXT')
    db.run("UPDATE settings SET form_style = 'bw' WHERE form_style IS NULL")
  }

  // ── Overlay mode (electron/overlayForm.cjs) — LAB رسید on PRE-PRINTED slips ──
  // print_mode = 'overlay_form' drops VALUES ONLY into the blank cells of the
  // customer's pre-printed 2-up colour slip. These columns configure the geometry;
  // all additive + defaulted, so old DBs migrate cleanly. overlay_coords holds the
  // JSON per-field map the calibration tool tunes; overlay_bg_path is the uploaded
  // blank-form scan (base64 data URL) used for the calibration canvas + WhatsApp.
  const overlayCols = [
    ['overlay_paper', 'TEXT', "'halfletter_landscape'"],
    ['overlay_offx', 'REAL', '0'],
    ['overlay_offy', 'REAL', '0'],
    ['overlay_scalex', 'REAL', '1'],
    ['overlay_scaley', 'REAL', '1'],
    ['overlay_right_dx', 'REAL', '108'],
    ['overlay_right_dy', 'REAL', '0'],
    ['overlay_font_pt', 'REAL', '10'],
    // Added after the Canon printed the overlay rotated + shrunken. landscape and
    // rotate180 are geometry escape hatches; engine chooses the print pipeline
    // ('pdf' = exact-size PDF spooled with scaling off, 'driver' = the old
    // webContents.print path). All default to the safe values and are backfilled
    // for existing installs, so an upgraded DB behaves like a fresh one.
    ['overlay_landscape', 'INTEGER', '0'],
    ['overlay_rotate180', 'INTEGER', '0'],
    ['overlay_engine', 'TEXT', "'pdf'"],
    // Spool orientation token (auto | portrait | landscape), separate from
    // overlay_landscape. Default 'auto' → derived from the printed page aspect.
    ['overlay_print_orientation', 'TEXT', "'auto'"]
  ]
  for (const [col, type, def] of overlayCols) {
    if (!sCols.includes(col)) {
      db.run(`ALTER TABLE settings ADD COLUMN ${col} ${type}`)
      db.run(`UPDATE settings SET ${col} = ${def} WHERE ${col} IS NULL`)
    }
  }
  // overlay_coords / overlay_bg_path — no backfill (blank is the valid default: the
  // renderer falls back to DEFAULT_COORDS, and no scan means an empty calibration bg).
  if (!sCols.includes('overlay_coords')) db.run('ALTER TABLE settings ADD COLUMN overlay_coords TEXT')
  if (!sCols.includes('overlay_bg_path')) db.run('ALTER TABLE settings ADD COLUMN overlay_bg_path TEXT')

  // ── Main-screen theme colours (Defaults → تھیم / رنگ) ───────────────────────
  // Nullable '#rrggbb' text, NO backfill: NULL means "use the built-in hex", so
  // existing installs look byte-identical until the shopkeeper picks a colour. The
  // renderer maps each to a #root CSS variable (see src/logic/theme.js).
  for (const col of ['ui_panel', 'ui_header', 'ui_header_dark', 'ui_line', 'ui_surface']) {
    if (!sCols.includes(col)) db.run(`ALTER TABLE settings ADD COLUMN ${col} TEXT`)
  }

  // Dual-printer routing (the machine has a thermal printer AND the Canon LBP6030
  // attached at once). printer_thermal = device name for ESC/POS receipts;
  // printer_canon = device name for the colour/overlay Canon jobs. Blank = use the
  // Windows default. No backfill — blank is the valid default until the shop picks.
  if (!sCols.includes('printer_thermal')) db.run('ALTER TABLE settings ADD COLUMN printer_thermal TEXT')
  if (!sCols.includes('printer_canon')) db.run('ALTER TABLE settings ADD COLUMN printer_canon TEXT')

  // Which WhatsApp the share button opens: 'auto' (desktop app when Windows says
  // it is installed, else the built-in web window), 'desktop' (always the app),
  // 'web' (always the built-in window). Auto is what shipped, so an existing
  // install keeps behaving exactly as before until the shopkeeper picks.
  if (!sCols.includes('wa_mode')) {
    db.run('ALTER TABLE settings ADD COLUMN wa_mode TEXT')
    db.run("UPDATE settings SET wa_mode = 'auto' WHERE wa_mode IS NULL")
  }

  // settings.reports_dir — the synced (Google Drive Desktop) folder where per-
  // report PDFs are auto-written after each transaction (see electron/reportPdf.cjs).
  // Blank = feature OFF. No backfill; the shopkeeper picks the folder once in
  // ڈیفالٹ سیٹنگز. The DB itself is NEVER written to this folder.
  if (!sCols.includes('reports_dir')) db.run('ALTER TABLE settings ADD COLUMN reports_dir TEXT')

  // settings.shop_* — the printed slip header (name / tagline / owner / three
  // phones / address). Added per column, then BACKFILLED with the Chaudhary
  // default ONLY where the column is NULL or '' — a shop that already customized
  // a field is never overwritten. Re-running this is harmless: after the first
  // pass the columns exist, and the backfill only ever touches blanks (a field
  // the shopkeeper deliberately CLEARS would be re-seeded on the next launch, so
  // the fill runs once, guarded by shop_seeded).
  const seedShop = !sCols.includes('shop_seeded')
  for (const f of SHOP_FIELDS) {
    if (!sCols.includes(f)) db.run(`ALTER TABLE settings ADD COLUMN ${f} TEXT`)
  }
  if (seedShop) {
    if (!sCols.includes('shop_seeded')) db.run('ALTER TABLE settings ADD COLUMN shop_seeded INTEGER')
    for (const f of SHOP_FIELDS) {
      db.run(`UPDATE settings SET ${f} = ? WHERE ${f} IS NULL OR ${f} = ''`, [SHOP_DEFAULTS[f]])
    }
    db.run('UPDATE settings SET shop_seeded = 1')
  }

  // settings.slip_terms — the لیب رسید terms paragraph. It gets its OWN guard,
  // NOT shop_seeded: DBs from the shop-header release already have
  // shop_seeded = 1, so folding this into that block would add the column and
  // never backfill it — the terms box would silently vanish from their slips.
  // The column being absent IS the one-time guard; once it exists (even
  // deliberately cleared to ''), this never runs again.
  if (!sCols.includes('slip_terms')) {
    db.run('ALTER TABLE settings ADD COLUMN slip_terms TEXT')
    db.run('UPDATE settings SET slip_terms = ? WHERE slip_terms IS NULL OR slip_terms = ?', [SLIP_TERMS_DEFAULT, ''])
  }

  // settings.slip_warning — the RED warning bar on the colour form. Same one-time
  // guard style as slip_terms (its own, not shop_seeded): the column being absent
  // IS the guard, so the default is seeded exactly once and a shop that later
  // clears it (blank → no red bar) is never re-seeded.
  if (!sCols.includes('slip_warning')) {
    db.run('ALTER TABLE settings ADD COLUMN slip_warning TEXT')
    db.run('UPDATE settings SET slip_warning = ? WHERE slip_warning IS NULL OR slip_warning = ?', [SLIP_WARNING_DEFAULT, ''])
  }

  // settings.whatsapp_reminder_text — the یاد دہانی template the "لینا ہے" balance
  // reports send. Own guard, same style as slip_terms/slip_warning: every existing
  // DB is already past shop_seeded, so this column has to add AND backfill itself
  // or the first shopkeeper to press the button would send an empty message. Once
  // the column exists this never runs again — a template edited (or cleared) by
  // the shopkeeper is his own.
  if (!sCols.includes('whatsapp_reminder_text')) {
    db.run('ALTER TABLE settings ADD COLUMN whatsapp_reminder_text TEXT')
    db.run('UPDATE settings SET whatsapp_reminder_text = ? WHERE whatsapp_reminder_text IS NULL OR whatsapp_reminder_text = ?', [WA_REMINDER_DEFAULT, ''])
  }

  // expenses.ts — full timestamp. Patch DBs that had expenses before it existed.
  const xCols = query('PRAGMA table_info(expenses)').map((r) => r.name)
  if (xCols.length && !xCols.includes('ts')) db.run('ALTER TABLE expenses ADD COLUMN ts TEXT')

  // transactions.sona_diya / cash_diya — the کچا سونا لیا record carries the gold-
  // given and cash-given amounts alongside kacha weight + ticked-row khalis, so
  // the report shows one complete row. Patch DBs created before these existed.
  const tCols = query('PRAGMA table_info(transactions)').map((r) => r.name)
  if (!tCols.includes('sona_diya')) db.run('ALTER TABLE transactions ADD COLUMN sona_diya REAL')
  if (!tCols.includes('cash_diya')) db.run('ALTER TABLE transactions ADD COLUMN cash_diya REAL')
  // updated_at — ISO date a transaction was last inserted/edited (for the balance
  // report's تاریخ column). try/catch swallows the duplicate-column error too.
  if (!tCols.includes('updated_at')) {
    try { db.run('ALTER TABLE transactions ADD COLUMN updated_at TEXT') } catch (e) { /* already exists */ }
  }

  // settings.pin_hash / pin_salt — the ٹوٹل panel's owner pin, stored ONLY as a
  // salted PBKDF2-SHA256 digest (never the raw pin). Both NULL = no pin set yet,
  // which is what makes the login screen offer "create a pin" on first use.
  // Written exclusively by pinSet(); read exclusively by pinStatus()/pinCheck().
  if (!sCols.includes('pin_hash')) {
    try { db.run('ALTER TABLE settings ADD COLUMN pin_hash TEXT') } catch (e) { /* already exists */ }
  }
  if (!sCols.includes('pin_salt')) {
    try { db.run('ALTER TABLE settings ADD COLUMN pin_salt TEXT') } catch (e) { /* already exists */ }
  }

  // naya_soda.receipt_no — tag saved deals with the parchi they were entered on.
  // Patch DBs created before the نیا سودا ↔ receipt linkage existed. The draft
  // table itself is created by SCHEMA (CREATE TABLE IF NOT EXISTS), no migration.
  const nCols = query('PRAGMA table_info(naya_soda)').map((r) => r.name)
  if (nCols.length && !nCols.includes('receipt_no')) {
    try { db.run('ALTER TABLE naya_soda ADD COLUMN receipt_no INTEGER') } catch (e) { /* already exists */ }
  }

  slimReceiptPayloads()
}

// The rate context a saved parchi legitimately owns — the mirror of the renderer's
// RATE_CONTEXT_KEYS (src/state/store.jsx). Keep the two lists in step.
const RATE_CONTEXT_KEYS = ['date', 'rate_tezabi_tola', 'rate_tezabi_gram', 'parchi_charges', 'fc_per_gram', 'point']

// ONE-TIME (idempotent): shrink already-saved parchi payloads.
//
// Every parchi used to snapshot the WHOLE settings row into payload.rates, and
// settings holds the print-overlay background as a ~200 KB base64 image. So each
// saved receipt weighed ~205 KB: the database grew to megabytes, every single
// write re-exported all of it to disk, and merely opening a parchi with ◀/▶ read,
// parsed and shipped a 200 KB image the app then threw away. saveParchi now stores
// only the rate context and loadReceipt reads back only the rate context, so this
// pass drops what old rows are still carrying. Purely a size cut — no field the
// app reads is touched. Runs at startup, does nothing once there is nothing to cut.
function slimReceiptPayloads() {
  let rows = []
  try { rows = query('SELECT id, payload FROM receipts WHERE payload IS NOT NULL') } catch { return }
  let slimmed = 0
  for (const r of rows) {
    let p
    try { p = JSON.parse(r.payload || '{}') } catch { continue } // unreadable → leave untouched
    if (!p || typeof p !== 'object' || !p.rates || typeof p.rates !== 'object') continue
    const keep = {}
    for (const k of RATE_CONTEXT_KEYS) if (p.rates[k] !== undefined) keep[k] = p.rates[k]
    if (Object.keys(keep).length === Object.keys(p.rates).length) continue // already slim
    p.rates = keep
    try {
      db.run('UPDATE receipts SET payload = ? WHERE id = ?', [JSON.stringify(p), r.id])
      slimmed++
    } catch { /* skip this row */ }
  }
  if (!slimmed) return
  // Reclaim the freed pages, so the file the app rewrites on every save is small
  // again instead of staying at its high-water mark.
  try { db.run('VACUUM') } catch { /* not fatal — the rows are already slim */ }
  console.log(`[db] slimmed ${slimmed} receipt payload(s)`)
}

function seedSettings() {
  const r = db.exec('SELECT COUNT(*) AS c FROM settings')
  const count = r.length ? r[0].values[0][0] : 0
  if (!count) {
    // Seed the date to TODAY (local), never a hardcoded string.
    const d = new Date()
    const p = (n) => String(n).padStart(2, '0')
    const today = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
    // The shop header is seeded with the real Chaudhary values (shopDefaults.cjs),
    // so a brand-new install prints a complete header before anyone opens Defaults.
    // Overlay is seeded with the CALIBRATED coordinate map + geometry (overlayDefaults
    // .cjs), so a fresh install lands values in the pre-printed cells with NO dragging.
    // Fresh-only (this runs when count==0); existing installs keep their own values.
    const OVERLAY_SEED = [
      ['overlay_paper', 'halfletter_landscape'],
      ...Object.entries(OVERLAY_DEFAULT_OFFSETS),
      ['overlay_coords', JSON.stringify(OVERLAY_DEFAULT_COORDS)]
    ]
    const ovCols = OVERLAY_SEED.map(([c]) => c).join(', ')
    const ovPlace = OVERLAY_SEED.map(() => '?').join(', ')
    const ovVals = OVERLAY_SEED.map(([, v]) => v)
    db.run(
      `INSERT INTO settings (id, date, rate_tezabi_tola, parchi_charges, fc_per_gram, rate_tezabi_gram, point, slip_count, raw_print_mode, print_scale,
                             form_style, form_theme, form_footer, ${ovCols}, ${SLIP_TEXT_FIELDS.join(', ')}, shop_seeded)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${ovPlace}, ${SLIP_TEXT_FIELDS.map(() => '?').join(', ')}, 1)`,
      [today, 9000, 100, 80, 772, 100, 1, 'auto', 1.15, 'bw', JSON.stringify(FORM_THEME_DEFAULT), FORM_FOOTER_DEFAULT, ...ovVals, ...SLIP_TEXT_FIELDS.map((f) => SLIP_TEXT_DEFAULTS[f])]
    )
  }
}

async function init(userDataDir) {
  if (db) return
  SQL = await initSqlJs({ locateFile })
  dbFilePath = path.join(userDataDir, 'goldlab.sqlite')
  if (fs.existsSync(dbFilePath)) {
    const buf = fs.readFileSync(dbFilePath)
    db = new SQL.Database(new Uint8Array(buf))
  } else {
    db = new SQL.Database()
  }
  db.run(SCHEMA)
  migrateSchema()
  seedSettings()
  // The working date ALWAYS starts on TODAY at every launch. settings.date is only
  // the DEFAULT date for NEW parchis — historical parchis keep their own date in
  // transactions/receipts, so this never touches saved data. The user can still
  // change it during a session, but reopening the app always shows the current day
  // (fixes the stale/previous date that used to persist across restarts).
  db.run('UPDATE settings SET date = ? WHERE id = 1', [todayISO()])
  flush()
}

/* ---------- helpers ---------- */

function rowsFrom(res) {
  if (!res.length) return []
  const { columns, values } = res[0]
  return values.map((v) => Object.fromEntries(columns.map((c, i) => [c, v[i]])))
}

function query(sql, params = []) {
  const stmt = db.prepare(sql)
  stmt.bind(params)
  const out = []
  while (stmt.step()) out.push(stmt.getAsObject())
  stmt.free()
  return out
}

// Today's LOCAL date as yyyy-mm-dd — matches how the app stores dates elsewhere.
function todayISO() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function run(sql, params = []) {
  db.run(sql, params)
  scheduleSave()
}

function lastInsertId() {
  const r = db.exec('SELECT last_insert_rowid() AS id')
  return r[0].values[0][0]
}

/* ---------- API ---------- */

// The union of every saved receipt_no across both tables a parchi can touch
// (receipts snapshot + transactions ledger). Used by the nav queries below.
const RECEIPT_NOS_SQL = `
  SELECT receipt_no AS rn FROM transactions WHERE receipt_no IS NOT NULL
  UNION
  SELECT receipt_no AS rn FROM receipts WHERE receipt_no IS NOT NULL`

// The LIKE pattern for a report's کسٹمر کا نام filter. Anchored to the START of
// the name: an unanchored '%s%' matched a name that merely CARRIED the text
// anywhere, so filtering for "shop" while only "s" was typed also reported
// "Nasir". A prefix is what the نام box's ghost completion offers, so the report
// now returns the customer the box is pointing at. An exact name never reaches
// here — UdharForm resolves that to a code and the query filters on the id.
// LIKE's own wildcards are escaped so a name containing % or _ matches literally.
function namePrefixLike(name) {
  return `${String(name).trim().replace(/[\\%_]/g, '\\$&')}%`
}
const NAME_PREFIX_SQL = "c.name LIKE ? ESCAPE '\\'"

const api = {
  // ── ٹوٹل PANEL PIN GATE ─────────────────────────────────────────────────────
  // Reads/writes settings.pin_hash + settings.pin_salt and NOTHING else. The raw
  // pin arrives only as an argument, is hashed by pinGate.cjs, and is never
  // stored or logged. The developer recovery code lives at the top of pinGate.cjs.

  // Has the owner set a pin yet? Drives create-vs-enter on the login screen.
  pinStatus() {
    const r = query('SELECT pin_hash, pin_salt FROM settings WHERE id = 1')
    const row = r[0] || {}
    return { hasPin: !!(row.pin_hash && row.pin_salt) }
  },

  // Verify a typed code. `ok` = it matches the owner's stored pin; `recovery` =
  // it is the developer recovery code (which is accepted anywhere the pin is,
  // and is what lets a forgotten pin be reset).
  pinCheck(code) {
    const raw = String(code == null ? '' : code)
    if (pinGate.isRecoveryCode(raw)) return { ok: true, recovery: true }
    const r = query('SELECT pin_hash, pin_salt FROM settings WHERE id = 1')
    const row = r[0] || {}
    if (!row.pin_hash || !row.pin_salt) return { ok: false, recovery: false }
    const ok = pinGate.safeEqual(pinGate.hashPin(raw, row.pin_salt), row.pin_hash)
    return { ok, recovery: false }
  },

  // Set (or change) the pin. When one already exists, `auth` must be the current
  // pin or the recovery code — so a change can never happen unauthenticated. A
  // FRESH salt is generated every time. flush() writes through immediately, so a
  // pin set now still applies after a restart.
  pinSet(newPin, auth) {
    if (!pinGate.isValidPin(newPin)) return { ok: false, error: 'invalid' }
    if (api.pinStatus().hasPin) {
      const chk = api.pinCheck(auth)
      if (!chk.ok) return { ok: false, error: 'auth' }
    }
    const salt = pinGate.makeSalt()
    run('UPDATE settings SET pin_hash = ?, pin_salt = ? WHERE id = 1',
      [pinGate.hashPin(newPin, salt), salt])
    flush() // persist immediately — a new pin must survive an instant restart
    return { ok: true }
  },

  getRates() {
    const r = query('SELECT * FROM settings WHERE id = 1')
    if (!r[0]) return null
    // The pin digest/salt live in this same row but are NOT settings — strip them
    // so the ٹوٹل pin never travels to the renderer. Nothing else is altered:
    // every rate/print/shop field is returned exactly as before.
    const { pin_hash, pin_salt, ...rates } = r[0]
    return rates
  },

  saveRates(rates) {
    // raw_print_mode / print_scale / shop_* use COALESCE so a caller that omits
    // them keeps the stored value (never nulls a setting it didn't mean to touch).
    // An EMPTY STRING is not null, so deliberately clearing a shop field does save
    // — and that blank line then disappears from the printed header.
    // Laser form-overlay settings follow the same COALESCE rule. Numeric ones
    // are passed through Number() so a stringly UI value can't corrupt the
    // column; print_mode / form_paper are clamped to their known values.
    const FORM_NUM_FIELDS = ['form_paper_w_mm', 'form_paper_h_mm', 'form_offset_x_mm', 'form_offset_y_mm', 'form_scale_x', 'form_scale_y', 'form_font_pt']
    // Overlay-mode numeric columns follow the same COALESCE + Number() rule.
    const OVERLAY_NUM_FIELDS = ['overlay_offx', 'overlay_offy', 'overlay_scalex', 'overlay_scaley', 'overlay_right_dx', 'overlay_right_dy', 'overlay_font_pt']
    run(
      `UPDATE settings SET date=?, rate_tezabi_tola=?, parchi_charges=?, fc_per_gram=?, rate_tezabi_gram=?, point=?, slip_count=?,
              raw_print_mode=COALESCE(?, raw_print_mode), print_scale=COALESCE(?, print_scale),
              print_mode=COALESCE(?, print_mode), form_paper=COALESCE(?, form_paper), form_template=COALESCE(?, form_template),
              shop_logo_path=COALESCE(?, shop_logo_path),
              form_style=COALESCE(?, form_style), form_theme=COALESCE(?, form_theme), form_footer=COALESCE(?, form_footer),
              overlay_paper=COALESCE(?, overlay_paper), overlay_coords=COALESCE(?, overlay_coords), overlay_bg_path=COALESCE(?, overlay_bg_path),
              overlay_landscape=COALESCE(?, overlay_landscape), overlay_rotate180=COALESCE(?, overlay_rotate180), overlay_engine=COALESCE(?, overlay_engine),
              overlay_print_orientation=COALESCE(?, overlay_print_orientation),
              ui_panel=COALESCE(?, ui_panel), ui_header=COALESCE(?, ui_header), ui_header_dark=COALESCE(?, ui_header_dark), ui_line=COALESCE(?, ui_line), ui_surface=COALESCE(?, ui_surface),
              printer_thermal=COALESCE(?, printer_thermal), printer_canon=COALESCE(?, printer_canon),
              wa_mode=COALESCE(?, wa_mode),
              reports_dir=COALESCE(?, reports_dir),
              ${OVERLAY_NUM_FIELDS.map((f) => `${f}=COALESCE(?, ${f})`).join(', ')},
              ${FORM_NUM_FIELDS.map((f) => `${f}=COALESCE(?, ${f})`).join(', ')},
              ${SLIP_TEXT_FIELDS.map((f) => `${f}=COALESCE(?, ${f})`).join(', ')} WHERE id=1`,
      [
        rates.date,
        rates.rate_tezabi_tola,
        rates.parchi_charges,
        rates.fc_per_gram,
        rates.rate_tezabi_gram,
        rates.point,
        rates.slip_count != null ? rates.slip_count : 1,
        rates.raw_print_mode != null ? rates.raw_print_mode : null,
        rates.print_scale != null ? Number(rates.print_scale) : null,
        // print_mode clamped to a known value; anything unknown → 'thermal'.
        rates.print_mode != null ? (['overlay_form', 'thermal'].includes(rates.print_mode) ? rates.print_mode : 'thermal') : null,
        rates.form_paper != null ? (['A5', 'A4', 'Letter', 'custom'].includes(rates.form_paper) ? rates.form_paper : 'A5') : null,
        rates.form_template != null ? String(rates.form_template) : null,
        // Logo: '' (deliberately cleared → CSS gem) is saved; only undefined/null is skipped.
        rates.shop_logo_path != null ? String(rates.shop_logo_path) : null,
        // form_style: 'bw' | 'color' (anything else → 'bw'); undefined/null keeps stored.
        rates.form_style != null ? (rates.form_style === 'color' ? 'color' : 'bw') : null,
        // form_theme: accept an object (stringified here) or a ready JSON string;
        // undefined/null keeps the stored palette. form_footer: '' (cleared → line
        // hidden) is saved; only undefined/null is skipped.
        rates.form_theme != null ? (typeof rates.form_theme === 'string' ? rates.form_theme : JSON.stringify(rates.form_theme)) : null,
        rates.form_footer != null ? String(rates.form_footer) : null,
        // overlay_paper (only the known value for now), overlay_coords (JSON string
        // or object → stringified), overlay_bg_path (base64 data URL or path; ''
        // clears the scan). undefined/null keeps the stored value.
        rates.overlay_paper != null ? String(rates.overlay_paper) : null,
        rates.overlay_coords != null ? (typeof rates.overlay_coords === 'string' ? rates.overlay_coords : JSON.stringify(rates.overlay_coords)) : null,
        rates.overlay_bg_path != null ? String(rates.overlay_bg_path) : null,
        // Geometry/engine escape hatches. The two flags are stored 0/1 so they read
        // back as plain numbers; engine is clamped to the two known pipelines so a
        // stray value can never disable printing.
        rates.overlay_landscape != null ? (rates.overlay_landscape ? 1 : 0) : null,
        rates.overlay_rotate180 != null ? (rates.overlay_rotate180 ? 1 : 0) : null,
        rates.overlay_engine != null ? (rates.overlay_engine === 'driver' ? 'driver' : 'pdf') : null,
        // Spool orientation token, clamped to the three known values.
        rates.overlay_print_orientation != null ? (['auto', 'portrait', 'landscape'].includes(rates.overlay_print_orientation) ? rates.overlay_print_orientation : 'auto') : null,
        // Theme colours: a '#rrggbb' string is stored; '' clears back to the hex
        // default (the renderer treats '' like unset); undefined/null keeps stored.
        rates.ui_panel != null ? String(rates.ui_panel) : null,
        rates.ui_header != null ? String(rates.ui_header) : null,
        rates.ui_header_dark != null ? String(rates.ui_header_dark) : null,
        rates.ui_line != null ? String(rates.ui_line) : null,
        rates.ui_surface != null ? String(rates.ui_surface) : null,
        // Chosen printer device names ('' clears → default). undefined/null keeps stored.
        rates.printer_thermal != null ? String(rates.printer_thermal) : null,
        rates.printer_canon != null ? String(rates.printer_canon) : null,
        // WhatsApp route, clamped to a known value; anything unknown → 'auto'.
        rates.wa_mode != null ? (['auto', 'desktop', 'web'].includes(rates.wa_mode) ? rates.wa_mode : 'auto') : null,
        // Synced reports folder ('' clears → feature off). undefined/null keeps stored.
        rates.reports_dir != null ? String(rates.reports_dir) : null,
        ...OVERLAY_NUM_FIELDS.map((f) => (rates[f] != null && Number.isFinite(Number(rates[f])) ? Number(rates[f]) : null)),
        ...FORM_NUM_FIELDS.map((f) => (rates[f] != null && Number.isFinite(Number(rates[f])) ? Number(rates[f]) : null)),
        ...SLIP_TEXT_FIELDS.map((f) => (rates[f] != null ? String(rates[f]) : null))
      ]
    )
    return api.getRates()
  },

  // ── Unsaved-parchi DRAFTS (one row per in-progress parchi). Store ONLY JSON
  // snapshots of the composing form; completely separate from transactions/
  // receipts, so they NEVER affect totals, ledgers, or reports. listDrafts returns
  // RAW payload strings (the renderer parses each inside try/catch, so a corrupt/
  // tampered row is skipped without crashing). upsertDraft with seq == null INSERTs
  // a new draft and returns its seq; with a seq it UPDATEs that row.
  listDrafts() {
    return query('SELECT seq, payload FROM drafts ORDER BY seq ASC')
  },

  upsertDraft(seq, payload) {
    const json = typeof payload === 'string' ? payload : JSON.stringify(payload)
    if (seq == null) {
      run('INSERT INTO drafts (payload) VALUES (?)', [json])
      return { ok: true, seq: lastInsertId() }
    }
    // Identical payload → no UPDATE, so scheduleSave() is not armed and the whole
    // database is not re-exported to disk for a write that changes nothing. (The
    // renderer already skips most of these; this is the backstop for every other
    // caller.)
    const cur = query('SELECT payload FROM drafts WHERE seq = ?', [seq])
    if (cur.length && cur[0].payload === json) return { ok: true, seq }
    run('UPDATE drafts SET payload = ? WHERE seq = ?', [json, seq])
    return { ok: true, seq }
  },

  deleteDraft(seq) {
    if (seq == null) return { ok: true }
    run('DELETE FROM drafts WHERE seq = ?', [seq])
    return { ok: true }
  },

  clearDrafts() {
    run('DELETE FROM drafts')
    return { ok: true }
  },

  findCustomers(q) {
    if (!q || !q.trim()) {
      return query('SELECT * FROM customers ORDER BY name LIMIT 50')
    }
    const s = q.trim()
    const like = `%${s}%`
    const prefix = `${s}%`
    // Also match on a numeric id so users can search by record number.
    const idNum = /^\d+$/.test(s) ? Number(s) : -1
    // Rank NAME-prefix matches FIRST, then other (contains / mobile) matches, then
    // alphabetical. Without this a plain "%z%" ordered by name + LIMIT 50 could push
    // the "Zafer…" prefix hits the user actually wants past the 50-row cut-off in a
    // large customer list — so typing "z" showed nothing. (SQLite LIKE is
    // case-insensitive for ASCII, so 'z%' matches 'Zafer'.)
    return query(
      `SELECT * FROM customers
       WHERE name LIKE ? OR mobile LIKE ? OR id = ?
       ORDER BY (CASE WHEN name LIKE ? THEN 0 ELSE 1 END), name
       LIMIT 50`,
      [like, like, idNum, prefix]
    )
  },

  // The id the NEXT inserted customer will receive — for the ID preview only.
  // Reads SQLite's AUTOINCREMENT bookkeeping; never inserts. sqlite_sequence has
  // no row for a table until its first insert, so fall back to 1.
  peekNextCustomerId() {
    try {
      const r = query("SELECT seq FROM sqlite_sequence WHERE name = 'customers'")
      return r[0] && r[0].seq != null ? r[0].seq + 1 : 1
    } catch {
      return 1
    }
  },

  // Full saved-customer list (UNBOUNDED), ordered by name. Used ONLY by the main
  // screen's strict name-autocomplete cache, which must know EVERY saved name so a
  // customer late in the alphabet (past findCustomers('')'s 50-row cut-off) can
  // still have its first letter typed / be selected. findCustomers stays capped
  // for its search box + dropdown, so nothing else changes.
  listAllCustomers() {
    return query('SELECT * FROM customers ORDER BY name')
  },

  getCustomer(id) {
    const r = query('SELECT * FROM customers WHERE id = ?', [id])
    return r[0] || null
  },

  upsertCustomer(c) {
    // The form stores the picture as a base64 data URL. Accept either `image`
    // (DB/column name) or `imagePath` (older form field name) so both callers work.
    const image = c.image ?? c.imagePath ?? null
    if (c.id) {
      run('UPDATE customers SET name=?, mobile=?, address=?, image=? WHERE id=?', [
        c.name || '',
        c.mobile || '',
        c.address || '',
        image,
        c.id
      ])
      return api.getCustomer(c.id)
    }
    run('INSERT INTO customers (name, mobile, address, image, created_at) VALUES (?, ?, ?, ?, ?)', [
      c.name || '',
      c.mobile || '',
      c.address || '',
      image,
      new Date().toISOString()
    ])
    return api.getCustomer(lastInsertId())
  },

  getFirstCustomer() {
    const r = query('SELECT * FROM customers ORDER BY id ASC LIMIT 1')
    return r[0] || null
  },

  getLastCustomer() {
    const r = query('SELECT * FROM customers ORDER BY id DESC LIMIT 1')
    return r[0] || null
  },

  getNextCustomer(currentId) {
    if (currentId == null) return api.getFirstCustomer()
    const r = query('SELECT * FROM customers WHERE id > ? ORDER BY id ASC LIMIT 1', [currentId])
    return r[0] || null
  },

  getPrevCustomer(currentId) {
    if (currentId == null) return api.getLastCustomer()
    const r = query('SELECT * FROM customers WHERE id < ? ORDER BY id DESC LIMIT 1', [currentId])
    return r[0] || null
  },

  // Next parchi number = the LOWEST free positive integer across BOTH tables
  // (transactions AND receipts). Normally this is just MAX+1 (sequential, no
  // gaps), but when a receipt number has been FREED (see freeReceipt) it leaves a
  // gap, and that freed number is handed back for REUSE — intended in this single-
  // shop offline app. Unioning both tables (same source as nav) avoids handing
  // back a number that still exists in either.
  nextReceiptNo() {
    const rows = query(`SELECT DISTINCT rn FROM (${RECEIPT_NOS_SQL}) WHERE rn IS NOT NULL ORDER BY rn ASC`)
    const used = new Set(rows.map((r) => Number(r.rn)))
    let n = 1
    while (used.has(n)) n++
    return n
  },

  // Whether a receipt_no is already SAVED (has transactions or a receipt snapshot).
  // Used as a save-time guard so a brand-new parchi can never overwrite another.
  receiptNoExists(n) {
    if (n == null) return false
    const rows = query(`SELECT 1 FROM (${RECEIPT_NOS_SQL}) WHERE rn = ? LIMIT 1`, [n])
    return rows.length > 0
  },

  // ALL saved receipt numbers (distinct, ascending). Read-only — feeds the
  // renderer's merged ◀/▶ navigation timeline (saved receipts + unsaved drafts,
  // ONE order by parchi number), which needs the full set rather than a single
  // gap-tolerant neighbour like getNextReceiptNo/getPrevReceiptNo.
  listReceiptNos() {
    const rows = query(`SELECT DISTINCT rn FROM (${RECEIPT_NOS_SQL}) WHERE rn IS NOT NULL ORDER BY rn ASC`)
    return rows.map((r) => Number(r.rn))
  },

  // FREE a receipt number: delete every row under it (transactions + receipts) so
  // nothing remains and the number becomes available for reuse. Atomic. This is
  // STEP 2 of "parchi free" — only called when a parchi has no customer AND no
  // entries. Flushed so the freeing persists across restart.
  freeReceipt(receiptNo) {
    if (receiptNo == null) return { ok: false, message: 'receipt_no required' }
    let removedTxns = 0
    try {
      const c = query('SELECT COUNT(*) AS c FROM transactions WHERE receipt_no = ?', [receiptNo])
      removedTxns = (c[0] && c[0].c) || 0
      db.run('BEGIN')
      db.run('DELETE FROM transactions WHERE receipt_no = ?', [receiptNo])
      db.run('DELETE FROM receipts WHERE receipt_no = ?', [receiptNo])
      db.run('COMMIT')
    } catch (e) {
      try { db.run('ROLLBACK') } catch { /* ignore */ }
      console.error('freeReceipt failed:', e)
      return { ok: false, message: String(e && e.message ? e.message : e) }
    }
    flush()
    return { ok: true, receipt_no: receiptNo, removedTxns }
  },

  // ── Parchi navigation (First / Last / Next / Prev) ──────────────────────────
  // A saved parchi's receipt_no can live in `receipts` (full snapshot), in
  // `transactions` (ledger line-items), or both, so every query unions the two.
  // Numbering can have GAPS after deletions, so Next/Prev are relative ("next
  // existing receipt_no", not current±1). All return null when there's no match.
  getFirstReceiptNo() {
    const r = query(`SELECT MIN(rn) AS n FROM (${RECEIPT_NOS_SQL})`)
    return r[0] && r[0].n != null ? r[0].n : null
  },

  getLastReceiptNo() {
    const r = query(`SELECT MAX(rn) AS n FROM (${RECEIPT_NOS_SQL})`)
    return r[0] && r[0].n != null ? r[0].n : null
  },

  getNextReceiptNo(current) {
    if (current == null) return api.getFirstReceiptNo()
    const r = query(`SELECT MIN(rn) AS n FROM (${RECEIPT_NOS_SQL}) WHERE rn > ?`, [current])
    return r[0] && r[0].n != null ? r[0].n : null
  },

  getPrevReceiptNo(current) {
    if (current == null) return api.getLastReceiptNo()
    const r = query(`SELECT MAX(rn) AS n FROM (${RECEIPT_NOS_SQL}) WHERE rn < ?`, [current])
    return r[0] && r[0].n != null ? r[0].n : null
  },

  // One-time fresh start: wipe all transactions + receipts and reset AUTOINCREMENT
  // so the next parchi is receipt_no 1. Customers (names) are kept. Intended,
  // destructive — only called from the explicit "reset data" path.
  resetTransactions() {
    run('DELETE FROM transactions')
    run('DELETE FROM receipts')
    run("DELETE FROM sqlite_sequence WHERE name IN ('transactions','receipts')")
    return { ok: true, nextReceiptNo: 1 }
  },

  // Load a saved parchi by its receipt number (for the StatusBar receipt search).
  // A parchi is stored two ways, both keyed by receipt_no:
  //   1. receipts.payload — a full JSON snapshot of the parchi (purity input +
  //      overrides + rates + نقد/ادھار entries + customer). This is the source of
  //      truth for reconstructing the parchi EXACTLY as saved.
  //   2. transactions   — the individual ledger line-items (used for balances).
  // We prefer the payload when present, and always also return the transaction
  // rows so old parchis (saved before payloads existed) still reload their
  // line-items. Returns null only when neither exists.
  getReceiptByNo(receiptNo) {
    const rows = query(
      `SELECT t.*, c.name AS customer_name, c.mobile AS customer_mobile
       FROM transactions t LEFT JOIN customers c ON c.id = t.customer_id
       WHERE t.receipt_no = ? ORDER BY t.id ASC`,
      [receiptNo]
    )
    // Newest saved snapshot for this receipt_no, if any.
    const recs = query(
      'SELECT * FROM receipts WHERE receipt_no = ? ORDER BY id DESC LIMIT 1',
      [receiptNo]
    )

    if (recs.length) {
      const rec = recs[0]
      let payload = {}
      try { payload = JSON.parse(rec.payload || '{}') } catch { payload = {} }
      const first = rows[0]
      return {
        receipt_no: receiptNo,
        date: rec.date || (first && first.date) || null,
        customer_id: rec.customer_id,
        customer: payload.customer ||
          (first ? { id: first.customer_id, name: first.customer_name, mobile: first.customer_mobile } : null),
        payload,
        rows
      }
    }

    if (!rows.length) return null
    const first = rows[0]
    return {
      receipt_no: receiptNo,
      date: first.date,
      customer_id: first.customer_id,
      customer: { id: first.customer_id, name: first.customer_name, mobile: first.customer_mobile },
      rows
    }
  },

  // Filtered customer report. Filter by customer (id preferred, else name LIKE),
  // date range (date BETWEEN from AND to), and optional category. Rows are ordered
  // by date, receipt_no. Totals reuse getCustomerLedger's EXACT sign logic
  // (out = +1 the customer owes us, in = -1) so a report's totals equal the
  // ledger balance for the same customer/period.
  getReport(opts = {}) {
    const { customerId, name, from, to, category } = opts || {}
    const where = []
    const params = []
    if (customerId != null && customerId !== '') { where.push('t.customer_id = ?'); params.push(customerId) }
    else if (name && String(name).trim()) { where.push(NAME_PREFIX_SQL); params.push(namePrefixLike(name)) }
    if (from) { where.push('t.date >= ?'); params.push(from) }
    if (to) { where.push('t.date <= ?'); params.push(to) }
    if (category) { where.push('t.category = ?'); params.push(category) }
    where.push("t.category <> 'adjustment'") // manual اندراج never shows in reports
    const rows = query(
      `SELECT t.*, c.name AS customer_name
       FROM transactions t LEFT JOIN customers c ON c.id = t.customer_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY t.date ASC, t.receipt_no ASC, t.id ASC`,
      params
    )
    let total_gold = 0
    let total_cash = 0
    for (const t of rows) {
      const sign = t.direction === 'out' ? 1 : -1
      if (t.category === 'gold_give' || t.category === 'gold_take') total_gold += sign * (t.khalis_sona || 0)
      if (t.category === 'cash_give' || t.category === 'cash_take') total_cash += sign * (t.cash_amount || 0)
    }
    return { rows, total_gold, total_cash }
  },

  // اندراج رپورٹ — the ONE place manual adjustments (category 'adjustment') are
  // shown; every other report/ledger excludes them. Returns adjustment rows only,
  // newest first, optionally within a date range. cash_amount = رقم لی/دی amount,
  // khalis_sona = تیزابی لیا/دیا grams; direction 'in'/'out' gives the sign.
  getAdjustmentsReport(opts = {}) {
    const { from, to } = opts || {}
    const where = ["category = 'adjustment'"]
    const params = []
    if (from) { where.push('date >= ?'); params.push(from) }
    if (to) { where.push('date <= ?'); params.push(to) }
    const rows = query(
      `SELECT id, date, ts, direction, cash_amount, khalis_sona, note
       FROM transactions WHERE ${where.join(' AND ')} ORDER BY date DESC, id DESC`,
      params
    )
    return { rows }
  },

  // Group-1 (balance style) report: one aggregated row PER CUSTOMER for a single
  // category, with NO date filter. Optional customer (id or name) narrows to one.
  // total_khalis / total_cash are the summed amounts (a category is single-
  // direction, so the sum equals the magnitude of that customer's ledger
  // contribution for it). Empty/null-safe.
  reportGroup1(opts = {}) {
    const { category, customerId, name } = opts || {}
    const where = ['t.category = ?']
    const params = [category]
    if (customerId != null && customerId !== '') { where.push('t.customer_id = ?'); params.push(customerId) }
    else if (name && String(name).trim()) { where.push(NAME_PREFIX_SQL); params.push(namePrefixLike(name)) }
    const rows = query(
      `SELECT t.customer_id, c.name AS customer_name,
              SUM(COALESCE(t.khalis_sona, 0)) AS total_khalis,
              SUM(COALESCE(t.cash_amount, 0)) AS total_cash,
              MAX(t.date) AS date,
              MAX(t.updated_at) AS updated_at,
              COUNT(*) AS cnt
       FROM transactions t LEFT JOIN customers c ON c.id = t.customer_id
       WHERE ${where.join(' AND ')}
       GROUP BY t.customer_id, c.name
       ORDER BY c.name ASC`,
      params
    )
    let total_gold = 0
    let total_cash = 0
    for (const r of rows) {
      total_gold += Number(r.total_khalis) || 0
      total_cash += Number(r.total_cash) || 0
    }
    return { rows, total_gold, total_cash }
  },

  // ── NET balance reports for the four GROUP1 buttons ────────────────────────
  // (تیزابی لینا ہے / تیزابی دینا ہے / رقم لینی ہے / رقم دینی ہے)
  // reportGroup1 sums ONE category and never nets give against take — a customer
  // who took 5g and returned 4.65g still showed 5g under لینا. These net the
  // PAIR per customer in ONE SQL pass, with the sign convention copied from
  // getCustomerLedger: sign = direction 'out' ? +1 : -1 (positive net = the
  // customer owes the shop). side 'lena' keeps nets > +EPS, 'dena' keeps nets
  // < -EPS and returns the magnitude. Amounts come back under the SAME field
  // names reportGroup1 used (total_khalis / total_cash) so the existing report
  // columns work unchanged. EPS kills float-dust ghost rows; a settled (zero)
  // customer appears in NEITHER list. reportGroup1 itself stays untouched.
  _netBalanceReport({ side, opts, cats, col, out, eps, round }) {
    const { customerId, name } = opts || {}
    const where = [`t.category IN ('${cats[0]}','${cats[1]}')`]
    const params = []
    if (customerId != null && customerId !== '') { where.push('t.customer_id = ?'); params.push(customerId) }
    else if (name && String(name).trim()) { where.push(NAME_PREFIX_SQL); params.push(namePrefixLike(name)) }
    const raw = query(
      // c.mobile rides along for the واٹس ایپ یاد دہانی button on the "لینا ہے"
      // reports. It is per-customer, so adding it to GROUP BY splits nothing that
      // wasn't already split by customer_id — the groups, the netting, eps, the
      // ordering and the totals below are all exactly as before.
      `SELECT t.customer_id, c.name AS customer_name, c.mobile AS mobile,
              SUM((CASE WHEN t.direction = 'out' THEN 1 ELSE -1 END) * COALESCE(t.${col}, 0)) AS net,
              MAX(t.date) AS date,
              MAX(t.updated_at) AS updated_at,
              COUNT(*) AS cnt
       FROM transactions t LEFT JOIN customers c ON c.id = t.customer_id
       WHERE ${where.join(' AND ')}
       GROUP BY t.customer_id, c.name, c.mobile
       ORDER BY c.name ASC`,
      params
    )
    const rows = []
    let total = 0
    for (const r of raw) {
      const net = Number(r.net) || 0
      if (side === 'lena' ? net <= eps : net >= -eps) continue
      const amount = round(Math.abs(net))
      rows.push({
        customer_id: r.customer_id,
        customer_name: r.customer_name,
        mobile: r.mobile, // یاد دہانی button only; no report column reads it
        [out]: amount,
        date: r.date,
        updated_at: r.updated_at,
        cnt: r.cnt
      })
      total += amount
    }
    return {
      rows,
      total_gold: out === 'total_khalis' ? total : 0,
      total_cash: out === 'total_cash' ? total : 0
    }
  },

  // side = 'lena' (net > 0: customer owes gold) | 'dena' (net < 0: shop owes)
  reportGoldBalanceNet(side, opts = {}) {
    return api._netBalanceReport({
      side,
      opts,
      cats: ['gold_give', 'gold_take'],
      col: 'khalis_sona',
      out: 'total_khalis',
      eps: 0.0005, // grams
      round: (v) => Math.round(v * 1000) / 1000 // 3dp — no float-dust in the list
    })
  },

  reportCashBalanceNet(side, opts = {}) {
    return api._netBalanceReport({
      side,
      opts,
      cats: ['cash_give', 'cash_take'],
      col: 'cash_amount',
      out: 'total_cash',
      eps: 0.5, // rupees — display rounding stays with fmtMoney
      round: (v) => v
    })
  },

  // "کچا سونا لیا" report — ONE ROW PER kacha_gold_take TRANSACTION (per-entry, NO
  // per-customer aggregation). A customer with N kacha parchis appears in N rows,
  // each showing that single entry's own values, read ENTIRELY from that record
  // (category = 'kacha_gold_take' ONLY, so gold_take etc. never leak in). Columns:
  //   نام       = customer_name    (that entry's customer)
  //   کچا سونا  = sona_wazan        (that entry's raw scale weight, وزن کانٹے پر)
  //   خالص سونا = khalis_sona       (that entry's ticked-پرچی-row khalis)
  //   سونا دیا  = sona_diya         (that entry's gold given)
  //   کیش دیا   = cash_diya         (that entry's cash given)
  // t.id is selected for stable row keys + ordering only (NOT a visible column).
  // Optional customer (id preferred, else name LIKE) and optional date range; the
  // TOTAL is summed over exactly the rows returned. Ordered by date then id.
  // Reset ONLY the کچا سونا لیا data → the report starts empty (total 0). Deletes
  // every kacha_gold_take transaction, and the receipts that belong to kacha
  // entries but are NOT shared with any other transaction type (so a parchi that
  // also carried نقد/ادھار keeps its receipt + those rows). Other transactions
  // (تیزابی / نقد / ادھار cash / expenses) and their receipts are untouched.
  // Atomic (BEGIN/COMMIT, ROLLBACK on error); flushed so it survives restart.
  resetKachaGold() {
    let removedTxns = 0
    let removedReceipts = 0
    try {
      const before = query("SELECT COUNT(*) AS c FROM transactions WHERE category = 'kacha_gold_take'")
      removedTxns = (before[0] && before[0].c) || 0
      db.run('BEGIN')
      // Delete purely-kacha receipts FIRST (while kacha rows still exist so the
      // subquery can find their receipt_no's). "Purely kacha" = used by a kacha
      // entry AND by no non-kacha transaction.
      const recBefore = query(
        `SELECT COUNT(*) AS c FROM receipts WHERE receipt_no IN (
            SELECT receipt_no FROM transactions WHERE category = 'kacha_gold_take'
         ) AND receipt_no NOT IN (
            SELECT receipt_no FROM transactions WHERE category <> 'kacha_gold_take'
         )`
      )
      removedReceipts = (recBefore[0] && recBefore[0].c) || 0
      db.run(
        `DELETE FROM receipts WHERE receipt_no IN (
            SELECT receipt_no FROM transactions WHERE category = 'kacha_gold_take'
         ) AND receipt_no NOT IN (
            SELECT receipt_no FROM transactions WHERE category <> 'kacha_gold_take'
         )`
      )
      db.run("DELETE FROM transactions WHERE category = 'kacha_gold_take'")
      // Records are gone, so clear the counter baseline too (keeps the display at 0
      // rather than going negative against a stale baseline).
      db.run('UPDATE settings SET kacha_baseline = 0 WHERE id = 1')
      db.run('COMMIT')
    } catch (e) {
      try { db.run('ROLLBACK') } catch { /* ignore */ }
      console.error('resetKachaGold failed:', e)
      return { ok: false, message: String(e && e.message ? e.message : e) }
    }
    flush() // persist immediately (not just the debounced save)
    return { ok: true, removedTxns, removedReceipts }
  },

  // Reset ONLY the bottom-bar کچا سونا COUNTER (display) to zero — WITHOUT deleting
  // any کچا سونا لیا record. Stores the current raw kacha sum as the baseline so
  // getShopTotals shows (sum − baseline) = 0 now, while the اُدھار report keeps
  // every record intact. New کچا سونا after this still accumulates from zero.
  resetKachaCounter() {
    try {
      const r = query("SELECT COALESCE(SUM(sona_wazan), 0) AS s FROM transactions WHERE category = 'kacha_gold_take'")
      const sum = r[0] ? (Number(r[0].s) || 0) : 0
      db.run('UPDATE settings SET kacha_baseline = ? WHERE id = 1', [sum])
    } catch (e) {
      console.error('resetKachaCounter failed:', e)
      return { ok: false, message: String(e && e.message ? e.message : e) }
    }
    flush()
    return { ok: true, kacha_sona: 0 }
  },

  // READ-ONLY: sum of کچا سونا (وزن کانٹے پر) recorded on a given date. Feeds the
  // bottom-bar "کچا سونا" display total for the current day. Touches nothing.
  getKachaTotalForDate(date) {
    const r = query(
      "SELECT COALESCE(SUM(sona_wazan), 0) AS s FROM transactions WHERE category = 'kacha_gold_take' AND date = ?",
      [date]
    )
    return r[0] ? (Number(r[0].s) || 0) : 0
  },

  reportKachaGold(opts = {}) {
    const { customerId, name, from, to } = opts || {}
    const where = ["t.category = 'kacha_gold_take'"]
    const params = []
    if (customerId != null && customerId !== '') { where.push('t.customer_id = ?'); params.push(customerId) }
    else if (name && String(name).trim()) { where.push(NAME_PREFIX_SQL); params.push(namePrefixLike(name)) }
    if (from) { where.push('t.date >= ?'); params.push(from) }
    if (to) { where.push('t.date <= ?'); params.push(to) }
    const rows = query(
      `SELECT t.id, t.receipt_no, t.customer_id, c.name AS customer_name,
              COALESCE(t.sona_wazan, 0)  AS kacha_sona,
              COALESCE(t.khalis_sona, 0) AS khalis_sona,
              COALESCE(t.sona_diya, 0)   AS sona_diya,
              COALESCE(t.cash_diya, 0)   AS cash_diya
       FROM transactions t LEFT JOIN customers c ON c.id = t.customer_id
       WHERE ${where.join(' AND ')}
       ORDER BY t.date ASC, t.id ASC`,
      params
    )
    const totals = { kacha_sona: 0, khalis_sona: 0, sona_diya: 0, cash_diya: 0 }
    for (const r of rows) {
      totals.kacha_sona += Number(r.kacha_sona) || 0
      totals.khalis_sona += Number(r.khalis_sona) || 0
      totals.sona_diya += Number(r.sona_diya) || 0
      totals.cash_diya += Number(r.cash_diya) || 0
    }
    return { rows, totals }
  },

  addTransaction(t) {
    run(
      `INSERT INTO transactions
        (receipt_no, customer_id, date, ts, kind, direction, category,
         sona_wazan, point, khalis_sona, rate, qeemat, cash_amount, sona_diya, cash_diya, updated_at, note, meta)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        t.receipt_no,
        t.customer_id || null,
        t.date,
        t.ts || new Date().toISOString(),
        t.kind,
        t.direction || null,
        t.category,
        t.sona_wazan || 0,
        t.point || 0,
        t.khalis_sona || 0,
        t.rate || 0,
        t.qeemat || 0,
        t.cash_amount || 0,
        t.sona_diya || 0,
        t.cash_diya || 0,
        t.updated_at || t.date || todayISO(), // fresh rows carry their entry date
        t.note || '',
        t.meta ? JSON.stringify(t.meta) : null
      ]
    )
    flush() // immediate persist: close the ~200ms debounce data-loss window
    return { id: lastInsertId() }
  },

  // Manual balance adjustment (دستی اندراج) — a ONE-SHOT transaction that nudges
  // the bottom-bar کیش (cash) or تیزابی (gold) total by a fixed amount. category
  // 'adjustment' is applied ONLY by getShopTotals and is EXCLUDED from every
  // ledger / report / listing, so it can never re-apply or leak into a customer's
  // account. No customer, no receipt. target 'cash' → cash_amount, 'gold' →
  // khalis_sona; direction 'in' adds to the total, 'out' subtracts.
  addAdjustment(a = {}) {
    const target = a.target === 'gold' ? 'gold' : 'cash'
    const direction = a.direction === 'out' ? 'out' : 'in'
    const amount = Number(a.amount) || 0
    if (!(amount > 0)) return { ok: false, message: 'amount must be positive' }
    run(
      `INSERT INTO transactions
        (receipt_no, customer_id, date, ts, kind, direction, category,
         sona_wazan, point, khalis_sona, rate, qeemat, cash_amount, sona_diya, cash_diya, updated_at, note, meta)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        null, null, todayISO(), new Date().toISOString(), 'adjustment', direction, 'adjustment',
        0, 0, target === 'gold' ? amount : 0, 0, 0, target === 'cash' ? amount : 0, 0, 0,
        todayISO(), a.note || 'دستی اندراج', null
      ]
    )
    flush() // immediate persist: adjustments must survive a restart
    return { ok: true, id: lastInsertId(), target, direction, amount }
  },

  // Edit an existing transaction by id (Part 1). Only whitelisted columns can be
  // changed. Missing/unknown id is a graceful no-op.
  updateTransaction(id, fields = {}) {
    if (id == null) return { ok: false }
    const allowed = ['customer_id', 'date', 'category', 'direction', 'kind',
      'khalis_sona', 'cash_amount', 'sona_wazan', 'point', 'rate', 'qeemat', 'note']
    const sets = []
    const params = []
    for (const k of allowed) {
      if (Object.prototype.hasOwnProperty.call(fields, k)) { sets.push(`${k} = ?`); params.push(fields[k]) }
    }
    if (fields.meta !== undefined) { sets.push('meta = ?'); params.push(fields.meta ? JSON.stringify(fields.meta) : null) }
    if (!sets.length) return { ok: true, unchanged: true }
    // Stamp the last-edit date (yyyy-mm-dd) so the balance report's تاریخ column
    // shows when the row was last updated.
    sets.push('updated_at = ?'); params.push(todayISO())
    params.push(id)
    run(`UPDATE transactions SET ${sets.join(', ')} WHERE id = ?`, params)
    flush() // immediate persist: close the ~200ms debounce data-loss window
    return { ok: true, id }
  },

  // Delete a transaction by id (Part 1). Missing id is a graceful no-op.
  deleteTransaction(id) {
    if (id == null) return { ok: false }
    run('DELETE FROM transactions WHERE id = ?', [id])
    flush() // immediate persist: close the ~200ms debounce data-loss window
    return { ok: true, id }
  },

  // ── Expenses (اخراجات) ──────────────────────────────────────────────────────
  // Add an expense. Stores amount, comment, date (YYYY-MM-DD) and ts = full ISO
  // timestamp (date + time) of the moment it is recorded.
  addExpense(e = {}) {
    const ts = new Date().toISOString()
    run('INSERT INTO expenses (amount, comment, date, ts) VALUES (?, ?, ?, ?)', [
      Number(e.amount) || 0,
      e.comment || '',
      e.date,
      ts
    ])
    return { id: lastInsertId(), ts }
  },

  // Edit a single expense by id. Only amount / comment / date may change; ts (the
  // originally recorded time) is left untouched. Flushed so it persists. Missing
  // id is a graceful no-op.
  updateExpense(id, fields = {}) {
    if (id == null) return { ok: false }
    const allowed = ['amount', 'comment', 'date']
    const sets = []
    const params = []
    for (const k of allowed) {
      if (Object.prototype.hasOwnProperty.call(fields, k)) {
        sets.push(`${k} = ?`)
        params.push(k === 'amount' ? (Number(fields[k]) || 0) : fields[k])
      }
    }
    if (!sets.length) return { ok: true, unchanged: true }
    params.push(id)
    run(`UPDATE expenses SET ${sets.join(', ')} WHERE id = ?`, params)
    flush()
    return { ok: true, id }
  },

  // Delete a single expense by id. Flushed so it persists. Missing id = no-op.
  deleteExpense(id) {
    if (id == null) return { ok: false }
    run('DELETE FROM expenses WHERE id = ?', [id])
    flush()
    return { ok: true, id }
  },

  // Delete ALL expenses (fresh start) and reset the id sequence so ids restart at
  // 1. Only the expenses table is touched — transactions/receipts/ledger untouched.
  // Flushed so it persists across restart.
  resetExpenses() {
    let removed = 0
    try {
      const c = query('SELECT COUNT(*) AS c FROM expenses')
      removed = (c[0] && c[0].c) || 0
      db.run('BEGIN')
      db.run('DELETE FROM expenses')
      db.run("DELETE FROM sqlite_sequence WHERE name = 'expenses'")
      db.run('COMMIT')
    } catch (e) {
      try { db.run('ROLLBACK') } catch { /* ignore */ }
      console.error('resetExpenses failed:', e)
      return { ok: false, message: String(e && e.message ? e.message : e) }
    }
    flush()
    return { ok: true, removed }
  },

  // READ-ONLY: sum of expense amounts on a given date. Kept for any per-day
  // callers; the bottom-bar cash DISPLAY now uses getExpensesTotalUpTo instead
  // (expenses must reduce cash permanently, not just on their entry day). Touches nothing.
  getExpensesTotalForDate(date) {
    const r = query('SELECT COALESCE(SUM(amount), 0) AS s FROM expenses WHERE date = ?', [date])
    return r[0] ? (Number(r[0].s) || 0) : 0
  },

  // READ-ONLY: sum of ALL expense amounts up to AND INCLUDING the given date.
  // Feeds the bottom-bar cash DISPLAY (cash − every expense so far), so an expense
  // stays subtracted after the settings date rolls forward. Touches nothing.
  getExpensesTotalUpTo(date) {
    const r = query('SELECT COALESCE(SUM(amount), 0) AS s FROM expenses WHERE date <= ?', [date])
    return r[0] ? (Number(r[0].s) || 0) : 0
  },

  // Expenses within an inclusive date range, ordered by ts (so same-day entries
  // sort by time), then id. From/To are normalised so the smaller date is "from"
  // even if the user enters them reversed. Empty/null-safe.
  getExpenses(fromDate, toDate) {
    let from = fromDate || null
    let to = toDate || null
    if (from && to && String(from) > String(to)) { const t = from; from = to; to = t }
    const where = []
    const params = []
    if (from) { where.push('date >= ?'); params.push(from) }
    if (to) { where.push('date <= ?'); params.push(to) }
    const rows = query(
      `SELECT * FROM expenses ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ts ASC, id ASC`,
      params
    )
    return rows.map((r) => ({ ...r, amount: Number(r.amount) || 0 }))
  },

  // ── نیا سودا ────────────────────────────────────────────────────────────────
  // Deals list — its own tables only; never touches the transactions ledger,
  // customer balances, or any existing report. receipt_no tags the entry with the
  // parchi it was saved under (nullable).
  addNayaSoda(r = {}) {
    const ts = new Date().toISOString()
    run(
      `INSERT INTO naya_soda (name, rate, wazan, type, date, status, receipt_no, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        r.name || '',
        Number(r.rate) || 0,
        Number(r.wazan) || 0,
        r.type === 'farokht' ? 'farokht' : 'khareed',
        r.date || todayISO(),
        'bakaya',
        (r.receipt_no != null && Number.isFinite(Number(r.receipt_no))) ? Number(r.receipt_no) : null,
        ts
      ]
    )
    return { id: lastInsertId(), ts }
  },

  // ── نیا سودا per-receipt draft (in-progress, unsaved form values) ────────────
  // Read this parchi's saved-in-progress نیا سودا form values (or null). Pure
  // scratch — nothing else reads it.
  getNayaSodaDraft(receiptNo) {
    if (receiptNo == null) return null
    const rows = query('SELECT payload FROM naya_soda_draft WHERE receipt_no = ?', [Number(receiptNo)])
    if (!rows.length) return null
    try { return JSON.parse(rows[0].payload || '{}') } catch { return null }
  },

  // Upsert this parchi's in-progress form values (one row per receipt_no).
  saveNayaSodaDraft(receiptNo, form = {}) {
    if (receiptNo == null) return { ok: false }
    run(
      'INSERT OR REPLACE INTO naya_soda_draft (receipt_no, payload, updated_at) VALUES (?, ?, ?)',
      [Number(receiptNo), JSON.stringify(form || {}), new Date().toISOString()]
    )
    return { ok: true }
  },

  // Drop this parchi's draft (on save or when the form is emptied).
  clearNayaSodaDraft(receiptNo) {
    if (receiptNo == null) return { ok: false }
    // Nothing stored for this parchi → skip the DELETE, so no database re-export is
    // scheduled for a row that never existed (the common case while navigating).
    const rows = query('SELECT 1 AS x FROM naya_soda_draft WHERE receipt_no = ? LIMIT 1', [Number(receiptNo)])
    if (!rows.length) return { ok: true }
    run('DELETE FROM naya_soda_draft WHERE receipt_no = ?', [Number(receiptNo)])
    return { ok: true }
  },

  // Rows of one status ('bhugtan' | 'bakaya'), newest first. Optional from/to
  // (YYYY-MM-DD) filter on the `date` column — inclusive; empty = no bound.
  listNayaSoda(status, from, to) {
    const where = ['status = ?']
    const params = [status || 'bhugtan']
    if (from) { where.push('date >= ?'); params.push(from) }
    if (to) { where.push('date <= ?'); params.push(to) }
    const rows = query(`SELECT * FROM naya_soda WHERE ${where.join(' AND ')} ORDER BY id DESC`, params)
    return rows.map((r) => ({ ...r, rate: Number(r.rate) || 0, wazan: Number(r.wazan) || 0 }))
  },

  // Move one row between بھگتان and بقایا. Flushed so it persists. Missing id = no-op.
  setNayaSodaStatus(id, status) {
    if (id == null) return { ok: false }
    run('UPDATE naya_soda SET status = ? WHERE id = ?', [status === 'bakaya' ? 'bakaya' : 'bhugtan', id])
    flush()
    return { ok: true, id }
  },

  // Delete a single سودا row by id. Flushed so it persists. Missing id = no-op.
  deleteNayaSoda(id) {
    if (id == null) return { ok: false }
    run('DELETE FROM naya_soda WHERE id = ?', [id])
    flush()
    return { ok: true, id }
  },

  // Record a settlement / return (Part 2). A settle is a NORMAL transaction in
  // the opposite direction for the same customer — the original parchi is never
  // touched. It is tagged (note + meta.settle) so reports can identify it, and it
  // adjusts the customer's balance purely through getCustomerLedger's sign sums.
  settleTransaction(t) {
    const meta = Object.assign({ settle: true }, t.meta || {})
    return api.addTransaction({ ...t, note: t.note || 'قسط/واپسی', meta })
  },

  saveReceipt(r) {
    run(
      `INSERT INTO receipts (receipt_no, type, customer_id, date, ts, payload)
       VALUES (?,?,?,?,?,?)`,
      [
        r.receipt_no,
        r.type,
        r.customer_id || null,
        r.date,
        r.ts || new Date().toISOString(),
        JSON.stringify(r.payload || {})
      ]
    )
    return { id: lastInsertId() }
  },

  // Save a parchi with UPSERT semantics: one receipt_no always maps to exactly
  // one current version. We DELETE every prior row for that receipt_no (both the
  // header/payload and its transaction line-items) and INSERT the current ones,
  // all inside a single BEGIN/COMMIT so it is atomic (never half-deleted). This is
  // what makes editing work: removed entries stay removed, changed values replace
  // old ones, and no duplicate/stale rows accumulate. New parchis just find
  // nothing to delete. Reuses the SAME receipt_no passed in (edits don't renumber).
  replaceReceipt({ receipt: r = {}, transactions = [] } = {}) {
    const rno = r.receipt_no
    if (rno == null) return { ok: false, message: 'receipt_no required' }
    const nowIso = new Date().toISOString()
    try {
      db.run('BEGIN')
      db.run('DELETE FROM transactions WHERE receipt_no = ?', [rno])
      db.run('DELETE FROM receipts WHERE receipt_no = ?', [rno])
      db.run(
        `INSERT INTO receipts (receipt_no, type, customer_id, date, ts, payload)
         VALUES (?,?,?,?,?,?)`,
        [rno, r.type || 'parchi', r.customer_id || null, r.date, r.ts || nowIso, JSON.stringify(r.payload || {})]
      )
      for (const t of transactions) {
        db.run(
          `INSERT INTO transactions
            (receipt_no, customer_id, date, ts, kind, direction, category,
             sona_wazan, point, khalis_sona, rate, qeemat, cash_amount, sona_diya, cash_diya, updated_at, note, meta)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            rno,
            t.customer_id || null,
            t.date || r.date,
            t.ts || nowIso,
            t.kind,
            t.direction || null,
            t.category,
            t.sona_wazan || 0,
            t.point || 0,
            t.khalis_sona || 0,
            t.rate || 0,
            t.qeemat || 0,
            t.cash_amount || 0,
            t.sona_diya || 0,
            t.cash_diya || 0,
            t.updated_at || t.date || r.date || todayISO(),
            t.note || '',
            t.meta ? JSON.stringify(t.meta) : null
          ]
        )
      }
      db.run('COMMIT')
    } catch (e) {
      try { db.run('ROLLBACK') } catch { /* ignore */ }
      console.error('replaceReceipt failed:', e)
      return { ok: false, message: String(e && e.message ? e.message : e) }
    }
    flush() // immediate persist: close the ~200ms debounce data-loss window
    return { ok: true, receipt_no: rno, count: transactions.length }
  },

  // beforeReceiptNo (optional): count ONLY the parchis numbered BEFORE this one —
  // which is exactly the ادھار receipt's سابقہ ("what this customer owed before this
  // parchi"). It used to derive that as (full balance − the on-screen form's net),
  // which quietly assumed the ledger already held what the form shows. It does not,
  // the moment you type an entry onto a parchi that is already saved: the ledger has
  // no such row yet, the subtraction ran backwards, and سابقہ went NEGATIVE on a
  // customer's very first receipt (چاندی دی 34 → سابقہ −34). Worse, on an OLD parchi
  // the live total still contained every LATER parchi, so سابقہ drifted every time
  // the customer paid again — the printed paper and the screen stopped agreeing.
  //
  // "Before", not "any other parchi": navigating BACK to parchi 1 must still show no
  // سابقہ even once parchi 2 exists — a later parchi is not history. Rows with no
  // receipt_no are kept (they belong to no parchi, so this one never owns them).
  // Called with no second argument (statements, customer list) it is unchanged.
  getCustomerLedger(customerId, beforeReceiptNo) {
    // manual اندراج rows carry no customer_id, but exclude by category too for safety.
    const before = Number(beforeReceiptNo)
    const hasBefore = Number.isFinite(before)
    const txns = query(
      `SELECT * FROM transactions WHERE customer_id = ? AND category <> 'adjustment'
       ${hasBefore ? 'AND (receipt_no IS NULL OR receipt_no < ?)' : ''} ORDER BY ts ASC, id ASC`,
      hasBefore ? [customerId, before] : [customerId]
    )
    let gold = 0
    let cash = 0
    const rows = txns.map((t) => {
      // direction 'out' = shop gave to customer (customer owes), 'in' = received
      const sign = t.direction === 'out' ? 1 : -1
      if (t.category === 'gold_give' || t.category === 'gold_take') {
        gold += sign * (t.khalis_sona || 0)
      }
      if (t.category === 'cash_give' || t.category === 'cash_take') {
        cash += sign * (t.cash_amount || 0)
      }
      return { ...t, balance_gold: gold, balance_cash: cash }
    })
    return { rows, balance_gold: gold, balance_cash: cash }
  },

  // Just the two BALANCE figures getCustomerLedger ends up with — no rows. The
  // نقد/ادھار panel and the ادھار receipt both display only balance_gold /
  // balance_cash, but were pulling that customer's ENTIRE transaction history
  // across IPC (twice, on every parchi navigation) to get them. Same customer,
  // same exclusions, same signs as getCustomerLedger — summed by SQLite instead —
  // so the numbers are identical to the ledger's, by construction.
  getCustomerBalance(customerId, beforeReceiptNo) {
    const before = Number(beforeReceiptNo)
    const hasBefore = Number.isFinite(before)
    const rows = query(
      `SELECT
         COALESCE(SUM(CASE WHEN category IN ('gold_give','gold_take')
              THEN (CASE WHEN direction = 'out' THEN 1 ELSE -1 END) * COALESCE(khalis_sona, 0) ELSE 0 END), 0) AS balance_gold,
         COALESCE(SUM(CASE WHEN category IN ('cash_give','cash_take')
              THEN (CASE WHEN direction = 'out' THEN 1 ELSE -1 END) * COALESCE(cash_amount, 0) ELSE 0 END), 0) AS balance_cash
       FROM transactions
       WHERE customer_id = ? AND category <> 'adjustment'
       ${hasBefore ? 'AND (receipt_no IS NULL OR receipt_no < ?)' : ''}`,
      hasBefore ? [customerId, before] : [customerId]
    )
    const r = rows[0] || {}
    return { balance_gold: Number(r.balance_gold) || 0, balance_cash: Number(r.balance_cash) || 0 }
  },

  // Every customer with their running gold + cash balance, computed in ONE pass
  // over the transactions table (not N ledger queries). The per-transaction math
  // is IDENTICAL to getCustomerLedger: sign = 'out' ? +1 : -1 (shop gave to
  // customer = customer owes), gold from gold_give/gold_take on khalis_sona, cash
  // from cash_give/cash_take on cash_amount. Customers with no transactions are
  // included with a zero balance. Sorted by name ASC.
  listCustomersWithBalances() {
    // Balances grouped by SQLite instead of by a JS Map over every transaction in
    // the shop's history (0.7s on a 100k-row ledger — the کسٹمر فہرست visibly
    // stalled). Identical sign rule to the ledger: out = the customer owes us
    // (+1), in = we owe him (−1); only the four ادھار categories move a balance,
    // نقد/lab rows and rows with no customer are ignored. Customers with no
    // transactions still appear, at zero, via the LEFT JOIN.
    const sign = "(CASE WHEN direction = 'out' THEN 1 ELSE -1 END)"
    const rows = query(`
      SELECT c.id, c.name, c.mobile, c.image,
             COALESCE(b.gold, 0) AS balance_gold,
             COALESCE(b.cash, 0) AS balance_cash
      FROM customers c
      LEFT JOIN (
        SELECT customer_id,
               SUM(CASE WHEN category IN ('gold_give', 'gold_take')
                        THEN ${sign} * COALESCE(khalis_sona, 0) ELSE 0 END) AS gold,
               SUM(CASE WHEN category IN ('cash_give', 'cash_take')
                        THEN ${sign} * COALESCE(cash_amount, 0) ELSE 0 END) AS cash
        FROM transactions
        WHERE customer_id IS NOT NULL
        GROUP BY customer_id
      ) b ON b.customer_id = c.id
      ORDER BY c.name ASC
    `)
    return rows.map((c) => ({
      id: c.id,
      name: c.name,
      mobile: c.mobile,
      image: c.image,
      balance_gold: Number(c.balance_gold) || 0,
      balance_cash: Number(c.balance_cash) || 0
    }))
  },

  getDaybook(date) {
    const txns = query(
      "SELECT t.*, c.name AS customer_name FROM transactions t LEFT JOIN customers c ON c.id = t.customer_id WHERE t.date = ? AND t.category <> 'adjustment' ORDER BY t.ts ASC, t.id ASC",
      [date]
    )
    const totals = {
      gold_in: 0,
      gold_out: 0,
      cash_in: 0,
      cash_out: 0
    }
    for (const t of txns) {
      // کچا سونا لیا: the slip's khalis_sona stays OUT of the gold totals (it is
      // report-only, per the original intent) — but the refined gold and cash
      // actually HANDED OUT on the kacha deal are real outflows and must show
      // in the day's برآمد totals.
      if (t.category === 'kacha_gold_take') {
        totals.gold_out += t.sona_diya || 0
        totals.cash_out += t.cash_diya || 0
        continue
      }
      if (t.direction === 'in') {
        totals.gold_in += t.khalis_sona || 0
        totals.cash_in += (t.qeemat || 0) + (t.cash_amount || 0)
      } else if (t.direction === 'out') {
        totals.gold_out += t.khalis_sona || 0
        totals.cash_out += (t.qeemat || 0) + (t.cash_amount || 0)
      }
    }
    return { txns, totals }
  },

  listDates() {
    return query("SELECT DISTINCT date FROM transactions WHERE category <> 'adjustment' ORDER BY date DESC")
  },

  getShopTotals() {
    // Summed by SQLite, not by JavaScript. This runs after EVERY write (the bottom
    // bar refreshes on each save), and the old version pulled all 20 columns of
    // every transaction ever made into JS objects just to add four numbers —
    // measured at 2.6 SECONDS of frozen bottom bar on a 100k-row ledger. The CASE
    // arms below are a line-for-line translation of that loop; the rules are
    // unchanged:
    //   • kacha_gold_take — کچا سونا takes ONLY the raw scale weight; the refined
    //     gold and cash handed out for it REDUCE تیزابی/کیش. It contributes to no
    //     other total (no parchun, no general gold line).
    //   • adjustment (اندراج) — direction-signed into کیش/تیزابی ONLY, never into
    //     kacha or parchun, and never double-counted by the general gold line.
    //   • everything else — تیزابی is a RAW-WEIGHT counter (sona_wazan, NOT khalis;
    //     shop convention, deliberately unlike the khalis-based reports), cash is
    //     money in minus money out, parchun accumulates point.
    // A NULL category matches no WHEN and falls to ELSE — exactly like the old
    // `if` chain, which tested equality and then ran the general branch.
    const sign = "(CASE WHEN direction = 'in' THEN 1 ELSE -1 END)"
    const rows = query(`
      SELECT
        COALESCE(SUM(CASE
          WHEN category = 'kacha_gold_take' THEN -COALESCE(cash_diya, 0)
          WHEN category = 'adjustment'      THEN ${sign} * COALESCE(cash_amount, 0)
          WHEN category = 'gold_buy'        THEN -COALESCE(qeemat, 0)
          WHEN category = 'gold_sell'       THEN COALESCE(qeemat, 0)
          WHEN category = 'cash_take'       THEN COALESCE(cash_amount, 0)
          WHEN category = 'cash_give'       THEN -COALESCE(cash_amount, 0)
          WHEN category = 'lab_job'         THEN COALESCE(qeemat, 0)
          ELSE 0 END), 0) AS cash,
        COALESCE(SUM(CASE
          WHEN category = 'kacha_gold_take' THEN -COALESCE(sona_diya, 0)
          WHEN category = 'adjustment'      THEN ${sign} * COALESCE(khalis_sona, 0)
          ELSE ${sign} * COALESCE(sona_wazan, 0) END), 0) AS gold,
        COALESCE(SUM(CASE
          WHEN category IN ('kacha_gold_take', 'adjustment') THEN 0
          ELSE COALESCE(point, 0) END), 0) AS parchun,
        COALESCE(SUM(CASE
          WHEN category = 'kacha_gold_take' THEN COALESCE(sona_wazan, 0)
          ELSE 0 END), 0) AS kacha
      FROM transactions
    `)
    const agg = rows[0] || {}
    const cash = Number(agg.cash) || 0
    const gold = Number(agg.gold) || 0
    const parchun = Number(agg.parchun) || 0
    const kacha = Number(agg.kacha) || 0 // کچا سونا: وزن کانٹے پر ONLY
    // The bottom-bar کچا سونا is a RESETTABLE running counter: subtract the stored
    // baseline (set by the ↺ reset) so zeroing the counter never deletes any کچا
    // سونا لیا record — the اُدھار report reads those records independently.
    const bl = query('SELECT COALESCE(kacha_baseline, 0) AS b FROM settings WHERE id = 1')
    const baseline = bl[0] ? (Number(bl[0].b) || 0) : 0
    return { cash, tezabi_sona: gold, parchun, kacha_sona: kacha - baseline }
  }
}

module.exports = { init, api, flush }
