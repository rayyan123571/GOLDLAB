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
  slip_count INTEGER
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
`

// Lightweight, idempotent migration. `CREATE TABLE IF NOT EXISTS` never alters
// an existing table, so databases created before the address/image columns
// existed must be patched in place. Safe to run on every startup: we only ADD a
// column when PRAGMA table_info shows it is missing.
function migrateSchema() {
  const cols = query('PRAGMA table_info(customers)').map((r) => r.name)
  if (!cols.includes('address')) db.run('ALTER TABLE customers ADD COLUMN address TEXT')
  if (!cols.includes('image')) db.run('ALTER TABLE customers ADD COLUMN image TEXT')

  // settings.slip_count — number of slip copies to print. Default to 1 on old DBs.
  const sCols = query('PRAGMA table_info(settings)').map((r) => r.name)
  if (!sCols.includes('slip_count')) {
    db.run('ALTER TABLE settings ADD COLUMN slip_count INTEGER')
    db.run('UPDATE settings SET slip_count = 1 WHERE slip_count IS NULL')
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
}

function seedSettings() {
  const r = db.exec('SELECT COUNT(*) AS c FROM settings')
  const count = r.length ? r[0].values[0][0] : 0
  if (!count) {
    // Seed the date to TODAY (local), never a hardcoded string.
    const d = new Date()
    const p = (n) => String(n).padStart(2, '0')
    const today = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
    db.run(
      `INSERT INTO settings (id, date, rate_tezabi_tola, parchi_charges, fc_per_gram, rate_tezabi_gram, point, slip_count)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?)`,
      [today, 9000, 100, 80, 772, 100, 1]
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

const api = {
  getRates() {
    const r = query('SELECT * FROM settings WHERE id = 1')
    return r[0] || null
  },

  saveRates(rates) {
    run(
      `UPDATE settings SET date=?, rate_tezabi_tola=?, parchi_charges=?, fc_per_gram=?, rate_tezabi_gram=?, point=?, slip_count=? WHERE id=1`,
      [
        rates.date,
        rates.rate_tezabi_tola,
        rates.parchi_charges,
        rates.fc_per_gram,
        rates.rate_tezabi_gram,
        rates.point,
        rates.slip_count != null ? rates.slip_count : 1
      ]
    )
    return api.getRates()
  },

  findCustomers(q) {
    if (!q || !q.trim()) {
      return query('SELECT * FROM customers ORDER BY name LIMIT 50')
    }
    const s = q.trim()
    const like = `%${s}%`
    // Also match on a numeric id so users can search by record number.
    const idNum = /^\d+$/.test(s) ? Number(s) : -1
    return query(
      'SELECT * FROM customers WHERE name LIKE ? OR mobile LIKE ? OR id = ? ORDER BY name LIMIT 50',
      [like, like, idNum]
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
    else if (name && String(name).trim()) { where.push('c.name LIKE ?'); params.push(`%${String(name).trim()}%`) }
    if (from) { where.push('t.date >= ?'); params.push(from) }
    if (to) { where.push('t.date <= ?'); params.push(to) }
    if (category) { where.push('t.category = ?'); params.push(category) }
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
    else if (name && String(name).trim()) { where.push('c.name LIKE ?'); params.push(`%${String(name).trim()}%`) }
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
      db.run('COMMIT')
    } catch (e) {
      try { db.run('ROLLBACK') } catch { /* ignore */ }
      console.error('resetKachaGold failed:', e)
      return { ok: false, message: String(e && e.message ? e.message : e) }
    }
    flush() // persist immediately (not just the debounced save)
    return { ok: true, removedTxns, removedReceipts }
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
    else if (name && String(name).trim()) { where.push('c.name LIKE ?'); params.push(`%${String(name).trim()}%`) }
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
    return { id: lastInsertId() }
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
    return { ok: true, id }
  },

  // Delete a transaction by id (Part 1). Missing id is a graceful no-op.
  deleteTransaction(id) {
    if (id == null) return { ok: false }
    run('DELETE FROM transactions WHERE id = ?', [id])
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

  // READ-ONLY: sum of expense amounts on a given date. Feeds the bottom-bar cash
  // DISPLAY (today's cash − today's expenses). Touches nothing.
  getExpensesTotalForDate(date) {
    const r = query('SELECT COALESCE(SUM(amount), 0) AS s FROM expenses WHERE date = ?', [date])
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
    scheduleSave()
    return { ok: true, receipt_no: rno, count: transactions.length }
  },

  getCustomerLedger(customerId) {
    const txns = query(
      'SELECT * FROM transactions WHERE customer_id = ? ORDER BY ts ASC, id ASC',
      [customerId]
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

  // Every customer with their running gold + cash balance, computed in ONE pass
  // over the transactions table (not N ledger queries). The per-transaction math
  // is IDENTICAL to getCustomerLedger: sign = 'out' ? +1 : -1 (shop gave to
  // customer = customer owes), gold from gold_give/gold_take on khalis_sona, cash
  // from cash_give/cash_take on cash_amount. Customers with no transactions are
  // included with a zero balance. Sorted by name ASC.
  listCustomersWithBalances() {
    const customers = query('SELECT id, name, mobile, image FROM customers ORDER BY name ASC')
    const txns = query(
      'SELECT customer_id, direction, category, khalis_sona, cash_amount FROM transactions'
    )
    const bal = new Map() // customer_id -> { gold, cash }
    for (const t of txns) {
      if (t.customer_id == null) continue
      let b = bal.get(t.customer_id)
      if (!b) { b = { gold: 0, cash: 0 }; bal.set(t.customer_id, b) }
      const sign = t.direction === 'out' ? 1 : -1
      if (t.category === 'gold_give' || t.category === 'gold_take') {
        b.gold += sign * (t.khalis_sona || 0)
      }
      if (t.category === 'cash_give' || t.category === 'cash_take') {
        b.cash += sign * (t.cash_amount || 0)
      }
    }
    return customers.map((c) => {
      const b = bal.get(c.id) || { gold: 0, cash: 0 }
      return {
        id: c.id,
        name: c.name,
        mobile: c.mobile,
        image: c.image,
        balance_gold: b.gold,
        balance_cash: b.cash
      }
    })
  },

  getDaybook(date) {
    const txns = query(
      'SELECT t.*, c.name AS customer_name FROM transactions t LEFT JOIN customers c ON c.id = t.customer_id WHERE t.date = ? ORDER BY t.ts ASC, t.id ASC',
      [date]
    )
    const totals = {
      gold_in: 0,
      gold_out: 0,
      cash_in: 0,
      cash_out: 0
    }
    for (const t of txns) {
      // کچا سونا لیا carries a khalis (the ticked row's) for the report only; it
      // must not count toward the daybook gold totals. The row still lists.
      if (t.category === 'kacha_gold_take') continue
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
    return query('SELECT DISTINCT date FROM transactions ORDER BY date DESC')
  },

  getShopTotals() {
    const txns = query('SELECT * FROM transactions')
    let cash = 0
    let gold = 0
    let parchun = 0
    let kacha = 0 // کچا سونا: running total of وزن کانٹے پر ONLY (kacha_gold_take)
    for (const t of txns) {
      // کچا سونا accumulates ONLY the raw scale-weight of kacha entries and feeds
      // no other total; conversely it must not pollute تیزابی/کیش, so skip it there.
      if (t.category === 'kacha_gold_take') {
        kacha += t.sona_wazan || 0
        gold -= t.sona_diya || 0 // refined gold handed out for the kacha → reduces تیزابی
        cash -= t.cash_diya || 0 // cash paid out for the kacha → reduces کیش
        continue
      }
      const goldSign = t.direction === 'in' ? 1 : -1
      gold += goldSign * (t.khalis_sona || 0)
      // cash: money flowing into shop minus out
      if (t.category === 'gold_buy') cash -= t.qeemat || 0
      if (t.category === 'gold_sell') cash += t.qeemat || 0
      if (t.category === 'cash_take') cash += t.cash_amount || 0
      if (t.category === 'cash_give') cash -= t.cash_amount || 0
      if (t.category === 'lab_job') cash += t.qeemat || 0
      parchun += t.point || 0
    }
    return { cash, tezabi_sona: gold, parchun, kacha_sona: kacha }
  }
}

module.exports = { init, api, flush }
