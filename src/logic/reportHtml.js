// Report → standalone HTML builders for the auto-PDF export (electron/reportPdf.cjs
// turns these into PDFs via printToPDF). Each report is a titled table of ALL
// entries / balances of one action-button's transaction type, all-time and
// unfiltered, built straight from the DB query rows (no PDF library).
import { fmtMoney, fmtNum, gramsToTMR } from './units.js'
import { amountOf } from './nayaSoda.js' // ONE owner of "what a سودا row is worth"

// Serialize every reachable stylesheet so the offscreen PDF page picks up the app
// fonts. Packaged file:// builds may block CSSOM — then we leave the marker and
// the main process splices the built stylesheet from disk.
export function serializeAppCss() {
  let css = ''
  try {
    css = Array.from(document.styleSheets)
      .map((ss) => { try { return Array.from(ss.cssRules).map((r) => r.cssText).join('\n') } catch { return '' } })
      .join('\n')
  } catch {}
  if (!css || css.length < 500) css = '/*__APP_CSS__*/'
  return css
}

const esc = (v) => String(v == null ? '' : v)
  .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const FONT = "'Noto Nastaliq Urdu','Jameel Noori Nastaleeq','Segoe UI',Tahoma,sans-serif"
const isoToDisp = (iso) => { const p = String(iso || '').split('-'); return p.length === 3 && p[0] ? `${p[2]}/${p[1]}/${p[0]}` : (iso || '-') }
const READY_SCRIPT =
  '<script>window.__ready=(async()=>{try{if(document.fonts&&document.fonts.ready){await document.fonts.ready}}catch(e){}' +
  'await new Promise(r=>setTimeout(r,60));return true})()</scr' + 'ipt>'

// Shared table CSS + document shell for every report.
//
// CRITICAL — the print-media reset below is what keeps these PDFs from coming out
// BLANK. The app stylesheet spliced in as `css` carries a global rule:
//   @media print { body *{visibility:hidden} .print-area,.print-area *{visibility:visible} }
// which exists so window.print() on a live screen emits ONLY the on-screen report.
// printToPDF renders PRINT media, and these standalone report documents have no
// .print-area — so that rule hid every row and produced correctly-named, correctly-
// timestamped, completely EMPTY PDFs. tableCss() is always emitted AFTER `css`, so
// re-asserting visibility here wins. @page margin is zeroed too, so printToPDF's own
// margins are the single source of truth instead of stacking with the app's 10mm.
const tableCss = () =>
  '@media print{body,body *{visibility:visible!important}@page{margin:0}}' +
  'html,body{margin:0;padding:0;background:#fff;color:#000}' +
  `.wrap{font-family:${FONT};padding:8px}` +
  `.title{text-align:center;font-weight:700;font-size:17pt;font-family:${FONT}}` +
  '.sub{text-align:center;font-size:10pt;margin:2px 0 8px;color:#333}' +
  'table.rpt{width:100%;border-collapse:collapse;table-layout:auto}' +
  'table.rpt th,table.rpt td{border:1px solid #333;padding:3px 6px;font-size:10pt;text-align:center;word-break:break-word}' +
  `table.rpt th{background:#eee;font-weight:700;font-family:${FONT}}` +
  'table.rpt td.n{direction:ltr;font-variant-numeric:tabular-nums}' +
  `table.rpt td.u{font-family:${FONT}}` +
  'table.rpt td.empty{padding:16px;color:#666}' +
  'table.rpt tfoot td{background:#eee;font-weight:700;border-top:2px solid #000}' +
  'table.rpt tfoot td.lbl{text-align:right;padding-right:8px}'

// ── Generic titled-table report ─────────────────────────────────────────────
// columns: [{ label, get:(row)=>string, num?, total?, raw?:(row)=>number, fmt?:(sum)=>string }]
// A footer total row appears only if any column has `total`. Empty rows → a note.
export function buildTableReportHtml({ title, subtitle, columns, rows, css, landscape, emptyText }) {
  const list = Array.isArray(rows) ? rows : []
  const head = columns.map((c) => `<th>${esc(c.label)}</th>`).join('')
  const body = list.length
    ? list.map((r) => '<tr>' + columns.map((c) => `<td class="${c.num ? 'n' : 'u'}">${esc(c.get(r))}</td>`).join('') + '</tr>').join('')
    : `<tr><td colspan="${columns.length}" class="empty u">${esc(emptyText || 'کوئی اندراج نہیں')}</td></tr>`
  const hasTotals = columns.some((c) => c.total)
  let foot = ''
  if (hasTotals && list.length) {
    const firstTotal = columns.findIndex((c) => c.total)
    foot = '<tfoot><tr>' +
      `<td colspan="${firstTotal}" class="lbl u">میزان (${list.length})</td>` +
      columns.slice(firstTotal).map((c) => {
        if (!c.total) return '<td></td>'
        const sum = list.reduce((s, r) => s + (c.raw ? (Number(c.raw(r)) || 0) : 0), 0)
        return `<td class="n">${esc(c.fmt ? c.fmt(sum) : fmtNum(sum))}</td>`
      }).join('') +
      '</tr></tfoot>'
  }
  return `<!doctype html><html dir="rtl"><head><meta charset="utf-8"><style>${css}\n${tableCss()}` +
    (landscape ? '' : '') + '</style></head><body><div class="wrap">' +
    `<div class="title">${esc(title)}</div>` +
    (subtitle ? `<div class="sub">${esc(subtitle)}</div>` : '') +
    '<table class="rpt"><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody>' + foot + '</table>' +
    '</div>' + READY_SCRIPT + '</body></html>'
}

// Net gold balance per customer (تیزابی لینا ہے / تیزابی دینا ہے). rows from
// reportGoldBalanceNet: { customer_name, total_khalis, updated_at, date }.
export function buildGoldBalanceHtml({ rows, title, css }) {
  const list = (rows || []).slice().sort((a, b) => (Number(b.total_khalis) || 0) - (Number(a.total_khalis) || 0))
  const g = (r) => Number(r.total_khalis) || 0
  return buildTableReportHtml({
    title, subtitle: 'تمام کسٹمر · تمام تواریخ (بیلنس)', css, rows: list,
    columns: [
      { label: 'نام', get: (r) => r.customer_name || '-' },
      { label: 'تولہ', get: (r) => gramsToTMR(g(r)).tola, num: true },
      { label: 'ماشہ', get: (r) => gramsToTMR(g(r)).masha, num: true },
      { label: 'رتی', get: (r) => fmtNum(gramsToTMR(g(r)).ratti, 2), num: true },
      { label: 'گرام (خالص)', get: (r) => fmtNum(g(r)), num: true, total: true, raw: (r) => g(r), fmt: (t) => `${fmtNum(t)} گرام` },
      { label: 'تاریخ', get: (r) => isoToDisp(r.updated_at || r.date), num: true }
    ]
  })
}

// Net cash balance per customer (رقم لینی ہے / رقم دینی ہے). rows from
// reportCashBalanceNet: { customer_name, total_cash }.
export function buildCashBalanceHtml({ rows, title, css }) {
  const list = (rows || []).slice().sort((a, b) => (Number(b.total_cash) || 0) - (Number(a.total_cash) || 0))
  return buildTableReportHtml({
    title, subtitle: 'تمام کسٹمر · تمام تواریخ (بیلنس)', css, rows: list,
    columns: [
      { label: 'نام', get: (r) => r.customer_name || '-' },
      { label: 'رقم', get: (r) => fmtMoney(r.total_cash), num: true, total: true, raw: (r) => Number(r.total_cash) || 0, fmt: (t) => fmtMoney(t) }
    ]
  })
}

const newestFirst = (rows) => (rows || []).slice().reverse() // getReport is date-ASC

// All gold credit entries (تیزابی ادھار دیا/لیا). rows = transactions. `subtitle`
// and `emptyText` are overridable so the same builder serves both the all-time set
// and the today-only variants (which pass a dated subtitle + "آج کوئی اندراج نہیں").
export function buildGoldEntriesHtml({ rows, title, css, subtitle, emptyText }) {
  return buildTableReportHtml({
    title, subtitle: subtitle || 'تمام اندراج · تمام تواریخ', css, rows: newestFirst(rows), emptyText,
    columns: [
      { label: 'تاریخ', get: (r) => isoToDisp(r.date), num: true },
      { label: 'پرچی', get: (r) => r.receipt_no ?? '-', num: true },
      { label: 'نام', get: (r) => r.customer_name || '-' },
      { label: 'وزن (گرام)', get: (r) => (r.sona_wazan ? fmtNum(r.sona_wazan) : '-'), num: true },
      { label: 'خالص سونا', get: (r) => fmtNum(r.khalis_sona), num: true, total: true, raw: (r) => Number(r.khalis_sona) || 0, fmt: (t) => `${fmtNum(t)} گرام` }
    ]
  })
}

// All cash credit entries (ادھار رقم دی/آمد). rows = transactions. `subtitle` and
// `emptyText` overridable — same reason as buildGoldEntriesHtml (today-only variants).
export function buildCashEntriesHtml({ rows, title, css, subtitle, emptyText }) {
  return buildTableReportHtml({
    title, subtitle: subtitle || 'تمام اندراج · تمام تواریخ', css, rows: newestFirst(rows), emptyText,
    columns: [
      { label: 'تاریخ', get: (r) => isoToDisp(r.date), num: true },
      { label: 'پرچی', get: (r) => r.receipt_no ?? '-', num: true },
      { label: 'نام', get: (r) => r.customer_name || '-' },
      { label: 'نوٹ', get: (r) => r.note || '-' },
      { label: 'رقم', get: (r) => fmtMoney(r.cash_amount), num: true, total: true, raw: (r) => Number(r.cash_amount) || 0, fmt: (t) => fmtMoney(t) }
    ]
  })
}

// All نقد entries (نقد فروخت / نقد خرید). rows = transactions (gold_sell / gold_buy).
export function buildNaqadEntriesHtml({ rows, title, css }) {
  return buildTableReportHtml({
    title, subtitle: 'تمام اندراج · تمام تواریخ', css, rows: newestFirst(rows),
    columns: [
      { label: 'تاریخ', get: (r) => isoToDisp(r.date), num: true },
      { label: 'پرچی', get: (r) => r.receipt_no ?? '-', num: true },
      { label: 'نام', get: (r) => r.customer_name || '-' },
      { label: 'وزن', get: (r) => fmtNum(r.sona_wazan), num: true },
      { label: 'خالص سونا', get: (r) => fmtNum(r.khalis_sona), num: true, total: true, raw: (r) => Number(r.khalis_sona) || 0, fmt: (t) => `${fmtNum(t)} گرام` },
      { label: 'ریٹ', get: (r) => fmtMoney(r.rate), num: true },
      { label: 'قیمت', get: (r) => fmtMoney(r.qeemat), num: true, total: true, raw: (r) => Number(r.qeemat) || 0, fmt: (t) => fmtMoney(t) }
    ]
  })
}

// All کچا سونا لیا entries. rows from reportKachaGold: { customer_name, kacha_sona,
// khalis_sona, sona_diya, cash_diya }, plus its own totals object.
export function buildKachaHtml({ rows, title, css }) {
  return buildTableReportHtml({
    title, subtitle: 'تمام اندراج · تمام تواریخ', css, rows: (rows || []).slice().reverse(),
    columns: [
      { label: 'نام', get: (r) => r.customer_name || '-' },
      { label: 'کچا سونا', get: (r) => fmtNum(r.kacha_sona), num: true, total: true, raw: (r) => Number(r.kacha_sona) || 0, fmt: (t) => `${fmtNum(t)} گرام` },
      { label: 'خالص سونا', get: (r) => fmtNum(r.khalis_sona), num: true, total: true, raw: (r) => Number(r.khalis_sona) || 0, fmt: (t) => `${fmtNum(t)} گرام` },
      { label: 'سونا دیا', get: (r) => fmtNum(r.sona_diya), num: true, total: true, raw: (r) => Number(r.sona_diya) || 0, fmt: (t) => `${fmtNum(t)} گرام` },
      { label: 'کیش دیا', get: (r) => fmtMoney(r.cash_diya), num: true, total: true, raw: (r) => Number(r.cash_diya) || 0, fmt: (t) => fmtMoney(t) }
    ]
  })
}

// نیا سودا deals of one status — بھگتان (settled) or بقایا (outstanding). rows from
// listNayaSoda(status): { name, rate, wazan, type:'khareed'|'farokht', date }. All-
// time, already newest-first (the query is ORDER BY id DESC → pass rows as-is). رقم
// per row = amountOf (ریٹ per-tola × وزن-in-tolas — the shared nayaSoda.js formula).
const SAUDA_TYPE = { khareed: 'خرید', farokht: 'فروخت' }
export function buildSaudaHtml({ rows, title, css }) {
  return buildTableReportHtml({
    title, subtitle: 'تمام اندراج · تمام تواریخ', css, rows: (rows || []),
    columns: [
      { label: 'تاریخ', get: (r) => isoToDisp(r.date), num: true },
      { label: 'نام', get: (r) => r.name || '-' },
      { label: 'قسم', get: (r) => SAUDA_TYPE[r.type] || r.type || '-' },
      { label: 'ریٹ', get: (r) => fmtNum(r.rate), num: true },
      { label: 'وزن', get: (r) => fmtNum(r.wazan), num: true, total: true, raw: (r) => Number(r.wazan) || 0, fmt: (t) => `${fmtNum(t)} گرام` },
      { label: 'رقم', get: (r) => fmtMoney(amountOf(r)), num: true, total: true, raw: (r) => amountOf(r), fmt: (t) => fmtMoney(t) }
    ]
  })
}

// Full expenses ledger (تفصیلی اخراجات) — ALL addExpense entries, all-time. rows from
// getExpenses(): { date, comment, amount }. getExpenses is ts-ASC → reverse for
// newest-first, matching the other entry reports.
export function buildExpensesHtml({ rows, title, css }) {
  return buildTableReportHtml({
    title, subtitle: 'تمام اندراج · تمام تواریخ', css, rows: (rows || []).slice().reverse(),
    columns: [
      { label: 'تاریخ', get: (r) => isoToDisp(r.date), num: true },
      { label: 'تفصیل', get: (r) => r.comment || '-' },
      { label: 'رقم', get: (r) => fmtMoney(r.amount), num: true, total: true, raw: (r) => Number(r.amount) || 0, fmt: (t) => fmtMoney(t) }
    ]
  })
}

// ── روزنامچہ (daybook) — kept. SAME columns/labels as src/screens/Daybook.jsx. ──
const CAT_LABEL = {
  gold_sell: 'سونا فروخت (نقد)', gold_buy: 'سونا خرید (نقد)',
  gold_give: 'سونا دیا (ادھار)', gold_take: 'سونا لیا (ادھار)',
  cash_give: 'کیش دیا', cash_take: 'کیش لیا',
  lab_job: 'لیب کام', kacha_gold_take: 'کچا سونا لیا'
}
const DB_COLUMNS = [
  { key: 'time', label: 'وقت' }, { key: 'receipt_no', label: 'رسید نمبر' },
  { key: 'category', label: 'قسم' }, { key: 'customer', label: 'گاہک' },
  { key: 'sona_wazan', label: 'سونا وزن', total: 'wazan' }, { key: 'point', label: 'پوائنٹ' },
  { key: 'khalis_sona', label: 'خالص سونا', total: 'khalis' }, { key: 'sona_diya', label: 'سونا دیا', total: 'sonaDiya' },
  { key: 'cash_diya', label: 'کیش دیا', total: 'cashDiya', money: true }, { key: 'rate', label: 'ریٹ' },
  { key: 'qeemat', label: 'قیمت', total: 'qeemat', money: true }, { key: 'cash', label: 'کیش', total: 'cash', money: true }
]
const time12 = (ts) => { const d = new Date(ts); return isNaN(d) ? '-' : d.toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' }) }
const dbCell = (col, x) => {
  switch (col.key) {
    case 'time': return time12(x.ts)
    case 'receipt_no': return x.receipt_no || '-'
    case 'category': return CAT_LABEL[x.category] || x.category || '-'
    case 'customer': return x.customer_name || '-'
    case 'sona_wazan': return x.sona_wazan ? fmtNum(x.sona_wazan) : '-'
    case 'point': return x.point ? fmtNum(x.point, 0) : '-'
    case 'khalis_sona': return x.khalis_sona ? fmtNum(x.khalis_sona) : '-'
    case 'sona_diya': return x.sona_diya ? fmtNum(x.sona_diya) : '-'
    case 'cash_diya': return x.cash_diya ? fmtMoney(x.cash_diya) : '-'
    case 'rate': return x.rate ? fmtMoney(x.rate) : '-'
    case 'qeemat': return x.qeemat ? fmtMoney(x.qeemat) : '-'
    case 'cash': return x.cash_amount ? fmtMoney(x.cash_amount) : '-'
    default: return '-'
  }
}
export function buildDaybookReportHtml({ data, date, css }) {
  const txns = (data && data.txns) || []
  const t = (data && data.totals) || {}
  const sums = { wazan: 0, khalis: 0, sonaDiya: 0, cashDiya: 0, qeemat: 0, cash: 0 }
  for (const x of txns) {
    sums.wazan += x.sona_wazan || 0; sums.khalis += x.khalis_sona || 0
    sums.sonaDiya += x.sona_diya || 0; sums.cashDiya += x.cash_diya || 0
    sums.qeemat += x.qeemat || 0; sums.cash += x.cash_amount || 0
  }
  const head = DB_COLUMNS.map((c) => `<th>${esc(c.label)}</th>`).join('')
  const body = txns.length
    ? txns.map((x) => '<tr>' + DB_COLUMNS.map((c) => `<td class="${c.key === 'customer' || c.key === 'category' ? 'u' : 'n'}">${esc(dbCell(c, x))}</td>`).join('') + '</tr>').join('')
    : `<tr><td colspan="${DB_COLUMNS.length}" class="empty u">اس دن کوئی لین دین نہیں</td></tr>`
  const firstTotal = DB_COLUMNS.findIndex((c) => c.total)
  const foot = `<td colspan="${firstTotal}" class="lbl u">میزان (${txns.length})</td>` +
    DB_COLUMNS.slice(firstTotal).map((c) => {
      if (!c.total) return '<td></td>'
      const v = sums[c.total]
      return `<td class="n">${v ? esc(c.money ? fmtMoney(v) : fmtNum(v)) : '-'}</td>`
    }).join('')
  return '<!doctype html><html dir="rtl"><head><meta charset="utf-8"><style>' + css + '\n' + tableCss() +
    '</style></head><body><div class="wrap">' +
    `<div class="title">روزنامچہ — ${esc(date)}</div>` +
    `<div class="sub">سونا آمد ${esc(fmtNum(t.gold_in || 0))} · سونا برآمد ${esc(fmtNum(t.gold_out || 0))} · کیش آمد ${esc(fmtMoney(t.cash_in || 0))} · کیش برآمد ${esc(fmtMoney(t.cash_out || 0))}</div>` +
    '<table class="rpt"><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody><tfoot><tr>' + foot + '</tr></tfoot></table>' +
    '</div>' + READY_SCRIPT + '</body></html>'
}
