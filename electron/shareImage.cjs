// ─── Share-image preparation (clipboard + on-disk fallback) ──────────────────
// Shared by BOTH WhatsApp share routes — main.cjs's capture-to-clipboard (all four
// receipts) and overlayForm.cjs's overlayImageToClipboard (the Canon overlay) — so
// what lands on the clipboard is prepared exactly once, in one place.
//
// 1. flattenOpaque: composite onto WHITE so the bitmap carries NO transparency.
//    The Windows clipboard passes a 32-bit DIB around and its alpha byte is
//    notoriously unreliable; a Chromium-based consumer (WhatsApp Desktop is one)
//    that trusts it can sit on a spinner instead of showing the picture. An
//    already-opaque image comes out byte-for-byte the same, so this only ever
//    removes a variable — it never changes how a slip looks.
//    It also closes a real hole in the overlay route, whose crop pads the target
//    buffer with ZEROS (= fully transparent black) whenever the captured frame is
//    smaller than the sheet.
// 2. capLongestEdge: keep the longest side within 2000px (aspect preserved), so a
//    huge bitmap can't be what a consumer is choking on.
// 3. saveCopy: write the same PNG to Pictures/GoldLab as well and hand the path
//    back, so if paste still fails on some machine the operator can attach the
//    file directly and carry on.
const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')
const { app, nativeImage } = require('electron')

const MAX_EDGE = 2000

// Composite over white and force alpha to 255. NativeImage bitmaps are
// PREMULTIPLIED BGRA, so "over white" is channel + (255 - alpha) — for an opaque
// pixel (alpha 255) that adds nothing, which is why an opaque image is untouched.
function flattenOpaque(img) {
  try {
    // Always the { img, touched } shape — an early return of a bare NativeImage
    // here would make prepareForClipboard hand back `img: undefined`.
    if (!img || img.isEmpty()) return { img, touched: 0 }
    const { width, height } = img.getSize()
    const buf = img.toBitmap()
    let touched = 0
    for (let i = 0, n = width * height; i < n; i++) {
      const o = i * 4
      const a = buf[o + 3]
      if (a === 255) continue
      touched++
      const add = 255 - a
      buf[o] = Math.min(255, buf[o] + add)
      buf[o + 1] = Math.min(255, buf[o + 1] + add)
      buf[o + 2] = Math.min(255, buf[o + 2] + add)
      buf[o + 3] = 255
    }
    const out = nativeImage.createFromBitmap(buf, { width, height })
    return { img: out.isEmpty() ? img : out, touched }
  } catch {
    return { img, touched: -1 }
  }
}

// Longest edge -> MAX_EDGE, aspect ratio preserved. No-op below the limit.
function capLongestEdge(img) {
  try {
    if (!img || img.isEmpty()) return { img, resized: false }
    const { width, height } = img.getSize()
    const longest = Math.max(width, height)
    if (longest <= MAX_EDGE) return { img, resized: false }
    const k = MAX_EDGE / longest
    const out = img.resize({
      width: Math.max(1, Math.round(width * k)),
      height: Math.max(1, Math.round(height * k)),
      quality: 'best'
    })
    return { img: out.isEmpty() ? img : out, resized: true, from: `${width}x${height}` }
  } catch {
    return { img, resized: false }
  }
}

// cap -> flatten. Returns { img, info } where info is loggable.
function prepareForClipboard(img) {
  const capped = capLongestEdge(img)
  const flat = flattenOpaque(capped.img)
  const size = flat.img && !flat.img.isEmpty() ? flat.img.getSize() : { width: 0, height: 0 }
  return {
    img: flat.img,
    info: {
      size: `${size.width}x${size.height}`,
      resized: capped.resized ? `from ${capped.from}` : false,
      alphaPixelsFixed: flat.touched
    }
  }
}

// Always-works fallback: the same picture as a PNG in Pictures/GoldLab. Never
// throws — a failed save must not stop the share.
function saveCopy(png, tag) {
  try {
    if (!png || !png.length) return null
    const dir = path.join(app.getPath('pictures'), 'GoldLab')
    fs.mkdirSync(dir, { recursive: true })
    const d = new Date()
    const p2 = (n) => String(n).padStart(2, '0')
    const stamp = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}_${p2(d.getHours())}-${p2(d.getMinutes())}-${p2(d.getSeconds())}`
    const file = path.join(dir, `${String(tag || 'raseed').replace(/[^\w-]/g, '') || 'raseed'}-${stamp}.png`)
    fs.writeFileSync(file, png)
    return file
  } catch {
    return null
  }
}

// ── Put the PICTURE and its saved PNG FILE on the clipboard together ─────────
// One DataObject carrying CF_BITMAP/CF_DIB (the image) AND CF_HDROP (the file).
// Why: a NATIVE consumer that is picky about raw clipboard bitmaps — WhatsApp
// Desktop is exactly that — still accepts a pasted FILE every time, the same as a
// file copied in Explorer and Ctrl+V'd into the chat. Paint/Chromium keep reading
// the bitmap side. Electron's clipboard API can only write ONE image format, so
// this goes through a tiny STA PowerShell (System.Windows.Forms.Clipboard), the
// same no-new-dependency pattern rasterPrint.cjs uses for its RAW spool.
// The file path travels via an ENV VAR, never spliced into the command line, so
// no quoting problem can corrupt it. Never throws; resolves { ok, reason }.
function clipboardImagePlusFile(pngPath, timeoutMs = 8000) {
  return new Promise((resolve) => {
    let done = false
    const finish = (ok, reason) => { if (!done) { done = true; resolve({ ok, reason: reason || '' }) } }
    try {
      if (!pngPath || !fs.existsSync(pngPath)) { finish(false, 'file-missing'); return }
      const script =
        "$ErrorActionPreference='Stop';" +
        'Add-Type -AssemblyName System.Windows.Forms;' +
        'Add-Type -AssemblyName System.Drawing;' +
        '$p=$env:GOLDLAB_CLIP_FILE;' +
        // FromStream over a MemoryStream copy — FromFile would LOCK the PNG on disk.
        '$bytes=[System.IO.File]::ReadAllBytes($p);' +
        '$ms=New-Object System.IO.MemoryStream(,$bytes);' +
        '$img=[System.Drawing.Image]::FromStream($ms);' +
        '$d=New-Object System.Windows.Forms.DataObject;' +
        '$d.SetImage($img);' +
        '$f=New-Object System.Collections.Specialized.StringCollection;' +
        '[void]$f.Add($p);' +
        '$d.SetFileDropList($f);' +
        // $true = the data stays on the clipboard after this process exits.
        '[System.Windows.Forms.Clipboard]::SetDataObject($d,$true);' +
        "Write-Output 'CLIP-OK'"
      const p = spawn('powershell.exe', ['-STA', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
        windowsHide: true,
        env: { ...process.env, GOLDLAB_CLIP_FILE: pngPath }
      })
      let out = ''
      const timer = setTimeout(() => { try { p.kill() } catch {} finish(false, 'timeout') }, timeoutMs)
      p.stdout.on('data', (d) => { out += String(d) })
      p.on('error', (e) => { clearTimeout(timer); finish(false, String(e && e.message || e)) })
      p.on('close', () => { clearTimeout(timer); finish(out.includes('CLIP-OK'), out.includes('CLIP-OK') ? '' : 'ps-failed') })
    } catch (e) { finish(false, String(e && e.message || e)) }
  })
}

module.exports = { prepareForClipboard, flattenOpaque, capLongestEdge, saveCopy, clipboardImagePlusFile, MAX_EDGE }
