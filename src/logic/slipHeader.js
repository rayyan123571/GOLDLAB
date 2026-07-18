// ─── Slip header — ONE source of truth for the shop identity block ───────────
// Printed above every receipt AND shown as the live preview in ڈیفالٹ سیٹنگز.
// store.jsx (print + WhatsApp share) and DefaultsForm.jsx (preview) both import
// THIS function, so the preview and the paper can never drift apart.
//
// Display-only: it reads a rates-like object and returns a <div>. It never
// touches a value, and it holds NO default text — the Chaudhary defaults live in
// the settings table (seeded by electron/db.cjs). A field the shopkeeper clears
// therefore prints as nothing: the line it belongs to simply disappears.
//
// Sizes are DESIGN px against SLIP_DESIGN_W. The thermal raster path scales this
// block ×~1.63 onto the 576-dot canvas (name ≈ 42px printed, the largest text on
// the slip), which is exactly the geometry electron/rasterPrint.cjs reproduces at
// native size for the direct-thermal path.
export const SLIP_DESIGN_W = 341

// The settings columns that make up the header. Keep in step with SHOP_FIELDS in
// electron/shopDefaults.cjs (the main-process half, which seeds their defaults).
export const SHOP_FIELDS = [
  'shop_name',
  'shop_tagline',
  'shop_owner',
  'shop_phone1',
  'shop_phone2',
  'shop_phone3',
  'shop_address'
]

// Pluck just the shop columns out of a rates row — a plain, IPC-safe object to
// hand the main-process printer alongside the slip data.
export function shopOf(rates) {
  const out = {}
  for (const f of SHOP_FIELDS) out[f] = (rates && rates[f] != null) ? String(rates[f]) : ''
  return out
}

// Values come from user-editable settings and are injected as HTML, so escape
// them. The shop's real text has no special characters, so this changes nothing
// about what is printed today — it just means a stray & or < can never break the
// header's markup.
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
))

// Trim, and treat null/undefined as blank — a blank field hides its line.
const val = (v) => String(v == null ? '' : v).trim()

export function buildSlipHeader(shop) {
  const s = shop || {}
  const name = val(s.shop_name)
  const tagline = val(s.shop_tagline)
  const owner = val(s.shop_owner)
  const p1 = val(s.shop_phone1)
  const p2 = val(s.shop_phone2)
  const p3 = val(s.shop_phone3)
  const address = val(s.shop_address)

  const el = document.createElement('div')
  el.dir = 'rtl'
  el.className = 'urdu slip-header'
  el.style.cssText = 'text-align:center;color:#000;border:2px solid #000;padding:3px 4px 0;margin-bottom:5px'

  // Reference-receipt decorations: a sharp ZIGZAG rule under the tagline and a
  // ☎ before each phone number. The zigzag is inline SVG (rasterizes crisply to
  // 1-bit; non-scaling stroke keeps an even line width under the ×1.63 clone
  // scale); ☎ (U+260E) is a monochrome glyph that thresholds cleanly on thermal.
  let zz = 'M0 5'
  for (let x = 0; x <= 240; x += 6) zz += ' L' + (x + 3) + ' 1 L' + (x + 6) + ' 5'
  const wave = '<svg width="100%" height="6" viewBox="0 0 240 6" preserveAspectRatio="none" style="display:block;margin:3px 2px">' +
    '<path d="' + zz + '" fill="none" stroke="#000" stroke-width="1.6" vector-effect="non-scaling-stroke"/></svg>'
  const tel = '☎'
  const phone = (p) => '<span dir="ltr">' + tel + '&nbsp;' + esc(p) + '</span>'

  // Each line is emitted ONLY when it has something to say. The owner shares a
  // line with the first phone, and the other two phones share the next one, so
  // those lines survive with just one half filled in.
  let html = ''
  if (name) html += '<div style="font-size:26px;font-weight:800;line-height:1.5">' + esc(name) + '</div>'
  if (tagline) html += '<div style="font-size:12.5px;font-weight:500;line-height:1.7">' + esc(tagline) + '</div>'
  // The zigzag is part of the BOX, not a field: it keeps separating the top of
  // the header from the phones even when the tagline is cleared.
  html += wave
  if (owner || p1) {
    html += '<div style="font-size:13.5px;font-weight:600;line-height:1.8">' +
      (owner ? esc(owner) : '') +
      (owner && p1 ? '&nbsp;&nbsp;' : '') +
      (p1 ? phone(p1) : '') +
      '</div>'
  }
  if (p2 || p3) {
    html += '<div style="font-size:14px;font-weight:600;line-height:1.7">' +
      (p2 ? phone(p2) : '') +
      (p2 && p3 ? '&nbsp;&nbsp;&nbsp;' : '') +
      (p3 ? phone(p3) : '') +
      '</div>'
  }
  // Address gets its own ruled strip at the bottom of the box.
  if (address) {
    html += '<div style="border-top:1.5px solid #000;margin-top:3px;padding:2px 0 4px;font-size:12.5px;font-weight:500;line-height:1.8">' +
      esc(address) + '</div>'
  }
  el.innerHTML = html
  return el
}

// The لیب رسید terms box. Display-only; blank terms → null (no box at all),
// exactly as a cleared header field hides its line. Design px against
// SLIP_DESIGN_W; the raster path draws its own ×~1.63 equivalent.
export function buildSlipTerms(terms) {
  const t = String(terms == null ? '' : terms).trim()
  if (!t) return null
  const el = document.createElement('div')
  el.dir = 'rtl'
  el.className = 'urdu'
  el.style.cssText = 'font-size:12.5px;font-weight:500;line-height:2;text-align:right;border:1.5px solid #000;padding:3px 6px;margin-bottom:5px'
  el.textContent = t   // textContent, not innerHTML — user text is never markup
  return el
}
