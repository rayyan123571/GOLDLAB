// Build each report's HTML from the REAL operator data (a DB copy) and print
// size + a content check, so we know the new builders produce populated tables.
import fs from 'fs'
import os from 'os'
import path from 'path'
import dbPkg from '../electron/db.cjs'
import {
  buildGoldBalanceHtml, buildCashBalanceHtml, buildGoldEntriesHtml, buildCashEntriesHtml,
  buildNaqadEntriesHtml, buildKachaHtml
} from '../src/logic/reportHtml.js'

const SRC = 'C:/Users/rayya/AppData/Roaming/gold-lab/goldlab.sqlite'
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gl-htmlchk-'))
fs.copyFileSync(SRC, path.join(dir, 'goldlab.sqlite'))
const outDir = process.env.OUT_HTML || path.join(dir, 'html')
fs.mkdirSync(outDir, { recursive: true })

const check = (key, html, mustContain) => {
  const ok = typeof html === 'string' && html.length > 300 && html.includes('<table') && mustContain.every((s) => html.includes(s))
  fs.writeFileSync(path.join(outDir, key + '.html'), html)
  console.log((ok ? '✓' : '✗ FAIL'), key, `(${html.length} bytes)`, ok ? '' : ('missing: ' + mustContain.filter((s) => !html.includes(s)).join(', ')))
}

await dbPkg.init(dir)
const a = dbPkg.api
check('tezabi_lena_hai', buildGoldBalanceHtml({ rows: a.reportGoldBalanceNet('lena', {}).rows, title: 'تیزابی لینا ہے (بیلنس)', css: '' }), ['تیزابی لینا ہے', 'نام', 'میزان'])
check('raqam_deni_hai', buildCashBalanceHtml({ rows: a.reportCashBalanceNet('dena', {}).rows, title: 'رقم دینی ہے (بیلنس)', css: '' }), ['رقم دینی ہے', 'رقم'])
check('tezabi_udhaar_diya', buildGoldEntriesHtml({ rows: a.getReport({ category: 'gold_give' }).rows, title: 'تیزابی ادھار دیا — تمام اندراج', css: '' }), ['تیزابی ادھار دیا', 'خالص سونا', 'میزان', 'Nasir'])
check('udhaar_raqam_di', buildCashEntriesHtml({ rows: a.getReport({ category: 'cash_give' }).rows, title: 'ادھار رقم دی — تمام اندراج', css: '' }), ['ادھار رقم دی', 'رقم', 'میزان'])
check('naqad_farokht', buildNaqadEntriesHtml({ rows: a.getReport({ category: 'gold_sell' }).rows, title: 'نقد فروخت — تمام اندراج', css: '' }), ['نقد فروخت', 'قیمت', 'خالص سونا'])
check('kacha_sona_liya', buildKachaHtml({ rows: a.reportKachaGold({}).rows, title: 'کچا سونا لیا — تمام اندراج', css: '' }), ['کچا سونا لیا', 'کیش دیا', 'میزان'])

console.log('\nHTML written to:', outDir, '| original DB untouched:', fs.existsSync(SRC))
if (!process.env.OUT_HTML) fs.rmSync(dir, { recursive: true, force: true })
