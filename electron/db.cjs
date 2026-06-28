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
  return path.join(dir, file)
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
  point REAL
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  mobile TEXT,
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
`

function seedSettings() {
  const r = db.exec('SELECT COUNT(*) AS c FROM settings')
  const count = r.length ? r[0].values[0][0] : 0
  if (!count) {
    db.run(
      `INSERT INTO settings (id, date, rate_tezabi_tola, parchi_charges, fc_per_gram, rate_tezabi_gram, point)
       VALUES (1, ?, ?, ?, ?, ?, ?)`,
      ['2026-05-15', 9000, 100, 80, 772, 100]
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

function run(sql, params = []) {
  db.run(sql, params)
  scheduleSave()
}

function lastInsertId() {
  const r = db.exec('SELECT last_insert_rowid() AS id')
  return r[0].values[0][0]
}

/* ---------- API ---------- */

const api = {
  getRates() {
    const r = query('SELECT * FROM settings WHERE id = 1')
    return r[0] || null
  },

  saveRates(rates) {
    run(
      `UPDATE settings SET date=?, rate_tezabi_tola=?, parchi_charges=?, fc_per_gram=?, rate_tezabi_gram=?, point=? WHERE id=1`,
      [
        rates.date,
        rates.rate_tezabi_tola,
        rates.parchi_charges,
        rates.fc_per_gram,
        rates.rate_tezabi_gram,
        rates.point
      ]
    )
    return api.getRates()
  },

  findCustomers(q) {
    if (!q || !q.trim()) {
      return query('SELECT * FROM customers ORDER BY name LIMIT 50')
    }
    const like = `%${q.trim()}%`
    return query(
      'SELECT * FROM customers WHERE name LIKE ? OR mobile LIKE ? ORDER BY name LIMIT 50',
      [like, like]
    )
  },

  getCustomer(id) {
    const r = query('SELECT * FROM customers WHERE id = ?', [id])
    return r[0] || null
  },

  upsertCustomer(c) {
    if (c.id) {
      run('UPDATE customers SET name=?, mobile=? WHERE id=?', [c.name, c.mobile, c.id])
      return api.getCustomer(c.id)
    }
    run('INSERT INTO customers (name, mobile, created_at) VALUES (?, ?, ?)', [
      c.name || '',
      c.mobile || '',
      new Date().toISOString()
    ])
    return api.getCustomer(lastInsertId())
  },

  nextReceiptNo() {
    const r = query('SELECT MAX(receipt_no) AS m FROM transactions')
    const max = r[0] && r[0].m ? r[0].m : 518
    return max + 1
  },

  addTransaction(t) {
    run(
      `INSERT INTO transactions
        (receipt_no, customer_id, date, ts, kind, direction, category,
         sona_wazan, point, khalis_sona, rate, qeemat, cash_amount, note, meta)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
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
        t.note || '',
        t.meta ? JSON.stringify(t.meta) : null
      ]
    )
    return { id: lastInsertId() }
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
    for (const t of txns) {
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
    return { cash, tezabi_sona: gold, parchun }
  }
}

module.exports = { init, api, flush }
