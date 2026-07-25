// ─── Main-screen colour theme (Defaults → تھیم / رنگ) ────────────────────────
// A handful of the grey "Windows chrome" tones are made themeable WITHOUT
// touching a single component class. index.css maps each Tailwind utility to a
// CSS variable with its EXACT current hex as the fallback; this module is the one
// place that sets/clears those variables, and ONLY on #root.
//
// Why #root (not :root/html): the print path clones DOM at <body> level, OUTSIDE
// #root. A variable set on #root does not reach that clone, so var(--ui-x, #hex)
// falls back to the original hex and every printed slip stays pixel-identical —
// no matter what the shop picks on screen.
//
// Each field's `fallback` is the CURRENT colour (custom palette from
// tailwind.config.cjs; ui_surface is Tailwind's computed gray-100 #f3f4f6). When
// a field is null/blank NOTHING is set — the class keeps its hex fallback, so an
// untouched install does not change by one pixel.
export const THEME_FIELDS = [
  { key: 'ui_panel', cssVar: '--ui-panel', fallback: '#d2d2d2', label: 'پینل / پس منظر' },
  { key: 'ui_header', cssVar: '--ui-header', fallback: '#bfbfbf', label: 'سلور ہیڈر' },
  { key: 'ui_header_dark', cssVar: '--ui-header-dark', fallback: '#a4a4a4', label: 'گہرا ہیڈر' },
  { key: 'ui_line', cssVar: '--ui-line', fallback: '#9a9a9a', label: 'گرڈ لائن' },
  { key: 'ui_surface', cssVar: '--ui-surface', fallback: '#f3f4f6', label: 'ہلکا خانہ' }
]

// ── Ready-made themes ────────────────────────────────────────────────────────
// One-click palettes. Each sets all five tones together; the shop can still
// fine-tune any single colour afterwards with the pickers. Every palette keeps
// the SAME lightness range as the classic silver (panel ~#d2, header ~#bf,
// headerDark ~#a4, line ~#9a, surface ~#f3), only shifting the hue — so black
// table text stays perfectly readable in every theme.
//
// 'silver' is the built-in look: its values are all '' (unset), i.e. selecting it
// clears every override back to the hex fallbacks — pixel-identical to a fresh
// install.
export const THEME_PRESETS = [
  {
    id: 'silver', label: 'کلاسیکی سلور',
    values: { ui_panel: '', ui_header: '', ui_header_dark: '', ui_line: '', ui_surface: '' }
  },
  {
    id: 'slate', label: 'نیلا سرمئی',
    values: { ui_panel: '#d3d8df', ui_header: '#bcc4cf', ui_header_dark: '#a1abb8', ui_line: '#8f9aa8', ui_surface: '#eef1f6' }
  },
  {
    id: 'sand', label: 'گرم ریتی',
    values: { ui_panel: '#dcd5c9', ui_header: '#cabfad', ui_header_dark: '#b0a58f', ui_line: '#a1977f', ui_surface: '#f4f0e7' }
  },
  {
    id: 'sage', label: 'ہلکا سبز',
    values: { ui_panel: '#d2dcd2', ui_header: '#bccdbc', ui_header_dark: '#a1b6a1', ui_line: '#8fa38f', ui_surface: '#edf3ed' }
  }
]

// The five preview swatch colours for a preset, in visual order, each falling
// back to the built-in hex when the preset leaves that tone unset (silver). Used
// to draw the multi-shade preview on each theme card.
export function presetSwatches(preset) {
  return THEME_FIELDS.map((f) => {
    const v = preset && preset.values ? preset.values[f.key] : ''
    return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v || '') ? v : f.fallback
  })
}

// Which preset (if any) the current settings match — so the active card can be
// highlighted. Compares each tone normalised ('' === unset). Returns id or null.
export function activePresetId(values) {
  const norm = (v) => (v == null ? '' : String(v).trim().toLowerCase())
  for (const p of THEME_PRESETS) {
    if (THEME_FIELDS.every((f) => norm(values ? values[f.key] : '') === norm(p.values[f.key]))) return p.id
  }
  return null
}

// #root — the single element the theme variables live on (see the note above).
function rootEl() {
  return (typeof document !== 'undefined' && document.getElementById('root')) || null
}

const isHex = (v) => typeof v === 'string' && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v.trim())

// Apply the theme from a settings-like object. A valid #hex sets the variable; a
// null/blank/invalid value REMOVES it, so that field reverts to its hex fallback.
// Idempotent — safe to call on every rates load and on every live preview tick.
export function applyTheme(values) {
  const el = rootEl()
  if (!el) return
  for (const f of THEME_FIELDS) {
    const v = values ? values[f.key] : null
    if (isHex(v)) el.style.setProperty(f.cssVar, v.trim())
    else el.style.removeProperty(f.cssVar)
  }
}

// Clear every theme variable → back to the built-in hex fallbacks.
export function clearTheme() {
  const el = rootEl()
  if (!el) return
  for (const f of THEME_FIELDS) el.style.removeProperty(f.cssVar)
}
