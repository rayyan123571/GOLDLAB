// Single source of truth for which shipped main-process files become V8 BYTECODE
// (.jsc) and which stay as obfuscated JavaScript.
//
// PRELOAD_ONLY files are loaded DIRECTLY by Electron as preload scripts
// (webPreferences.preload = path.join(__dirname, 'x.cjs')). Electron reads those
// paths itself — it does not go through our bytenode require() hook — so they
// cannot be bytecode. They also hold no secrets (only contextBridge/ipcRenderer
// wiring), so leaving them as heavily-obfuscated JS is fine. Everything else in
// electron-dist is compiled to bytecode: the source text never ships.
//
// Paths are RELATIVE to electron-dist/, forward-slashed, matched case-insensitively.
const PRELOAD_ONLY = ['preload.cjs', 'trial/gatePreload.cjs']

// True when a file (relative path from electron-dist/, forward slashes) must stay
// as obfuscated JS instead of being bytecode-compiled.
function isPreloadOnly(relPath) {
  const norm = String(relPath).replace(/\\/g, '/').toLowerCase()
  return PRELOAD_ONLY.some((p) => p.toLowerCase() === norm)
}

module.exports = { PRELOAD_ONLY, isPreloadOnly }
