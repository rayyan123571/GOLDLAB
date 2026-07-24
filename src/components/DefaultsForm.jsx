import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useApp, WA_REMINDER_DEFAULT } from '../state/store.jsx'
import { fillReminder } from './UdharForm.jsx' // the report's own message builder — preview = the real thing
import { buildSlipHeader, buildSlipTerms, SHOP_FIELDS, SLIP_DESIGN_W } from '../logic/slipHeader.js'

const INPUT =
  'w-full bg-white border border-slate-300 rounded-lg text-[14px] leading-relaxed ' +
  'px-3 py-2 text-start tabular-nums cursor-text shadow-sm transition-all ' +
  'hover:border-slate-400 ' +
  'focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 focus:shadow'

// Hard character caps for the printed header. The slip is only 576 dots wide, so
// a long line does not wrap — it OVERFLOWS the header box and gets clipped on
// paper. These caps are sized to what fits each line at its font size, and the
// real Chaudhary values sit comfortably inside them (the longest, the tagline, is
// ~63 of its 70). The <input maxLength> makes overflow impossible to type; the
// live preview below shows the true printed width either way.
const SHOP_MAX = {
  shop_name: 26,
  shop_tagline: 70,
  shop_owner: 30,
  shop_phone1: 15,
  shop_phone2: 15,
  shop_phone3: 15,
  shop_address: 46
}

const SHOP_LABEL = {
  shop_name: 'دکان کا نام',
  shop_tagline: 'تعارف',
  shop_owner: 'مالک کا نام',
  shop_phone1: 'فون 1',
  shop_phone2: 'فون 2',
  shop_phone3: 'فون 3',
  shop_address: 'پتہ'
}

const IS_PHONE = (f) => f === 'shop_phone1' || f === 'shop_phone2' || f === 'shop_phone3'

// "22 جولائی، 6:30 شام" — the last manual-backup time, in the shopkeeper's own
// wording. Returns '' for a missing/unparseable stamp so the caller shows the
// "never backed up" line instead of a broken date.
const UR_MONTHS = ['جنوری', 'فروری', 'مارچ', 'اپریل', 'مئی', 'جون', 'جولائی', 'اگست', 'ستمبر', 'اکتوبر', 'نومبر', 'دسمبر']
function urduDateTime(iso) {
  try {
    const d = new Date(iso)
    if (isNaN(d.getTime())) return ''
    const h24 = d.getHours()
    const h = h24 % 12 || 12
    const m = String(d.getMinutes()).padStart(2, '0')
    return `${d.getDate()} ${UR_MONTHS[d.getMonth()]}، ${h}:${m} ${h24 < 12 ? 'صبح' : 'شام'}`
  } catch {
    return ''
  }
}

// unmounts a field's state, only its markup.
// ── Icons ─────────────────────────────────────────────────────────────────────
// Hand-drawn inline SVG, NOT an icon library and NOT emoji. Emoji were tried first
// and are the wrong tool here: Windows renders them in its own font, so they came
// out small, washed-out and inconsistent with the rest of the UI. These take their
// colour from the tile they sit in (`currentColor`), so they are crisp and properly
// coloured on every machine, and they add nothing to the bundle.
const Icon = ({ d, children, ...rest }) => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
       strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
    {d ? <path d={d} /> : children}
  </svg>
)
const ICONS = {
  rates: () => (<Icon><circle cx="12" cy="12" r="8" /><path d="M12 7.5v9M14.5 9.8c0-1-1.1-1.6-2.5-1.6s-2.5.6-2.5 1.6 1 1.4 2.5 1.7 2.6.8 2.6 1.9-1.2 1.7-2.6 1.7-2.6-.6-2.6-1.7" /></Icon>),
  print: () => (<Icon><path d="M7 9V4h10v5" /><rect x="4" y="9" width="16" height="7" rx="1.5" /><path d="M7 14h10v6H7z" /><circle cx="17.5" cy="11.5" r=".9" fill="currentColor" stroke="none" /></Icon>),
  parchi: () => (<Icon><path d="M6 3.5h12v17l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4-2 1.4z" /><path d="M9 8h6M9 12h6" /></Icon>),
  whatsapp: () => (<Icon><path d="M20.5 11.7a8.4 8.4 0 0 1-12.3 7.5L4 20.5l1.4-4.1a8.4 8.4 0 1 1 15.1-4.7z" /><path d="M9 9.5c0 3 2.5 5.5 5.5 5.5" /></Icon>),
  reports: () => (<Icon><path d="M4 20h16" /><rect x="6" y="11" width="3.2" height="6" rx="1" /><rect x="11" y="7" width="3.2" height="10" rx="1" /><rect x="16" y="13" width="3.2" height="4" rx="1" /></Icon>),
  backup: () => (<Icon><ellipse cx="12" cy="6.5" rx="7" ry="2.8" /><path d="M5 6.5v11c0 1.6 3.1 2.8 7 2.8s7-1.2 7-2.8v-11" /><path d="M5 12c0 1.6 3.1 2.8 7 2.8s7-1.2 7-2.8" /></Icon>),
  shop: () => (<Icon><path d="M4 9.5 5.5 5h13L20 9.5" /><path d="M4 9.5h16v10H4z" /><path d="M9.5 19.5v-5h5v5" /></Icon>),
  terms: () => (<Icon><rect x="5" y="3.5" width="14" height="17" rx="2" /><path d="M8.5 8h7M8.5 12h7M8.5 16h4" /></Icon>),
  test: () => (<Icon><path d="M9.5 3.5v6L5 18a2 2 0 0 0 1.8 3h10.4A2 2 0 0 0 19 18l-4.5-8.5v-6" /><path d="M8.5 3.5h7M8 14h8" /></Icon>),
  gear: () => (<Icon width="17" height="17"><circle cx="12" cy="12" r="3.2" /><path d="M12 2.5v2.2M12 19.3v2.2M21.5 12h-2.2M4.7 12H2.5M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6M18.7 18.7l-1.6-1.6M6.9 6.9 5.3 5.3" /></Icon>)
}

// Named aliases so the markup reads as <ShopIcon /> rather than ICONS.shop().
const RatesIcon = ICONS.rates
const PrintIcon = ICONS.print
const ReportsIcon = ICONS.reports
const BackupIcon = ICONS.backup
const ShopIcon = ICONS.shop
const TermsIcon = ICONS.terms
const WhatsappIcon = ICONS.whatsapp
const TestIcon = ICONS.test
const GearIcon = ICONS.gear

// Each category gets its own colour so the rail reads at a glance. `tile` is the
// ACTIVE (filled) look, `soft` the resting one — both hand-picked to stay legible
// on the tinted rail rather than generated, so nothing washes out.
const SECTIONS = [
  { id: 'rates', label: 'ریٹ اور چارجز', hint: 'روزانہ کا ریٹ اور مزدوری', tile: 'from-amber-400 to-amber-500 text-white shadow-amber-500/30', soft: 'bg-amber-50 text-amber-600 border-amber-200', text: 'text-amber-700', ring: 'border-r-amber-500' },
  { id: 'print', label: 'پرنٹ اور پرنٹر', hint: 'سلپ، پرنٹ سائز، ٹیسٹ', tile: 'from-sky-500 to-sky-600 text-white shadow-sky-500/30', soft: 'bg-sky-50 text-sky-600 border-sky-200', text: 'text-sky-700', ring: 'border-r-sky-500' },
  { id: 'parchi', label: 'پرچی', hint: 'ہیڈر اور شرائط', tile: 'from-indigo-500 to-indigo-600 text-white shadow-indigo-500/30', soft: 'bg-indigo-50 text-indigo-600 border-indigo-200', text: 'text-indigo-700', ring: 'border-r-indigo-500' },
  { id: 'whatsapp', label: 'واٹس ایپ', hint: 'یاد دہانی کا پیغام', tile: 'from-emerald-500 to-emerald-600 text-white shadow-emerald-500/30', soft: 'bg-emerald-50 text-emerald-600 border-emerald-200', text: 'text-emerald-700', ring: 'border-r-emerald-500' },
  { id: 'reports', label: 'رپورٹس', hint: 'خودکار رپورٹ فولڈر', tile: 'from-violet-500 to-violet-600 text-white shadow-violet-500/30', soft: 'bg-violet-50 text-violet-600 border-violet-200', text: 'text-violet-700', ring: 'border-r-violet-500' },
  { id: 'backup', label: 'بیک اپ', hint: 'ڈیٹا کی نقل', tile: 'from-rose-500 to-rose-600 text-white shadow-rose-500/30', soft: 'bg-rose-50 text-rose-600 border-rose-200', text: 'text-rose-700', ring: 'border-r-rose-500' }
]
const SECTION_BY_ID = Object.fromEntries(SECTIONS.map((s) => [s.id, s]))

// A card heading: the section's own coloured icon chip + the existing Urdu title.
function CardHead({ icon, tone, children }) {
  return (
    <div className="urdu font-bold text-[14px] text-slate-800 flex items-center gap-2.5 pb-2.5 mb-0.5 border-b border-slate-100">
      <span className={`w-7 h-7 rounded-lg border flex items-center justify-center ${tone}`}>{icon}</span>
      {children}
    </div>
  )
}

// ── Shared button / card skins ────────────────────────────────────────────────
// One place for the dialog's look, so every button in it reads as part of the same
// set instead of each block inventing its own grey box. Purely visual: no button's
// handler, label or disabled rule changes.
// Hover has to be UNMISTAKEABLE — the shopkeeper works on a cheap screen and often
// with a touchpad, so every button lifts, deepens and gains a ring on hover rather
// than shifting one shade of grey. focus-visible gets the same ring for keyboard use.
const BTN_BASE = 'urdu text-[12px] font-bold rounded-lg px-3.5 py-2 border shadow-sm transition-all duration-150 ' +
  'hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 active:shadow-sm ' +
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 ' +
  'disabled:opacity-45 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-sm'
const BTN_PRIMARY = `${BTN_BASE} text-white bg-gradient-to-b from-emerald-500 to-emerald-600 border-emerald-700/40 hover:from-emerald-400 hover:to-emerald-600 focus-visible:ring-emerald-400`
const BTN_DARK = `${BTN_BASE} text-white bg-gradient-to-b from-slate-600 to-slate-700 border-slate-800/40 hover:from-slate-500 hover:to-slate-700 focus-visible:ring-slate-400`
const BTN_SOFT = `${BTN_BASE} text-slate-700 bg-gradient-to-b from-white to-slate-100 border-slate-300 hover:from-white hover:to-blue-50 hover:border-blue-400 hover:text-blue-700 focus-visible:ring-blue-400`
const BTN_QUIET = `${BTN_BASE} text-rose-700 bg-gradient-to-b from-rose-50 to-rose-100 border-rose-200 hover:from-rose-100 hover:to-rose-200 hover:border-rose-400 focus-visible:ring-rose-400`
// White panel each settings group sits on, so a section reads as tidy blocks
// rather than one undivided wall of fields.
const CARD = 'bg-white border border-slate-200 rounded-xl shadow-sm p-4 flex flex-col gap-4'
const CARD_TITLE = 'urdu font-bold text-[14px] text-slate-800 flex items-center gap-2 pb-2.5 mb-0.5 border-b border-slate-100'

// Row helper at module scope so inputs never remount on keystroke (keeps focus).
function Row({ label, children, alignTop }) {
  return (
    <div className={`grid grid-cols-[140px_1fr] gap-3 ${alignTop ? 'items-start' : 'items-center'}`}>
      <label className={`urdu font-bold text-[13px] text-gray-700 text-right ${alignTop ? 'pt-2' : ''}`}>{label}</label>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

// ڈیفالٹ سیٹنگز — rate / charges / parchi / slip-print settings, saved to the
// settings table via the store's saveRates (which also refreshes the live UI).
export default function DefaultsForm({ open, onClose }) {
  const { rates, saveRates, hasApi, exportReportsToDrive } = useApp()
  const [form, setForm] = useState({
    rate_tezabi_tola: '', fc_per_gram: '', parchi_charges: '', slip_count: '1', raw_print_mode: 'auto', print_scale: 1.15,
    print_mode: 'thermal',
    shop_name: '', shop_tagline: '', shop_owner: '', shop_phone1: '', shop_phone2: '', shop_phone3: '', shop_address: '',
    slip_terms: '',
    // واٹس ایپ یاد دہانی template used by the "لینا ہے" balance reports.
    whatsapp_reminder_text: '',
    // Overlay (pre-printed slip) geometry.
    overlay_offx: '0', overlay_offy: '0', overlay_scalex: '1', overlay_scaley: '1',
    overlay_right_dx: '108', overlay_right_dy: '0', overlay_font_pt: '11',
    // Print pipeline + geometry escape hatches. engine 'pdf' = exact-size PDF
    // spooled with scaling disabled (the fix for the rotated/shrunken print);
    // 'driver' hands the page to Windows, which may rescale it.
    overlay_engine: 'pdf', overlay_landscape: false, overlay_rotate180: false,
    overlay_bg_path: '', overlay_coords: null,
    // Dual-printer device names.
    printer_thermal: '', printer_canon: '',
    // Synced (Google Drive) reports folder — blank = feature off.
    reports_dir: ''
  })
  const [reportMsg, setReportMsg] = useState('') // reports-folder test status
  // Manual بیک اپ folder — lives in the main process's own config (NOT the
  // settings table, NOT backup-config.json), so it is read/written separately
  // from `form` and never goes through commit()/saveRates().
  const [backupInfo, setBackupInfo] = useState({ folder: '', lastBackupAt: null })
  const [printers, setPrinters] = useState([]) // installed printers for the two pickers
  // Which category is on screen. Presentation only — it hides markup, never state,
  // so a half-typed field is exactly as the shopkeeper left it when he comes back.
  const [section, setSection] = useState(SECTIONS[0].id)
  const [saved, setSaved] = useState(false)
  const [testMsg, setTestMsg] = useState('')
  const [testBusy, setTestBusy] = useState(false)
  const [overlayMeta, setOverlayMeta] = useState(null)       // {defaultCoords, fieldLabels, sample} for the calibration canvas
  const [ovSel, setOvSel] = useState(null)                   // selected overlay field key (for nudge buttons)
  const [ovMsg, setOvMsg] = useState('')                     // overlay test-print status
  // What the operator measured off the printed proof sheet with a ruler:
  // h/v = the two 100mm bars, x/y = where the 10,10 crosshair actually landed.
  const [meas, setMeas] = useState({ h: '', v: '', x: '', y: '' })
  // Preflight result (PDF spooler present? Canon resolves? custom form present?).
  const [preflight, setPreflight] = useState(null)
  const [copyMsg, setCopyMsg] = useState('')
  const ovCanvasRef = useRef(null)                           // calibration canvas element (px↔mm)
  const ovDrag = useRef(null)                                // active drag {key,startX,startY,ox,oy}
  const savedTimer = useRef(null)
  const saveTimer = useRef(null)
  const previewRef = useRef(null)
  const waRef = useRef(null) // یاد دہانی textarea — chips insert at its caret
  const termsPreviewRef = useRef(null)

  // Load current values from the DB (fall back to the store's rates) on open.
  useEffect(() => {
    if (!open) return
    setSaved(false)
    setSection(SECTIONS[0].id) // every open starts on the first section
    let cancelled = false
    const seed = (r) => {
      const src = r || rates || {}
      if (cancelled) return
      const shop = {}
      for (const f of SHOP_FIELDS) shop[f] = src[f] != null ? String(src[f]) : ''
      setForm({
        rate_tezabi_tola: src.rate_tezabi_tola ?? '',
        fc_per_gram: src.fc_per_gram ?? '',
        parchi_charges: src.parchi_charges ?? '',
        slip_count: src.slip_count != null ? String(src.slip_count) : '1',
        raw_print_mode: src.raw_print_mode === 'force' ? 'force' : 'auto',
        print_scale: src.print_scale != null ? Number(src.print_scale) : 1.15,
        // Only thermal + overlay remain; a legacy 'color_form' loads as thermal.
        print_mode: src.print_mode === 'overlay_form' ? 'overlay_form' : 'thermal',
        ...shop,
        slip_terms: src.slip_terms != null ? String(src.slip_terms) : '',
        // A DB older than the column reads null — show the default so the box is
        // never blank and the shopkeeper sees exactly what will be sent.
        whatsapp_reminder_text: src.whatsapp_reminder_text != null && String(src.whatsapp_reminder_text) !== ''
          ? String(src.whatsapp_reminder_text)
          : WA_REMINDER_DEFAULT,
        overlay_offx: src.overlay_offx != null ? String(src.overlay_offx) : '0',
        overlay_offy: src.overlay_offy != null ? String(src.overlay_offy) : '0',
        overlay_scalex: src.overlay_scalex != null ? String(src.overlay_scalex) : '1',
        overlay_scaley: src.overlay_scaley != null ? String(src.overlay_scaley) : '1',
        overlay_right_dx: src.overlay_right_dx != null ? String(src.overlay_right_dx) : '108',
        overlay_right_dy: src.overlay_right_dy != null ? String(src.overlay_right_dy) : '0',
        overlay_font_pt: src.overlay_font_pt != null ? String(src.overlay_font_pt) : '11',
        overlay_engine: src.overlay_engine === 'driver' ? 'driver' : 'pdf',
        overlay_landscape: !!Number(src.overlay_landscape || 0),
        overlay_rotate180: !!Number(src.overlay_rotate180 || 0),
        overlay_bg_path: src.overlay_bg_path != null ? String(src.overlay_bg_path) : '',
        overlay_coords: (() => { try { return src.overlay_coords ? JSON.parse(src.overlay_coords) : null } catch { return null } })(),
        printer_thermal: src.printer_thermal != null ? String(src.printer_thermal) : '',
        printer_canon: src.printer_canon != null ? String(src.printer_canon) : '',
        reports_dir: src.reports_dir != null ? String(src.reports_dir) : ''
      })
    }
    if (hasApi) window.api.getRates().then(seed)
    else seed(rates)
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Current manual-backup folder + last-backup time, refreshed each time the
  // dialog opens. Advisory only: a failure here just leaves the section blank.
  useEffect(() => {
    if (!open || !hasApi || !window.api.manualBackupStatus) return
    let cancelled = false
    window.api.manualBackupStatus()
      .then((s) => {
        if (cancelled || !s || !s.ok) return
        setBackupInfo({ folder: s.folder || '', lastBackupAt: s.lastBackupAt || null })
      })
      .catch(() => { /* leave the section empty rather than break the dialog */ })
    return () => { cancelled = true }
  }, [open, hasApi])

  // ── Live print preview ──────────────────────────────────────────────────────
  // Re-drawn on EVERY keystroke from the CURRENT (unsaved) form values, using the
  // very same buildSlipHeader() the printer path calls — so what the shopkeeper
  // sees here is, by construction, what comes out of the printer. Clearing a
  // field drops its line here exactly as it drops it on paper.
  useEffect(() => {
    const box = previewRef.current
    if (!open || !box) return
    box.innerHTML = ''
    try { box.appendChild(buildSlipHeader(form)) } catch { /* preview only — never break the form */ }
    // `section` is a dependency because this preview writes into a DOM node that
    // only exists while its own section is on screen: leaving unmounts it, so the
    // effect has to run again when the section returns.
  }, [open, form, section])

  // ── Live terms preview ────────────────────────────────────────────────────────
  // Same construction as the header preview, drawn with the SAME buildSlipTerms()
  // the printer path uses. A blank field returns null → the box vanishes here just
  // as it vanishes from the printed لیب رسید.
  useEffect(() => {
    const box = termsPreviewRef.current
    if (!open || !box) return
    box.innerHTML = ''
    try {
      const node = buildSlipTerms(form.slip_terms)
      if (node) box.appendChild(node)
    } catch { /* preview only — never break the form */ }
    // `section` is a dependency because this preview writes into a DOM node that
    // only exists while its own section is on screen: leaving unmounts it, so the
    // effect has to run again when the section returns.
  }, [open, form, section])

  // Installed printers for the two device-name pickers (dual-printer routing).
  useEffect(() => {
    if (!open || !hasApi || !window.api.listPrinters) return
    let cancelled = false
    window.api.listPrinters().then((r) => {
      if (!cancelled && r && r.ok) setPrinters(r.printers || [])
    }).catch(() => {})
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Fetch the overlay calibration metadata (default coords, labels, sample values)
  // once when overlay mode is selected — the canvas draws draggable chips from it.
  useEffect(() => {
    if (!open || form.print_mode !== 'overlay_form' || !hasApi || !window.api.overlayMeta || overlayMeta) return
    let cancelled = false
    window.api.overlayMeta().then((r) => {
      if (!cancelled && r && r.ok) setOverlayMeta(r)
    }).catch(() => {})
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, form.print_mode])

  // Preflight the overlay print path whenever the dialog opens in overlay mode or
  // the chosen Canon changes — the badge must reflect the CURRENT printer, not a
  // stale check. Re-run after a successful save too (printer_canon may have just
  // changed). Cheap enough (one PowerShell call) to re-run on those edges.
  const runPreflight = useCallback(() => {
    if (!hasApi || !window.api.overlayPreflight) return
    window.api.overlayPreflight().then((r) => { if (r && r.ok) setPreflight(r) }).catch(() => {})
  }, [hasApi])
  useEffect(() => {
    if (!open || form.print_mode !== 'overlay_form') return
    runPreflight()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, form.print_mode, form.printer_canon])

  useEffect(() => () => {
    if (savedTimer.current) clearTimeout(savedTimer.current)
    if (saveTimer.current) clearTimeout(saveTimer.current)
  }, [])

  if (!open) return null

  // ── Overlay calibration helpers ─────────────────────────────────────────────
  const SHEET_W_MM = 215.9
  const SHEET_H_MM = 139.7
  // The live per-field map = default coords with any saved/edited overrides on top.
  const ovCoords = () => ({ ...(overlayMeta?.defaultCoords || {}), ...(form.overlay_coords || {}) })
  const ovRightDX = Number(form.overlay_right_dx) || 0
  const ovRightDY = Number(form.overlay_right_dy) || 0
  // Write a field's new {x,y} (mm, snapped to 0.5) into the map and persist
  // (debounced via commit). Merges over any existing per-field overrides.
  const setFieldCoord = (key, x, y) => {
    const clampedX = Math.max(0, Math.min(SHEET_W_MM, Math.round(x * 2) / 2))
    const clampedY = Math.max(0, Math.min(SHEET_H_MM, Math.round(y * 2) / 2))
    commit({ ...form, overlay_coords: { ...(form.overlay_coords || {}), [key]: { x: clampedX, y: clampedY } } })
  }
  // Nudge the selected field by ±0.5mm.
  const nudge = (dx, dy) => {
    if (!ovSel) return
    const c = ovCoords()[ovSel] || { x: 0, y: 0 }
    setFieldCoord(ovSel, Number(c.x) + dx, Number(c.y) + dy)
  }
  // Drag a LEFT-slip chip (pointer). The RIGHT slip follows via right DX/DY.
  const onChipDown = (key) => (e) => {
    e.preventDefault()
    setOvSel(key)
    const box = ovCanvasRef.current
    if (!box) return
    const rect = box.getBoundingClientRect()
    const pxPerMmX = rect.width / SHEET_W_MM
    const pxPerMmY = rect.height / SHEET_H_MM
    const move = (ev) => {
      const mx = (ev.clientX - rect.left) / pxPerMmX
      const my = (ev.clientY - rect.top) / pxPerMmY
      setFieldCoord(key, mx, my)
    }
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  // Blank-form scan upload → base64 data URL in overlay_bg_path (calibration bg +
  // WhatsApp composite). Capped so the DB stays small.
  const onOverlayBgUpload = (e) => {
    const file = e.target.files && e.target.files[0]
    e.target.value = ''
    if (!file || !/^image\//.test(file.type)) return
    if (file.size > 4 * 1024 * 1024) { setOvMsg('اسکین بہت بڑا ہے (4MB سے کم رکھیں)'); return }
    const reader = new FileReader()
    reader.onload = () => commit({ ...form, overlay_bg_path: String(reader.result || '') })
    reader.readAsDataURL(file)
  }
  // ری سیٹ — snap coords + offsets back to the hardcoded defaults (recovery). Only
  // writes on this explicit click, like every other overlay control.
  const resetOverlay = () => {
    const dc = overlayMeta?.defaultCoords
    if (!dc) return
    const d = overlayMeta?.defaultOffsets || {}
    const s = (v, fallback) => String(v != null ? v : fallback)
    commit({
      ...form,
      overlay_coords: { ...dc },
      overlay_offx: s(d.overlay_offx, '0'), overlay_offy: s(d.overlay_offy, '0'),
      overlay_scalex: s(d.overlay_scalex, '1'), overlay_scaley: s(d.overlay_scaley, '1'),
      overlay_right_dx: s(d.overlay_right_dx, '108'), overlay_right_dy: s(d.overlay_right_dy, '0'),
      overlay_font_pt: s(d.overlay_font_pt, '11'),
      // Reset also puts the pipeline back to the safe combination, so "ری سیٹ"
      // recovers from a bad engine/rotation choice as well as from a bad drag.
      overlay_engine: d.overlay_engine === 'driver' ? 'driver' : 'pdf',
      overlay_landscape: !!Number(d.overlay_landscape || 0),
      overlay_rotate180: !!Number(d.overlay_rotate180 || 0)
    })
    setOvSel(null)
    setOvMsg('ڈیفالٹ پر واپس ✓')
    if (savedTimer.current) clearTimeout(savedTimer.current)
    savedTimer.current = setTimeout(() => setOvMsg(''), 4000)
  }

  // The CURRENT (possibly unsaved) overlay config — shared by the test print and
  // the proof sheet so both prints are made under exactly the same geometry the
  // real slip would use. A proof printed with different settings proves nothing.
  const overlayOverride = () => ({
    offsetX: Number(form.overlay_offx) || 0, offsetY: Number(form.overlay_offy) || 0,
    scaleX: Number(form.overlay_scalex) || 1, scaleY: Number(form.overlay_scaley) || 1,
    rightDX: ovRightDX, rightDY: ovRightDY,
    fontPt: Number(form.overlay_font_pt) || 11,
    engine: form.overlay_engine === 'driver' ? 'driver' : 'pdf',
    landscape: !!form.overlay_landscape,
    rotate180: !!form.overlay_rotate180,
    coords: ovCoords(), bg: form.overlay_bg_path
  })

  // Urdu for the failure codes the overlay path can return, so the operator is
  // told what to DO rather than shown an English reason string.
  const ovReason = (code) => ({
    'canon-printer-not-set': 'کینن پرنٹر منتخب نہیں — اوپر «کینن پرنٹر» میں منتخب کریں',
    'canon-printer-missing': 'منتخب کیا ہوا کینن پرنٹر ونڈوز میں نہیں مل رہا — نام بدل گیا یا پرنٹر ہٹا دیا گیا ہے',
    'no-printers-installed': 'ونڈوز میں کوئی پرنٹر نصب نہیں',
    'pdf-engine-unavailable': 'PDF انجن دستیاب نہیں (سپولر غائب) — پرچی ضائع ہونے سے بچانے کے لیے پرنٹ روک دیا گیا',
    'default-paper-mismatch': 'پرنٹر کا ڈیفالٹ کاغذ پرچی کے ناپ کا نہیں — GOLDLAB PARCHI کو ڈیفالٹ بنائیں',
    'pdf-spooler-missing': 'PDF سپولر موجود نہیں — ونڈوز ڈرائیور سے چھپا (سائز بدل سکتا ہے)',
    'pdf-spool-timeout': 'پرنٹر نے دیر لگائی — دوبارہ نہیں بھیجا گیا',
    timeout: 'پرنٹر نے جواب نہیں دیا'
  }[code] || code || 'نامعلوم مسئلہ')

  // Copy the Windows custom-form click-path (built in electron/printerForms.cjs so
  // it never drifts from the printed footer) to the clipboard for WhatsApp.
  const copyFormInstructions = async () => {
    try {
      const r = hasApi && window.api.overlayFormInstructions ? await window.api.overlayFormInstructions() : null
      const text = r && r.ok ? r.text : ''
      if (!text) { setCopyMsg('ہدایات نہیں ملیں'); return }
      await navigator.clipboard.writeText(text)
      setCopyMsg('کاپی ہو گیا ✓')
    } catch { setCopyMsg('کاپی نہیں ہو سکا') }
    setTimeout(() => setCopyMsg(''), 4000)
  }

  // ٹیسٹ پرنٹ — print the values-only overlay with the CURRENT (unsaved) calibration.
  const runOverlayTest = async () => {
    if (!hasApi || !window.api.overlayTestPrint || testBusy) return
    setTestBusy(true); setOvMsg('ٹیسٹ پرنٹ ہو رہا ہے…')
    try {
      const res = await window.api.overlayTestPrint(overlayOverride())
      setOvMsg(res && res.ok
        ? `ٹیسٹ پرنٹ ہو گیا ✓ (${res.engine === 'pdf' ? 'PDF' : 'ڈرائیور'})`
        : `ناکام: ${ovReason(res && res.reason)}`)
    } catch (e) { setOvMsg(`ناکام: ${e && e.message ? e.message : e}`) }
    finally {
      setTestBusy(false)
      if (savedTimer.current) clearTimeout(savedTimer.current)
      savedTimer.current = setTimeout(() => setOvMsg(''), 6000)
    }
  }

  // پروف شیٹ — the SAME pipeline, on PLAIN paper: grid + crosshairs + two 100mm
  // bars. Measuring those bars is the only way to find out what the Windows
  // driver actually did to the page; no pre-printed slip is consumed.
  const runOverlayProof = async () => {
    if (!hasApi || !window.api.overlayProofPrint || testBusy) return
    setTestBusy(true); setOvMsg('پروف شیٹ چھپ رہی ہے… (سادہ کاغذ ڈالیں)')
    try {
      const res = await window.api.overlayProofPrint(overlayOverride())
      setOvMsg(res && res.ok
        ? `پروف شیٹ نکل گئی ✓ (${res.engine === 'pdf' ? 'PDF' : 'ڈرائیور'}) — اب دونوں 100mm بار ناپیں`
        : `ناکام: ${ovReason(res && res.reason)}`)
    } catch (e) { setOvMsg(`ناکام: ${e && e.message ? e.message : e}`) }
    finally {
      setTestBusy(false)
      if (savedTimer.current) clearTimeout(savedTimer.current)
      savedTimer.current = setTimeout(() => setOvMsg(''), 8000)
    }
  }

  // ── Calibration FROM MEASUREMENTS (the proof sheet), not from dragging ───────
  // Dragging chips over an on-screen scan can only ever fix screen-space error; it
  // is blind to what the printer does to the page. These four numbers come off the
  // printed proof sheet with a ruler and describe the printer's ACTUAL behaviour:
  //   scale  = 100 / (length the 100mm bar really printed)
  //   offset = 10  - (where the 10,10 crosshair really landed)
  const applyMeasured = () => {
    const h = Number(meas.h); const v = Number(meas.v)
    const cx = Number(meas.x); const cy = Number(meas.y)
    const next = { ...form }
    let changed = 0
    if (Number.isFinite(h) && h > 0) { next.overlay_scalex = String(Math.round((100 / h) * 10000) / 10000); changed++ }
    if (Number.isFinite(v) && v > 0) { next.overlay_scaley = String(Math.round((100 / v) * 10000) / 10000); changed++ }
    if (Number.isFinite(cx)) { next.overlay_offx = String(Math.round((10 - cx) * 100) / 100); changed++ }
    if (Number.isFinite(cy)) { next.overlay_offy = String(Math.round((10 - cy) * 100) / 100); changed++ }
    if (!changed) { setOvMsg('پہلے ناپ کے نمبر لکھیں'); return }
    commit(next)
    setOvMsg('ناپ لاگو ہو گیا ✓ — اب دوبارہ پروف شیٹ نکال کر تصدیق کریں')
    if (savedTimer.current) clearTimeout(savedTimer.current)
    savedTimer.current = setTimeout(() => setOvMsg(''), 8000)
  }

  // Persist the given form snapshot to the DB + store, and flash the saved tick.
  const persist = async (next) => {
    // Shop fields go through as TEXT, trimmed — including '' when the shopkeeper
    // clears one, which is what removes that line from the printed header.
    const shop = {}
    for (const f of SHOP_FIELDS) shop[f] = String(next[f] ?? '').trim()
    await saveRates({
      rate_tezabi_tola: Number(next.rate_tezabi_tola) || 0,
      fc_per_gram: Number(next.fc_per_gram) || 0,
      parchi_charges: Number(next.parchi_charges) || 0,
      slip_count: Math.max(1, parseInt(next.slip_count, 10) || 1),
      raw_print_mode: next.raw_print_mode === 'force' ? 'force' : 'auto',
      print_scale: Number(next.print_scale) || 1.15,
      // Only thermal + overlay remain; anything else is stored as thermal.
      print_mode: next.print_mode === 'overlay_form' ? 'overlay_form' : 'thermal',
      // Overlay (pre-printed slip) geometry + the calibrated coordinate map + scan.
      overlay_paper: 'halfletter_landscape',
      overlay_offx: Number(next.overlay_offx) || 0,
      overlay_offy: Number(next.overlay_offy) || 0,
      overlay_scalex: Number(next.overlay_scalex) || 1,
      overlay_scaley: Number(next.overlay_scaley) || 1,
      overlay_right_dx: Number.isFinite(Number(next.overlay_right_dx)) ? Number(next.overlay_right_dx) : 108,
      overlay_right_dy: Number(next.overlay_right_dy) || 0,
      overlay_font_pt: Number(next.overlay_font_pt) || 11,
      // Pipeline + geometry escape hatches (stored 0/1; engine clamped in db.cjs).
      overlay_engine: next.overlay_engine === 'driver' ? 'driver' : 'pdf',
      overlay_landscape: next.overlay_landscape ? 1 : 0,
      overlay_rotate180: next.overlay_rotate180 ? 1 : 0,
      overlay_bg_path: String(next.overlay_bg_path ?? ''),
      overlay_coords: next.overlay_coords ? JSON.stringify(next.overlay_coords) : undefined,
      // Dual-printer device names ('' clears → Windows default).
      printer_thermal: String(next.printer_thermal ?? ''),
      printer_canon: String(next.printer_canon ?? ''),
      // Synced reports folder ('' → feature off).
      reports_dir: String(next.reports_dir ?? '').trim(),
      ...shop,
      slip_terms: String(next.slip_terms ?? '').trim(),
      whatsapp_reminder_text: String(next.whatsapp_reminder_text ?? '').trim()
    })
    setSaved(true)
    if (savedTimer.current) clearTimeout(savedTimer.current)
    savedTimer.current = setTimeout(() => setSaved(false), 1200)
  }

  // Auto-save: update the field, then debounce a write ~500ms after typing stops.
  const commit = (next) => {
    setForm(next)
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => persist(next), 500)
  }

  // Accept digits and a single decimal point only.
  const numField = (field) => (e) => {
    const v = e.target.value.replace(/[^\d.]/g, '')
    commit({ ...form, [field]: v })
  }
  // Slip print: integer only.
  const onSlip = (e) => {
    const v = e.target.value.replace(/[^\d]/g, '')
    commit({ ...form, slip_count: v })
  }

  // Shop header fields. maxLength on the input is the real guard (typing past the
  // cap is simply refused); the slice here is belt-and-braces for a PASTE, which
  // some browsers let through. Phones additionally accept only digits, spaces and
  // dashes, so a stray letter can never reach the printed header.
  const shopField = (field) => (e) => {
    let v = e.target.value
    if (IS_PHONE(field)) v = v.replace(/[^\d\s-]/g, '')
    commit({ ...form, [field]: v.slice(0, SHOP_MAX[field]) })
  }

  // لیب رسید terms paragraph. Same commit()/debounce as the header fields; the
  // slice mirrors the textarea's maxLength (belt-and-braces for a paste).
  const termsField = (e) => commit({ ...form, slip_terms: e.target.value.slice(0, 400) })

  // ── واٹس ایپ یاد دہانی template ────────────────────────────────────────────────
  // Same commit()/debounce path as every other field here.
  const waField = (e) => commit({ ...form, whatsapp_reminder_text: e.target.value.slice(0, 400) })
  // Insert a placeholder AT THE CURSOR (or over the selection), then put the caret
  // just after it — typing a template shouldn't mean retyping the braces by hand.
  const insertPlaceholder = (token) => {
    const el = waRef.current
    const cur = String(form.whatsapp_reminder_text ?? '')
    const start = el ? el.selectionStart : cur.length
    const end = el ? el.selectionEnd : cur.length
    const next = (cur.slice(0, start) + token + cur.slice(end)).slice(0, 400)
    commit({ ...form, whatsapp_reminder_text: next })
    // The textarea is controlled, so the caret has to be restored after React
    // re-renders with the new value.
    requestAnimationFrame(() => {
      if (!waRef.current) return
      const pos = Math.min(start + token.length, 400)
      waRef.current.focus()
      waRef.current.setSelectionRange(pos, pos)
    })
  }
  // Live preview — the SAME fillReminder() the report sends with, so this is not an
  // approximation of the message: it IS the message. Shown for both reports so it is
  // obvious one template serves rupees and تولہ alike.
  const waPreview = (amount) => fillReminder(form.whatsapp_reminder_text, amount)

  // Direct-thermal test pages (کیلیبریشن / ورسٹ کیس) — print via the raw
  // ESC/POS raster path to the DEFAULT printer so the paper itself proves the
  // geometry: full border, mm ticks, 10mm reference square, edge texts.
  const runTest = async (kind, label) => {
    if (!hasApi || !window.api.rasterTestPrint || testBusy) return
    setTestBusy(true)
    setTestMsg(`${label} پرنٹ ہو رہا ہے…`)
    try {
      const res = await window.api.rasterTestPrint(kind)
      setTestMsg(res && res.ok
        ? `${label} پرنٹ ہو گیا ✓${res.printer ? ` (${res.printer})` : ''}`
        : `ناکام: ${res && res.reason ? res.reason : 'نامعلوم مسئلہ'}`)
    } catch (e) {
      setTestMsg(`ناکام: ${e && e.message ? e.message : e}`)
    } finally {
      setTestBusy(false)
      if (savedTimer.current) clearTimeout(savedTimer.current)
      savedTimer.current = setTimeout(() => setTestMsg(''), 6000)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/50 flex items-start justify-center p-4 pt-[40px]"
      onClick={onClose}
    >
      <div
        dir="rtl"
        className="relative bg-gray-50 border border-gray-300 rounded-lg shadow-2xl w-[720px] h-[620px] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Title bar */}
        <div className="flex items-center justify-between bg-gradient-to-l from-slate-800 via-slate-800 to-slate-700 border-b border-slate-900/40 px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="w-8 h-8 shrink-0 rounded-lg bg-gradient-to-b from-blue-500 to-blue-600 border border-blue-400/40 shadow text-white flex items-center justify-center"><GearIcon /></span>
            <div className="flex flex-col leading-tight">
              <h2 className="urdu font-bold text-[16px] text-white">ڈیفالٹ سیٹنگز</h2>
              <span className="urdu text-[11px] text-slate-300">تبدیلی خود بخود محفوظ ہوتی ہے</span>
            </div>
            {/* subtle auto-save indicator — no button, just feedback */}
            <span className={`urdu flex items-center gap-1 text-[11.5px] font-bold text-emerald-300 bg-emerald-500/15 border border-emerald-400/30 rounded-full px-2.5 py-1 transition-opacity duration-300 ${saved ? 'opacity-100' : 'opacity-0'}`}>
              محفوظ ہو گیا ✓
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            title="بند کریں"
            className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-300 hover:bg-red-500 hover:text-white transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Body — scrolls: the shop-header block + its print preview make this
            taller than a short screen. */}
        {/* Two panes. RTL, so the category list sits on the RIGHT (first child) and
            the settings on the left. The card height is FIXED and only the content
            pane scrolls, so switching category never resizes or jumps the dialog.
            Sized to fit a 1366×768 shop laptop with room to spare. */}
        <div className="flex-1 min-h-0 flex">
          {/* Category list — most-used first (rates every day, backup rarely). The
              active row is a white card lifted off the tinted rail with a blue edge:
              the same "selected tab" language the report screens already use. */}
          <nav className="w-[190px] shrink-0 bg-gradient-to-b from-slate-800 to-slate-900 overflow-y-auto py-3 px-2.5 flex flex-col gap-1.5">
            {SECTIONS.map((s) => {
              const active = section === s.id
              const Glyph = ICONS[s.id]
              return (
                <button
                  key={s.id}
                  type="button"
                  data-section={s.id}
                  aria-current={active ? 'true' : undefined}
                  onClick={() => setSection(s.id)}
                  title={s.hint}
                  className={`group w-full text-right rounded-xl px-2.5 py-2 flex items-center gap-2.5 border transition-all duration-150 focus:outline-none ${
                    active
                      ? `bg-white shadow-lg border-white/60 border-r-[3px] ${s.ring}`
                      : 'border-transparent text-slate-300 hover:bg-white/10 hover:border-white/15 hover:translate-x-[-2px]'
                  }`}
                >
                  {/* Colour tile: filled when active, tinted-but-still-coloured on
                      hover, so the eye finds the row it is on immediately. */}
                  <span className={`w-8 h-8 shrink-0 rounded-lg border flex items-center justify-center transition-all duration-150 ${
                    active
                      ? `bg-gradient-to-b ${s.tile} border-transparent shadow-md`
                      : 'bg-white/10 border-white/15 text-slate-300 group-hover:bg-white group-hover:border-transparent group-hover:text-slate-800 group-hover:shadow'
                  }`}>
                    <Glyph />
                  </span>
                  <span className="flex flex-col min-w-0 leading-tight">
                    <span className={`urdu text-[12.5px] truncate transition-colors ${active ? `font-bold ${s.text}` : 'font-medium text-slate-200 group-hover:text-white'}`}>
                      {s.label}
                    </span>
                    <span className={`urdu text-[9.5px] truncate transition-colors ${active ? 'text-slate-500' : 'text-slate-400 group-hover:text-slate-300'}`}>
                      {s.hint}
                    </span>
                  </span>
                </button>
              )
            })}
          </nav>

          {/* Content pane — the ONLY scrolling area. */}
          <div className="flex-1 min-w-0 overflow-y-auto p-4 flex flex-col gap-4 bg-slate-50">
          {section === 'rates' && (
            <div className="flex flex-col gap-4">
              <div className={CARD}>
              <CardHead icon={<RatesIcon />} tone="bg-amber-50 text-amber-600 border-amber-200">ریٹ اور چارجز</CardHead>
          <Row label="ریٹ">
            <input dir="ltr" className={INPUT} value={form.rate_tezabi_tola} onChange={numField('rate_tezabi_tola')} inputMode="decimal" placeholder="0" />
          </Row>

          <Row label="چارجز فی گرام">
            <input dir="ltr" className={INPUT} value={form.fc_per_gram} onChange={numField('fc_per_gram')} inputMode="decimal" placeholder="0" />
          </Row>

          <Row label="چارج پرچی">
            <input dir="ltr" className={INPUT} value={form.parchi_charges} onChange={numField('parchi_charges')} inputMode="decimal" placeholder="0" />
          </Row>
              </div>
            </div>
          )}

          {section === 'print' && (
            <div className="flex flex-col gap-4">
              <div className={CARD}>
              <CardHead icon={<PrintIcon />} tone="bg-sky-50 text-sky-600 border-sky-200">پرنٹ کی ترتیبات</CardHead>
          <Row label="سلپ پرنٹ">
            <input
              dir="ltr"
              className={`${INPUT} w-28`}
              value={form.slip_count}
              onChange={onSlip}
              inputMode="numeric"
              min={1}
              placeholder="1"
            />
          </Row>

          {/* تھرمل پرنٹر پر براہِ راست (raw ESC/POS) — when ON, every default
              printer is treated as thermal and uses the raw path (bypasses the
              name check). Leave OFF to auto-detect by printer name. */}
          <Row label="تھرمل پرنٹر پر براہِ راست پرنٹ">
            <label className="flex items-center gap-2.5 cursor-pointer select-none rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 transition-colors hover:bg-blue-50 hover:border-blue-300">
              <input
                type="checkbox"
                className="w-4 h-4 cursor-pointer accent-blue-600"
                checked={form.raw_print_mode === 'force'}
                onChange={(e) => commit({ ...form, raw_print_mode: e.target.checked ? 'force' : 'auto' })}
              />
              <span className="urdu text-[12px] text-gray-600">
                {form.raw_print_mode === 'force' ? 'ہر پرنٹر پر براہِ راست (فورس)' : 'خودکار (پرنٹر کے نام سے پہچان)'}
              </span>
            </label>
          </Row>

          {/* پرنٹ سائز — thermal render magnification 1.00–1.35 (bigger/longer slip). */}
          <Row label="پرنٹ سائز">
            <select
              className={`${INPUT} w-28`}
              value={Number(form.print_scale).toFixed(2)}
              onChange={(e) => commit({ ...form, print_scale: Number(e.target.value) })}
            >
              {['1.00', '1.05', '1.10', '1.15', '1.20', '1.25', '1.30', '1.35'].map((v) => (
                <option key={v} value={v}>{v}×</option>
              ))}
            </select>
          </Row>
              </div>

              <div className={CARD}>
              <CardHead icon={<PrintIcon />} tone="bg-sky-50 text-sky-600 border-sky-200">پرنٹر کی قسم</CardHead>
            <CardHead icon={<PrintIcon />} tone="bg-sky-50 text-sky-600 border-sky-200">پرنٹر کی قسم</CardHead>
            <div className="flex flex-col gap-2">
              {[
                { v: 'thermal', label: 'تھرمل (80mm رول)' },
                { v: 'overlay_form', label: 'اوورلے (پہلے سے چھپی پرچی — صرف لیب رسید)' }
              ].map((o) => (
                <label key={o.v} className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="radio"
                    name="print_mode"
                    className="w-4 h-4 cursor-pointer"
                    checked={form.print_mode === o.v}
                    onChange={() => commit({ ...form, print_mode: o.v })}
                  />
                  <span className="urdu text-[13px] text-gray-700">{o.label}</span>
                </label>
              ))}
            </div>

            {/* ── دو پرنٹر (تھرمل + کینن) — کمپیوٹر پر دونوں لگے ہیں؛ ہر جاب خودکار
                درست پرنٹر پر جائے۔ ایک بار منتخب کریں. */}
            <div className="flex flex-col gap-2">
              <div className="urdu font-bold text-[13px] text-gray-700">پرنٹر منتخب کریں (دو پرنٹر)</div>
              {[
                ['printer_thermal', 'تھرمل پرنٹر (رسیدیں)'],
                ['printer_canon', 'کینن پرنٹر (فارم/اوورلے)']
              ].map(([f, label]) => (
                <Row key={f} label={label}>
                  <select
                    className={`${INPUT}`}
                    value={form[f] || ''}
                    onChange={(e) => commit({ ...form, [f]: e.target.value })}
                  >
                    <option value="">— ونڈوز ڈیفالٹ —</option>
                    {printers.map((p) => (
                      <option key={p.name} value={p.name}>{p.displayName || p.name}{p.isDefault ? ' (ڈیفالٹ)' : ''}</option>
                    ))}
                  </select>
                </Row>
              ))}
              {form.print_mode === 'overlay_form' && !form.printer_canon && (
                <div className="urdu text-[11px] text-red-600">اوورلے کے لیے «کینن پرنٹر» منتخب کرنا ضروری ہے۔</div>
              )}
            </div>
              </div>

              {form.print_mode !== 'overlay_form' && (<>
          {/* Direct-thermal printer test pages: calibration sheet (border, mm
              ticks, 10mm square, edge texts) + worst-case receipt. Paper-level
              proof that width/sharpness are correct on THIS shop's printer. */}
          <div className={CARD}>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="urdu font-bold text-[13px] text-slate-800 flex items-center gap-2"><span className="w-6 h-6 rounded-md bg-sky-50 text-sky-600 border border-sky-200 flex items-center justify-center"><TestIcon /></span>پرنٹر ٹیسٹ (ڈائریکٹ تھرمل)</div>
                {testMsg
                  ? <div className="urdu text-[12px] text-emerald-600 break-all">{testMsg}</div>
                  : <div className="urdu text-[11px] text-gray-500">چوڑائی اور صفائی جانچنے کے لیے ٹیسٹ پرچی نکالیں</div>}
              </div>
              <div className="flex gap-2 shrink-0">
                <button
                  type="button"
                  disabled={testBusy}
                  onClick={() => runTest('calibration', 'کیلیبریشن')}
                  className={BTN_DARK}
                >
                  کیلیبریشن
                </button>
                <button
                  type="button"
                  disabled={testBusy}
                  onClick={() => runTest('worstcase', 'ورسٹ کیس')}
                  className={BTN_DARK}
                >
                  ورسٹ کیس
                </button>
              </div>
            </div>
          </div>
              </>)}
            </div>
          )}

          {section === 'parchi' && (
            <div className="flex flex-col gap-4">
              {form.print_mode !== 'overlay_form' && (<>
          {/* ── پرچی ہیڈر — the shop identity printed at the top of every slip.
              Each field is capped (SHOP_MAX) so a long line can never overflow
              the 576-dot header box and get clipped on paper. Empty a field and
              its line vanishes — from the preview and from the printout alike. */}
          <div className={CARD}>
            <CardHead icon={<ShopIcon />} tone="bg-indigo-50 text-indigo-600 border-indigo-200">پرچی ہیڈر (دکان کی معلومات)</CardHead>

            {SHOP_FIELDS.map((f) => (
              <Row key={f} label={SHOP_LABEL[f]}>
                <input
                  dir={IS_PHONE(f) ? 'ltr' : 'rtl'}
                  className={`${INPUT} ${IS_PHONE(f) ? '' : 'urdu'}`}
                  value={form[f]}
                  onChange={shopField(f)}
                  maxLength={SHOP_MAX[f]}
                  inputMode={IS_PHONE(f) ? 'tel' : 'text'}
                  placeholder={IS_PHONE(f) ? '0300-0000000' : ''}
                />
              </Row>
            ))}

            {/* Live preview — the SAME buildSlipHeader() the printer uses, drawn
                from the current (unsaved) values on every keystroke, at the slip's
                real design width. White paper, black ink, so it reads as the slip.
                THERMAL MODE ONLY (overlay prints values onto a pre-printed slip). */}
            {form.print_mode === 'thermal' && (
              <div className="flex flex-col gap-2">
                <div className="urdu font-bold text-[13px] text-gray-700">پرنٹ پیش منظر</div>
                <div className="flex justify-center">
                  {/* The paper's edge (border + padding) is the OUTER box. The inner
                      box the header renders into is EXACTLY SLIP_DESIGN_W — padding
                      here would narrow it, and the preview would then wrap a long
                      line one word earlier than the printer actually does. */}
                  <div className="border border-gray-300 rounded-sm shadow-sm p-2 bg-white">
                    <div
                      ref={previewRef}
                      dir="rtl"
                      style={{ width: SLIP_DESIGN_W, background: '#fff', color: '#000' }}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ── پرچی کی شرائط — the لیب رسید terms/fee paragraph printed in a
              bordered box on lab receipts only. A paragraph, so a <textarea>.
              Clearing it removes the box from the slip (buildSlipTerms → null). */}
          <div className={CARD}>
            <CardHead icon={<TermsIcon />} tone="bg-indigo-50 text-indigo-600 border-indigo-200">پرچی کی شرائط (لیب رسید)</CardHead>

            <textarea
              dir="rtl"
              className={`${INPUT} urdu resize-none leading-loose`}
              rows={4}
              maxLength={400}
              value={form.slip_terms}
              onChange={termsField}
            />
            <div className="urdu text-[11px] text-gray-500">خالی چھوڑنے پر یہ باکس پرچی سے ہٹ جائے گا۔</div>

            {/* Live preview — same buildSlipTerms() the printer uses, redrawn on
                every keystroke at the slip's real design width. Empty when blank,
                matching the box vanishing from paper. THERMAL MODE ONLY (in Canon
                mode the terms show inside the colour-form preview above). */}
            {form.print_mode === 'thermal' && (
              <div className="flex flex-col gap-2">
                <div className="urdu font-bold text-[13px] text-gray-700">پرنٹ پیش منظر</div>
                <div className="flex justify-center">
                  <div className="border border-gray-300 rounded-sm shadow-sm p-2 bg-white">
                    <div
                      ref={termsPreviewRef}
                      dir="rtl"
                      style={{ width: SLIP_DESIGN_W, background: '#fff', color: '#000' }}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
              </>)}

            {/* ── اوورلے (پہلے سے چھپی پرچی) — LAB رسید only. VALUES ONLY over the
                pre-printed 2-up slip. Calibrate visually against the shop's own scan. */}
            {form.print_mode === 'overlay_form' && (() => {
              const ovNum = (field) => (e) => commit({ ...form, [field]: e.target.value.replace(/[^\d.\-]/g, '') })
              const coords = ovCoords()
              const sample = overlayMeta?.sample || {}
              const labels = overlayMeta?.fieldLabels || {}
              const keys = Object.keys(coords)
              return (
                <div className="flex flex-col gap-4">
                  <div className="urdu text-[11px] text-gray-500">
                    یہ صرف <b>لیب رسید</b> کے لیے ہے۔ سافٹ ویئر آپ کی پہلے سے چھپی پرچی کے خالی خانوں میں صرف
                    ویلیوز چھاپتا ہے (2 کاپیاں — بائیں گاہک، دائیں دکان). ادھار/نقد تھرمل ہی رہیں گی۔ نیچے اپنی
                    خالی پرچی کا اسکین لگا کر ہر ویلیو کو اس کے خانے پر گھسیٹیں، پھر ٹیسٹ پرنٹ نکال کر ملا لیں۔
                  </div>

                  {/* Blank-form scan */}
                  <Row label="خالی پرچی کا اسکین" alignTop>
                    <div className="flex flex-col gap-2">
                      {form.overlay_bg_path
                        ? <img src={form.overlay_bg_path} alt="scan" className="max-h-20 w-auto object-contain border border-gray-200 rounded bg-white p-1" />
                        : <span className="urdu text-[11px] text-gray-500">اسکین نہیں — کیلیبریشن کے لیے لگائیں</span>}
                      <div className="flex gap-2">
                        <label className="urdu text-[12px] font-bold text-white bg-slate-600 rounded-md px-3 py-1.5 cursor-pointer hover:bg-slate-700">
                          اسکین منتخب کریں
                          <input type="file" accept="image/*" className="hidden" onChange={onOverlayBgUpload} />
                        </label>
                        {form.overlay_bg_path && (
                          <button type="button" onClick={() => commit({ ...form, overlay_bg_path: '' })}
                            className="urdu text-[12px] font-bold text-gray-700 bg-gray-200 rounded-md px-3 py-1.5 hover:bg-gray-300">ہٹا دیں</button>
                        )}
                      </div>
                    </div>
                  </Row>

                  {/* Global geometry */}
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                    {[
                      ['overlay_offx', 'آفسیٹ X (mm)'], ['overlay_offy', 'آفسیٹ Y (mm)'],
                      ['overlay_scalex', 'اسکیل X'], ['overlay_scaley', 'اسکیل Y'],
                      ['overlay_right_dx', 'دائیں کاپی X (mm)'], ['overlay_right_dy', 'دائیں کاپی Y (mm)'],
                      ['overlay_font_pt', 'فونٹ (pt)']
                    ].map(([f, label]) => (
                      <label key={f} className="flex items-center justify-between gap-2">
                        <span className="urdu text-[12px] text-gray-700 truncate">{label}</span>
                        <input dir="ltr" inputMode="decimal" value={form[f]} onChange={ovNum(f)}
                          className={`${INPUT} w-20 py-1`} />
                      </label>
                    ))}
                  </div>

                  {/* Preflight badge — the persistent readiness indicator. Green
                      only when a real slip WILL print at exact size; amber warns
                      that a slip could be wasted before the operator finds out. */}
                  {preflight && (() => {
                    const engPdf = preflight.engine === 'pdf' && preflight.spooler
                    const ready = engPdf && (preflight.canonFound || !preflight.canonSet)
                    const cls = ready
                      ? 'border-emerald-400 bg-emerald-50 text-emerald-800'
                      : 'border-amber-400 bg-amber-50 text-amber-800'
                    return (
                      <div className={`flex flex-col gap-1 border rounded-md p-3 ${cls}`}>
                        <div className="urdu font-bold text-[13px]">
                          {engPdf
                            ? 'پرنٹ انجن: PDF (عین ناپ) ✅'
                            : 'پرنٹ انجن: ڈرائیور (فال بیک) ⚠️ — پرچی ضائع ہو سکتی ہے'}
                        </div>
                        {!preflight.spooler && preflight.engine === 'pdf' && (
                          <div className="urdu text-[11px]">
                            PDF سپولر (SumatraPDF) موجود نہیں — اصل پرچی پرنٹ رُک جائے گی۔ ایپ دوبارہ انسٹال کریں یا سپورٹ سے رابطہ کریں۔
                          </div>
                        )}
                        {preflight.canonSet && !preflight.canonFound && (
                          <div className="urdu text-[11px]">منتخب کینن پرنٹر «{preflight.canonName}» ونڈوز میں نہیں مل رہا۔</div>
                        )}
                        {!preflight.canonSet && (
                          <div className="urdu text-[11px]">کینن پرنٹر ابھی منتخب نہیں (اوپر «کینن پرنٹر» میں کریں)۔</div>
                        )}
                        {/* Windows custom form (215.9×139.7). null = couldn't read. */}
                        {preflight.formPresent === true && (
                          <div className="urdu text-[11px]">کاغذ کا ناپ موجود ✓ («{preflight.formName}»)</div>
                        )}
                        {/* Centering risk: form exists but is not the DEFAULT paper.
                            noscale centres on the default, so values shift off the slip. */}
                        {preflight.defaultPaperOk === false && (
                          <div className="urdu text-[11px] text-amber-900 font-bold">
                            پرنٹر کا ڈیفالٹ کاغذ «{preflight.defaultPaperName}» ہے — GOLDLAB PARCHI نہیں۔
                            Printing Preferences میں GOLDLAB PARCHI کو ڈیفالٹ بنائیں، ورنہ ویلیوز نیچے کھسک کر پرچی سے باہر چھپیں گی۔
                          </div>
                        )}
                        {preflight.defaultPaperOk === true && (
                          <div className="urdu text-[11px]">ڈیفالٹ کاغذ درست ✓</div>
                        )}
                        {preflight.formPresent === false && (
                          <div className="urdu text-[11px] text-amber-900 font-bold">
                            پرنٹر میں 215.9×139.7mm کا فارم نہیں — نیچے دی گئی ہدایات سے بنائیں (ورنہ ڈرائیور صفحہ گھما/چھوٹا کر سکتا ہے)۔
                          </div>
                        )}
                        {preflight.canonFound && preflight.formPresent == null && preflight.canonSet && (
                          <div className="urdu text-[11px]">کاغذ کے ناپ کی جانچ نہیں ہو سکی — پروف شیٹ سے تصدیق کریں۔</div>
                        )}
                        <button type="button" onClick={runPreflight}
                          className="urdu text-[11px] font-bold text-gray-700 bg-white/70 border border-current/30 rounded px-2 py-0.5 self-start mt-1">
                          دوبارہ جانچیں
                        </button>
                      </div>
                    )
                  })()}

                  {/* Windows custom form — instructions + copy-for-WhatsApp. Shown
                      when the form is missing OR the check couldn't run. */}
                  {preflight && preflight.formPresent !== true && (
                    <div className="flex flex-col gap-2 border border-sky-300 bg-sky-50 rounded-md p-3">
                      <div className="urdu font-bold text-[13px] text-gray-800">پرنٹر میں کاغذ کا ناپ بنائیں (ایک بار)</div>
                      <div className="urdu text-[11px] text-gray-600 leading-relaxed">
                        Print Server Properties → Create a new form → «GOLDLAB PARCHI» → 21.59cm × 13.97cm → Save →
                        Canon Printing Preferences میں یہی فارم منتخب کریں → Scaling: Off / 100% / Actual size → Auto-rotate: Off۔
                      </div>
                      <div className="flex items-center gap-2">
                        <button type="button" onClick={copyFormInstructions}
                          className="urdu text-[12px] font-bold text-white bg-sky-600 rounded-md px-3 py-1.5 hover:bg-sky-700">
                          کاپی کریں (واٹس ایپ کے لیے)
                        </button>
                        {copyMsg && <span className="urdu text-[11px] text-sky-700">{copyMsg}</span>}
                      </div>
                    </div>
                  )}

                  {/* Print pipeline + geometry escape hatches */}
                  <div className="flex flex-col gap-2 border border-gray-200 rounded-md p-3">
                    <div className="urdu font-bold text-[13px] text-gray-700">پرنٹ کا طریقہ</div>
                    <div className="urdu text-[11px] text-gray-500 leading-relaxed">
                      <b>PDF</b> — پرچی کے عین ناپ کی PDF بنا کر پرنٹر کو بھیجی جاتی ہے، سائز بدلنے کی اجازت کے بغیر۔
                      یہی صحیح طریقہ ہے۔ <b>ونڈوز ڈرائیور</b> صرف اُس وقت چنیں جب PDF والا کام نہ کرے — ڈرائیور صفحہ
                      خود گھما یا چھوٹا کر سکتا ہے (اسی سے ویلیوز ٹیڑھی اور خانوں سے باہر چھپ رہی تھیں)۔
                    </div>
                    <label className="flex items-center justify-between gap-2">
                      <span className="urdu text-[12px] text-gray-700">انجن</span>
                      <select dir="rtl" value={form.overlay_engine}
                        onChange={(e) => commit({ ...form, overlay_engine: e.target.value })}
                        className={`${INPUT} urdu w-56 py-1`}>
                        <option value="pdf">PDF (عین ناپ — تجویز کردہ)</option>
                        <option value="driver">ونڈوز ڈرائیور (متبادل)</option>
                      </select>
                    </label>
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={!!form.overlay_rotate180}
                        onChange={(e) => commit({ ...form, overlay_rotate180: e.target.checked })} />
                      <span className="urdu text-[12px] text-gray-700">
                        180° گھمائیں — اگر پرچی الٹی طرف سے ٹرے میں لگتی ہے
                      </span>
                    </label>
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={!!form.overlay_landscape}
                        onChange={(e) => commit({ ...form, overlay_landscape: e.target.checked })} />
                      <span className="urdu text-[12px] text-gray-700">
                        لینڈ اسکیپ — عام طور پر <b>بند</b> رکھیں (شیٹ پہلے ہی چوڑی ہے؛ اسے آن کرنا دوسری بار گھمانا ہے)
                      </span>
                    </label>
                  </div>

                  {/* پروف شیٹ — plain-paper calibration, then calibrate FROM the ruler */}
                  <div className="flex flex-col gap-2 border border-amber-300 bg-amber-50 rounded-md p-3">
                    <div className="urdu font-bold text-[13px] text-gray-800">پروف شیٹ (سادہ کاغذ پر)</div>
                    <div className="urdu text-[11px] text-gray-600 leading-relaxed">
                      یہ شیٹ <b>سادہ کاغذ</b> پر چھپتی ہے — قیمتی پرچی خرچ نہیں ہوتی۔ اس پر 10mm کا جال، چاروں کونوں
                      پر نشان، اور دو بار (ایک افقی، ایک عمودی) چھپتے ہیں جن کی لمبائی <b>ٹھیک 100mm</b> ہونی چاہیے۔
                      اسکیل سے دونوں بار ناپیں: اگر 100mm سے کم یا زیادہ ہیں تو پرنٹر نے صفحہ چھوٹا/بڑا کیا ہے۔ اگر
                      بار الٹے رخ پر ہیں تو پرنٹر نے صفحہ گھما دیا ہے۔ پھر پروف شیٹ کو اصل پرچی کے ساتھ ملا کر
                      <b> کھڑکی کی روشنی میں</b> دیکھیں — خانے بغیر پرچی ضائع کیے مل جائیں گے۔
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button type="button" disabled={testBusy} onClick={runOverlayProof}
                        className="urdu text-[13px] font-bold text-white bg-amber-600 rounded-md px-3 py-2 hover:bg-amber-700 disabled:opacity-50">
                        پروف شیٹ چھاپیں
                      </button>
                    </div>
                    <div className="urdu font-bold text-[12px] text-gray-700 mt-1">ناپ کے مطابق کیلیبریشن</div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                      {[
                        ['h', 'افقی 100mm بار اصل میں کتنا آیا؟ (mm)'],
                        ['v', 'عمودی 100mm بار اصل میں کتنا آیا؟ (mm)'],
                        ['x', 'اوپر بائیں نشان کی اصل X (mm)'],
                        ['y', 'اوپر بائیں نشان کی اصل Y (mm)']
                      ].map(([k, label]) => (
                        <label key={k} className="flex items-center justify-between gap-2">
                          <span className="urdu text-[11px] text-gray-700 truncate">{label}</span>
                          <input dir="ltr" inputMode="decimal" value={meas[k]}
                            onChange={(e) => setMeas({ ...meas, [k]: e.target.value.replace(/[^\d.\-]/g, '') })}
                            className={`${INPUT} w-20 py-1`} />
                        </label>
                      ))}
                    </div>
                    <div className="urdu text-[10px] text-gray-500">
                      نشان کی X/Y کاغذ کے بائیں اور اوپری کنارے سے ناپیں (درست ہو تو دونوں 10 آنے چاہییں)۔
                    </div>
                    <button type="button" onClick={applyMeasured}
                      className="urdu text-[13px] font-bold text-white bg-slate-700 rounded-md px-3 py-2 hover:bg-slate-800 self-start">
                      ناپ سے اسکیل/آفسیٹ لگائیں
                    </button>
                  </div>

                  {/* Calibration canvas — drag each value onto its pre-printed cell */}
                  {overlayMeta ? (
                    <div className="flex flex-col gap-2">
                      <div className="urdu font-bold text-[13px] text-gray-700">باریک ایڈجسٹمنٹ — ہر ویلیو کو اس کے خانے پر گھسیٹیں</div>
                      {/* The drag tool is screen-space only: it cannot see driver
                          rotation/scaling, so it must come AFTER the proof sheet. */}
                      <div className="urdu text-[11px] text-amber-700">
                        پہلے اوپر والی <b>پروف شیٹ</b> سے اسکیل/آفسیٹ درست کریں۔ یہ گھسیٹنے والا حصہ صرف
                        <b> آخری باریک ایڈجسٹمنٹ</b> کے لیے ہے — یہ پرنٹر کے گھمانے یا سائز بدلنے کو نہیں پکڑ سکتا۔
                      </div>
                      <div
                        ref={ovCanvasRef}
                        className="relative w-full border border-gray-400 overflow-hidden select-none"
                        style={{ aspectRatio: `${SHEET_W_MM} / ${SHEET_H_MM}`, background: form.overlay_bg_path ? `#fff url('${form.overlay_bg_path}') center/100% 100% no-repeat` : '#fafafa', touchAction: 'none' }}
                      >
                        {/* centre split guide */}
                        <div className="absolute top-0 bottom-0" style={{ left: '50%', borderLeft: '1px dashed #999' }} />
                        {keys.map((key) => {
                          const co = coords[key]; const val = sample[key]
                          if (co == null || val == null || val === '' || val === '-') return null
                          const chip = (slip, x, y) => {
                            const selected = slip === 'L' && ovSel === key
                            return (
                              <span
                                key={key + slip}
                                onPointerDown={slip === 'L' ? onChipDown(key) : undefined}
                                onClick={() => slip === 'L' && setOvSel(key)}
                                title={labels[key] || key}
                                className="absolute whitespace-nowrap px-0.5 leading-none"
                                style={{
                                  left: `${(x / SHEET_W_MM) * 100}%`, top: `${(y / SHEET_H_MM) * 100}%`,
                                  transform: 'translate(-50%,-100%)', fontSize: 9,
                                  fontWeight: 700, color: '#111',
                                  cursor: slip === 'L' ? 'move' : 'default',
                                  background: selected ? 'rgba(37,99,235,.25)' : 'rgba(255,255,0,.35)',
                                  outline: selected ? '1px solid #2563eb' : '1px solid rgba(0,0,0,.15)',
                                  opacity: slip === 'L' ? 1 : 0.55
                                }}
                              >{String(val)}</span>
                            )
                          }
                          return [
                            chip('L', Number(co.x), Number(co.y)),
                            chip('R', Number(co.x) + ovRightDX, Number(co.y) + ovRightDY)
                          ]
                        })}
                      </div>
                      {/* selected field + nudge */}
                      <div className="flex items-center justify-between gap-2">
                        <span className="urdu text-[12px] text-gray-600">
                          {ovSel ? `منتخب: ${labels[ovSel] || ovSel}` : 'ایک ویلیو منتخب کریں (کلک/ڈریگ)'}
                        </span>
                        <div className="flex items-center gap-1">
                          <button type="button" disabled={!ovSel} onClick={() => nudge(-0.5, 0)} className="w-7 h-7 border border-gray-300 rounded bg-white hover:bg-gray-100 disabled:opacity-40">◀</button>
                          <button type="button" disabled={!ovSel} onClick={() => nudge(0, -0.5)} className="w-7 h-7 border border-gray-300 rounded bg-white hover:bg-gray-100 disabled:opacity-40">▲</button>
                          <button type="button" disabled={!ovSel} onClick={() => nudge(0, 0.5)} className="w-7 h-7 border border-gray-300 rounded bg-white hover:bg-gray-100 disabled:opacity-40">▼</button>
                          <button type="button" disabled={!ovSel} onClick={() => nudge(0.5, 0)} className="w-7 h-7 border border-gray-300 rounded bg-white hover:bg-gray-100 disabled:opacity-40">▶</button>
                        </div>
                      </div>
                      <div className="urdu text-[10px] text-gray-400">پیلے چپس بائیں (گاہک) کاپی — انہیں گھسیٹیں۔ دھندلے چپس دائیں کاپی — وہ «دائیں کاپی X/Y» سے حرکت کرتے ہیں۔</div>
                    </div>
                  ) : (
                    <div className="urdu text-[12px] text-gray-500">کیلیبریشن لوڈ ہو رہی ہے…</div>
                  )}

                  <div className="flex flex-wrap items-center gap-3">
                    <button type="button" disabled={testBusy} onClick={runOverlayTest}
                      className={BTN_DARK}>
                      ٹیسٹ پرنٹ (ویلیوز)
                    </button>
                    {/* Snap the whole calibration (coords + offsets) back to the
                        hardcoded defaults — recovery if a drag goes wrong. */}
                    <button type="button" onClick={resetOverlay}
                      className="urdu text-[13px] font-bold text-gray-700 bg-gray-200 rounded-md px-3 py-2 hover:bg-gray-300 transition-colors">
                      ری سیٹ / ڈیفالٹ پر واپس
                    </button>
                    {ovMsg && <span className="urdu text-[12px] text-emerald-600 break-all">{ovMsg}</span>}
                  </div>
                </div>
              )
            })()}
            </div>
          )}

          {section === 'whatsapp' && (
            <div className="flex flex-col gap-4">
              {form.print_mode !== 'overlay_form' && (<>
          {/* ── واٹس ایپ یاد دہانی کا پیغام — the text the "تیزابی لینا ہے" / "رقم لینی
              ہے" reports pre-fill into a WhatsApp chat. Nothing is ever sent from
              here or from the report: the button only OPENS the chat, and the
              shopkeeper presses Send. One template serves both reports — the app
              substitutes the amount already formatted the way that report shows it
              (rupees / تولہ ماشہ رتی), which the two preview lines below make plain. */}
          <div className={CARD}>
            <CardHead icon={<WhatsappIcon />} tone="bg-emerald-50 text-emerald-600 border-emerald-200">واٹس ایپ یاد دہانی کا پیغام</CardHead>
            <div className="urdu text-[11px] text-gray-500 leading-5">
              یہ پیغام "لینا ہے" والی رپورٹ کے واٹس ایپ بٹن سے کھلتا ہے۔ بھیجنے کا بٹن آپ خود دبائیں گے۔
            </div>

            <textarea
              ref={waRef}
              dir="rtl"
              className={`${INPUT} urdu resize-none leading-loose`}
              rows={4}
              maxLength={400}
              value={form.whatsapp_reminder_text}
              onChange={waField}
            />

            {/* Placeholder chip — click inserts at the caret. {رقم} is the only one:
                the message greets the customer as محترم and never names him. */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="urdu text-[11px] text-gray-500">شامل کریں:</span>
              {[
                { token: '{رقم}', hint: 'باقی رقم / تیزابی' }
              ].map((p) => (
                <button
                  key={p.token}
                  type="button"
                  onClick={() => insertPlaceholder(p.token)}
                  title={`${p.token} — ${p.hint}`}
                  className="urdu inline-flex items-center gap-1.5 text-[12px] font-bold text-blue-800 bg-gradient-to-b from-blue-50 to-blue-100 border border-blue-300 shadow-sm rounded-full px-3 py-1.5 hover:from-blue-100 hover:to-blue-200 hover:border-blue-400 active:translate-y-px transition-all"
                >
                  <span dir="ltr" className="tabular-nums">{p.token}</span>
                  <span className="text-[10px] font-normal text-blue-600">{p.hint}</span>
                </button>
              ))}
            </div>

            {/* Live preview — both reports, updating as the shopkeeper types. */}
            <div className="flex flex-col gap-2">
              <div className="urdu font-bold text-[13px] text-gray-700">پیش منظر</div>
              <div className="flex flex-col gap-2">
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
                  <div className="urdu text-[10px] text-emerald-700 mb-1">رقم لینی ہے</div>
                  <div dir="rtl" className="urdu text-[12.5px] text-gray-800 leading-6 whitespace-pre-wrap break-words">
                    {waPreview('2,00,000 روپے') || '—'}
                  </div>
                </div>
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                  <div className="urdu text-[10px] text-amber-700 mb-1">تیزابی لینا ہے</div>
                  <div dir="rtl" className="urdu text-[12.5px] text-gray-800 leading-6 whitespace-pre-wrap break-words">
                    {waPreview('5 تولہ 6 ماشہ') || '—'}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => commit({ ...form, whatsapp_reminder_text: WA_REMINDER_DEFAULT })}
                className={BTN_SOFT}
              >
                اصل پیغام بحال کریں
              </button>
            </div>
          </div>
              </>)}
            </div>
          )}

          {section === 'reports' && (
            <div className="flex flex-col gap-4">
            {/* ── رپورٹس فولڈر (Google Drive) — ہر لین دین کے بعد رپورٹس کی PDF یہاں
                خودکار بن جاتی ہیں تاکہ دور بیٹھا کلائنٹ دیکھ سکے۔ خالی = بند. */}
            <div className={CARD}>
              <CardHead icon={<ReportsIcon />} tone="bg-violet-50 text-violet-600 border-violet-200">رپورٹس فولڈر (Google Drive)</CardHead>
              <div className="urdu text-[11px] text-gray-500 -mt-1">
                ہر لین دین کے بعد رپورٹس (وصولی، لیب، نقد، ادھار، روزنامچہ) کی تازہ PDF اس فولڈر میں خود بن جائے
                گی۔ Google Drive کا سِنک فولڈر منتخب کریں۔ خالی چھوڑنے پر یہ سہولت بند رہے گی۔ ڈیٹابیس کبھی یہاں نہیں جاتا۔
              </div>
              <div className="flex items-center gap-2" dir="ltr">
                <input
                  className={`${INPUT} flex-1`}
                  dir="ltr"
                  value={form.reports_dir}
                  onChange={(e) => commit({ ...form, reports_dir: e.target.value })}
                  placeholder="G:\My Drive\GoldLab_Reports"
                />
                <button
                  type="button"
                  className="urdu text-[12px] font-bold text-white bg-slate-600 rounded-md px-3 py-2 hover:bg-slate-700 whitespace-nowrap"
                  onClick={async () => {
                    if (!hasApi || !window.api.pickFolder) return
                    try {
                      const r = await window.api.pickFolder()
                      if (r && r.ok && r.path) commit({ ...form, reports_dir: r.path })
                    } catch { /* ignore */ }
                  }}
                >
                  فولڈر منتخب کریں
                </button>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  disabled={!form.reports_dir}
                  className="urdu text-[12px] font-bold text-gray-700 bg-gray-200 rounded-md px-3 py-1.5 hover:bg-gray-300 disabled:opacity-40"
                  onClick={async () => {
                    if (!exportReportsToDrive) return
                    setReportMsg('رپورٹس بن رہی ہیں…')
                    try { await exportReportsToDrive(); setReportMsg('رپورٹس فولڈر میں بھیج دی گئیں ✓') }
                    catch (e) { setReportMsg('ناکام: ' + (e && e.message ? e.message : e)) }
                    if (savedTimer.current) clearTimeout(savedTimer.current)
                    savedTimer.current = setTimeout(() => setReportMsg(''), 6000)
                  }}
                >
                  ابھی رپورٹس بھیجیں (ٹیسٹ)
                </button>
                {form.reports_dir && (
                  <button type="button" className="urdu text-[12px] font-bold text-gray-700 bg-gray-200 rounded-md px-3 py-1.5 hover:bg-gray-300"
                    onClick={() => commit({ ...form, reports_dir: '' })}>ہٹا دیں</button>
                )}
                {reportMsg && <span className="urdu text-[12px] text-emerald-600 break-all">{reportMsg}</span>}
              </div>
            </div>
            </div>
          )}

          {section === 'backup' && (
            <div className="flex flex-col gap-4">
            {/* ── بیک اپ فولڈر — نیچے والے "بیک اپ" بٹن سے ڈیٹابیس کی تاریخ والی نقل
                یہاں محفوظ ہوتی ہے۔ خودکار بیک اپ سے بالکل الگ، اُس کا فولڈر اور
                config جوں کا توں رہتا ہے۔ راستہ جان بوجھ کر READ-ONLY ہے: ہاتھ سے
                لکھی غلطی صرف کلک کے وقت پکڑی جاتی، اور دکاندار سمجھتا رہتا کہ بیک اپ
                ہو رہا ہے حالانکہ نہیں ہو رہا۔ */}
            <div className={CARD}>
              <CardHead icon={<BackupIcon />} tone="bg-rose-50 text-rose-600 border-rose-200">بیک اپ فولڈر (Google Drive)</CardHead>
              <div className="urdu text-[11px] text-gray-500 -mt-1">
                وہ فولڈر منتخب کریں جہاں نیچے والے "بیک اپ" بٹن سے ڈیٹا کی نقل محفوظ ہو۔ Google Drive ڈیسک ٹاپ کا
                فولڈر منتخب کریں تو نقل خود بخود کلاؤڈ پر چلی جائے گی۔
              </div>
              <div className="flex items-center gap-2" dir="ltr">
                <input
                  className={`${INPUT} flex-1 bg-gray-50 cursor-default`}
                  dir="ltr"
                  readOnly
                  value={backupInfo.folder || ''}
                  title={backupInfo.folder || ''}
                  placeholder="کوئی فولڈر منتخب نہیں"
                />
                <button
                  type="button"
                  className="urdu text-[12px] font-bold text-white bg-slate-600 rounded-md px-3 py-2 hover:bg-slate-700 whitespace-nowrap"
                  onClick={async () => {
                    if (!hasApi || !window.api.manualBackupPickFolder) return
                    try {
                      const r = await window.api.manualBackupPickFolder()
                      if (r && r.ok && r.folder) setBackupInfo((s) => ({ ...s, folder: r.folder }))
                    } catch { /* cancelled — keep the current folder */ }
                  }}
                >
                  {backupInfo.folder ? 'فولڈر تبدیل کریں' : 'فولڈر منتخب کریں'}
                </button>
              </div>
              <div className="urdu text-[12px] text-gray-600">
                {backupInfo.lastBackupAt && urduDateTime(backupInfo.lastBackupAt)
                  ? `آخری بیک اپ: ${urduDateTime(backupInfo.lastBackupAt)}`
                  : 'ابھی تک کوئی بیک اپ نہیں ہوا'}
              </div>
            </div>
            </div>
          )}
          </div>
        </div>

      </div>
    </div>
  )
}
