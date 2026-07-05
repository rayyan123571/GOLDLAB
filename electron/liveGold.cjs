// ─── Live gold spot ticker (display-only reference) ─────────────────────────
// Fetches the spot price from netdania's server-rendered mobile page in the
// MAIN process (renderer would hit CORS), parses it with a tolerant regex,
// sanity-gates it, and pushes {price, ts, ok} to the window on every poll.
// It touches NOTHING else — no rates, no settings, no receipts, no printing.
// Robustness rules: on ANY failure keep the last good value (ok:false so the
// UI greys it out); never let a bad parse through (1000 < price < 20000);
// never block or delay startup (first poll fires after the window loaded).
const https = require('https')
const http = require('http')
const { URL } = require('url')

const GOLD_URL = process.env.GOLDLAB_GOLD_URL || 'https://m.netdania.com/commodities/xauusdoz/idc'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
const FOCUSED_MS = 5000   // poll every 5s while the window is focused
const BLURRED_MS = 60000  // back off to 60s when blurred/minimized
const TIMEOUT_MS = 6000

let win = null
let timer = null
let stopped = false
let warned = false
let last = { price: null, ts: null, ok: false }

// GET with browser-ish headers, 6s timeout, up to 3 redirects. Resolves the
// HTML string or null — it never rejects (failures are a normal state here).
function httpGet(url, redirectsLeft = 3) {
  return new Promise((resolve) => {
    let settled = false
    const done = (v) => { if (!settled) { settled = true; resolve(v) } }
    try {
      const mod = url.startsWith('http:') ? http : https
      const req = mod.get(url, {
        headers: { 'User-Agent': UA, 'Cache-Control': 'no-cache', Accept: 'text/html,*/*' },
        timeout: TIMEOUT_MS
      }, (res) => {
        const sc = res.statusCode || 0
        if ([301, 302, 303, 307, 308].includes(sc) && res.headers.location && redirectsLeft > 0) {
          res.resume()
          let next = null
          try { next = new URL(res.headers.location, url).toString() } catch {}
          if (!next) return done(null)
          httpGet(next, redirectsLeft - 1).then(done)
          return
        }
        if (sc !== 200) { res.resume(); return done(null) }
        let html = ''
        res.setEncoding('utf8')
        res.on('data', (d) => {
          html += d
          if (html.length > 3e6) { try { req.destroy() } catch {}; done(null) }
        })
        res.on('end', () => done(html))
        res.on('error', () => done(null))
      })
      req.on('timeout', () => { try { req.destroy() } catch {}; done(null) })
      req.on('error', () => done(null))
    } catch {
      done(null)
    }
  })
}

// Tolerant two-stage parse. A gold shop must never show parsed garbage, so
// BOTH stages end at the same sanity gate (1000 < price < 20000).
//   1. netdania's stable field id: <span id="recid-N-f6">4174.19</span> —
//      f6 is the last-price field right under the "Gold, spot" <h1>.
//   2. Fallback: scan EVERY "Gold, spot" occurrence (the first several live in
//      <title>/<meta> tags — the page heading comes much later), take the
//      chunk after it (cut at "Today's range" when present), strip tags and
//      accept the first sane number.
const sane = (v) => (v > 1000 && v < 20000 ? v : null)

function parseGold(html) {
  if (!html) return null
  const f6 = /id="recid-\d+-f6"[^>]*>\s*([\d,]+(?:\.\d{1,2})?)\s*</i.exec(html)
  if (f6) {
    const v = sane(parseFloat(f6[1].replace(/,/g, '')))
    if (v != null) return v
  }
  const re = /Gold,\s*spot/gi
  let m
  while ((m = re.exec(html))) {
    let seg = html.slice(m.index, m.index + 2500)
    const cut = seg.search(/Today'?s\s*range/i)
    if (cut > 0) seg = seg.slice(0, cut)
    seg = seg.replace(/<[^>]*>/g, ' ')
    const nums = seg.match(/\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d{3,6}(?:\.\d{1,2})?/g) || []
    for (const n of nums) {
      const v = sane(parseFloat(n.replace(/,/g, '')))
      if (v != null) return v
    }
  }
  return null
}

async function fetchOnce() {
  const price = parseGold(await httpGet(GOLD_URL))
  if (price != null) {
    last = { price, ts: new Date().toISOString(), ok: true }
    warned = false
  } else {
    if (!warned) { console.warn('[live-gold] fetch/parse failed — keeping last good value'); warned = true }
    last = { ...last, ok: false }
  }
  return last
}

async function tick() {
  if (stopped) return
  await fetchOnce()
  try { if (win && !win.isDestroyed()) win.webContents.send('live-gold', last) } catch {}
  schedule()
}

function schedule(delay) {
  if (stopped) return
  if (timer) clearTimeout(timer)
  let focused = false
  try { focused = !!(win && !win.isDestroyed() && win.isFocused()) } catch {}
  timer = setTimeout(tick, delay != null ? delay : (focused ? FOCUSED_MS : BLURRED_MS))
}

// start AFTER the window content loaded — the first poll is async and can
// never block or delay startup.
function start(w) {
  win = w
  try { w.on('focus', () => schedule(300)) } catch {} // wake instantly on refocus
  schedule(800)
}

function stop() {
  stopped = true
  if (timer) clearTimeout(timer)
}

module.exports = { start, stop, fetchOnce, getLast: () => last, parseGold }
