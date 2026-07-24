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

// Owner pin rule: EXACTLY 4 digits. Enforced BOTH here (authoritative) and in
// the UI's four digit cells.
const isValidPin = (pin) => /^\d{4}$/.test(String(pin || ''))

module.exports = { hashPin, makeSalt, safeEqual, isRecoveryCode, isValidPin }
