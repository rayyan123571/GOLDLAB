/* ─────────────────────────────────────────────────────────────────────────────
 *  DEVELOPER RECOVERY CODE — change THIS value to change the master code.
 *
 *  Typing it on the ٹوٹل login screen lets the owner set a NEW pin without
 *  knowing the old one (forgot-pin recovery). It is the ONLY hardcoded secret
 *  in this feature: the owner's own pin is user-set and stored HASHED.
 * ───────────────────────────────────────────────────────────────────────────── */
const RECOVERY_CODE = 'GOLD-MASTER-7391'

/* ─────────────────────────────────────────────────────────────────────────────
 * Pin hashing for the ٹوٹل panel gate. Pure crypto — no database, no IPC, and
 * nothing to do with totals/receipts/rates. db.cjs owns the two settings columns
 * (pin_hash / pin_salt) and calls in here to hash and compare.
 *
 * Salted SHA-256 via PBKDF2 (node's built-in crypto — no new dependency). The
 * RAW pin exists only as an argument here; it is hashed and dropped, never
 * written to the database and never logged.
 * ───────────────────────────────────────────────────────────────────────────── */
const crypto = require('crypto')

const ITERATIONS = 120000
const KEYLEN = 32
const DIGEST = 'sha256'

const makeSalt = () => crypto.randomBytes(16).toString('hex')

const hashPin = (pin, salt) =>
  crypto.pbkdf2Sync(String(pin), String(salt), ITERATIONS, KEYLEN, DIGEST).toString('hex')

// Constant-time compare so a wrong pin can't be narrowed down by timing. Lengths
// differ → not equal (timingSafeEqual throws on unequal buffer lengths).
function safeEqual(a, b) {
  const ba = Buffer.from(String(a || ''), 'utf8')
  const bb = Buffer.from(String(b || ''), 'utf8')
  if (ba.length !== bb.length) return false
  return crypto.timingSafeEqual(ba, bb)
}

const isRecoveryCode = (code) => safeEqual(String(code || '').trim(), RECOVERY_CODE)

/* ─────────────────────────────────────────────────────────────────────────────
 *  DEVELOPER PIN — guards ڈیفالٹ سیٹنگز → پرچی ہیڈر (the shop identity printed
 *  on every slip). This is NOT the shopkeeper's pin.
 *
 *  Two different locks, on purpose:
 *    • settings.pin_hash — the ٹوٹل panel. The SHOPKEEPER picks it and may change
 *      it whenever he likes.
 *    • the digest below — the شاپ ہیڈر. Fixed, known only to the developer, and
 *      completely unaffected when the shopkeeper changes his own pin. Otherwise
 *      he could unlock the header himself and print slips under another shop's
 *      name, which is the whole point of locking it.
 *
 *  Stored as a salted PBKDF2 digest with the SAME parameters as the shopkeeper's
 *  pin, so the raw digits appear nowhere in the source or in the shipped bundle.
 *  To change it: hash the new 4 digits with makeSalt()/hashPin() and paste the
 *  pair here — never the digits themselves.
 *
 *  Worth knowing: a 4-digit pin has only 10,000 possibilities, so anyone who
 *  extracts this file could brute-force the digest offline. It stops the
 *  shopkeeper, not a determined attacker with the file — the same limit the
 *  shopkeeper's own pin has always had.
 * ───────────────────────────────────────────────────────────────────────────── */
const DEV_PIN_SALT = '8a4ce4b9a531bd47f5c5a8d0a9008e19'
const DEV_PIN_HASH = '487618b17f4793c0e59e9600cd259611b3b208cf80eedf60a941e2f9a77bf698'

// The developer pin, or the recovery code (which opens anything the pin does).
// Same constant-time compare as every other check here.
const isDevPin = (code) => {
  const raw = String(code == null ? '' : code).trim()
  if (isRecoveryCode(raw)) return true
  if (!isValidPin(raw)) return false
  return safeEqual(hashPin(raw, DEV_PIN_SALT), DEV_PIN_HASH)
}

// Owner pin rule: EXACTLY 4 digits. Enforced BOTH here (authoritative) and in
// the UI's four digit cells.
const isValidPin = (pin) => /^\d{4}$/.test(String(pin || ''))

module.exports = { hashPin, makeSalt, safeEqual, isRecoveryCode, isValidPin, isDevPin }
