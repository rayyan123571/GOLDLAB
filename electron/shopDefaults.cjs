// ─── Shop-identity defaults (the printed slip header) ────────────────────────
// The seven settings columns that drive the header printed above every receipt.
// These values ARE the current Chaudhary header, so a fresh install prints the
// real header immediately and an existing Chaudhary DB keeps printing exactly
// what it printed before.
//
// Used in two places, both in the main process:
//   • db.cjs         — seeds them into a new DB, backfills blank columns on an old one.
//   • rasterPrint.cjs — falls back to them when a caller sends no shop data (the
//                       printer TEST pages, which carry no settings).
// The renderer never needs this file: its shop values always come from the DB,
// through `rates`. A field the shopkeeper clears stays cleared — an empty value
// HIDES its line on the slip rather than reverting to the default here.
const SHOP_FIELDS = [
  'shop_name',
  'shop_tagline',
  'shop_owner',
  'shop_phone1',
  'shop_phone2',
  'shop_phone3',
  'shop_address'
]

const SHOP_DEFAULTS = {
  shop_name: 'چوہدری گولڈ لیبارٹری',
  shop_tagline: 'خالص سونے کی لین دین ۔ ہول سیل جیولری کا مرکز  (جیولری چوڑی میکر)',
  shop_owner: 'چوہدری ایم رمضان آرائیں',
  shop_phone1: '0300-7301839',
  shop_phone2: '0302-7330000',
  shop_phone3: '0302-3334440',
  shop_address: 'نزد موسیٰ پاک دربار صرافہ بازار ملتان'
}

module.exports = { SHOP_FIELDS, SHOP_DEFAULTS }
