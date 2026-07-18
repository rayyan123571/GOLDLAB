// Bytecode compiler — MUST run under Electron as Node (ELECTRON_RUN_AS_NODE=1) so
// the emitted .jsc matches the exact V8 the shipped Electron uses. Launched by
// scripts/bytecode-electron.cjs; do not run with plain `node` (a V8 mismatch would
// crash the customer's app at startup with "invalid or incompatible cached data").
//
// Runs AFTER obfuscation, over electron-dist/. For every main-process file it:
//   1. compiles the obfuscated x.cjs  ->  x.jsc  (raw V8 bytecode, no source text)
//   2. overwrites x.cjs with a tiny loader stub that requires x.jsc
// The require graph is untouched: code still does require('./db.cjs'); that now
// hits the stub, which loads db.jsc. Preload files are skipped (see
// bytecode-targets.cjs) and stay as obfuscated JS.
const bytenode = require('bytenode')
const fs = require('fs')
const path = require('path')
const { isPreloadOnly } = require('./bytecode-targets.cjs')

const OUT_DIR = path.join(__dirname, '..', 'electron-dist')
// Vendored copy of bytenode's runtime, dropped INTO electron-dist so it ships
// inside app.asar via the electron-dist/** files glob. This is the whole reason
// the stubs load it by relative path instead of require('bytenode'): the bytenode
// *package* is a build-only devDependency and electron-builder does NOT put it in
// the asar, so a packaged require('bytenode') throws "Cannot find module" and the
// app dies at startup. Requiring this file registers Module._extensions['.jsc'].
const LOADER_NAME = '_bytenode.cjs'
const LOADER_OUT = path.join(OUT_DIR, LOADER_NAME)

// The loader that replaces each compiled .cjs. It first pulls in the vendored
// bytenode runtime (relative path to electron-dist/_bytenode.cjs — computed per
// file so it works from any subdirectory), which registers the .jsc handler, then
// requires the sibling .jsc. Loading the vendored file repeatedly is free (module
// cache) and the handler registers exactly once.
function stub(jscBasename, relLoader) {
  return `'use strict';\nrequire('${relLoader}');\nmodule.exports = require('./${jscBasename}');\n`
}

// Forward-slashed, always './' or '../'-prefixed relative path from a compiled
// file's directory to the vendored loader — a valid CommonJS require specifier.
function loaderSpecifierFor(fileDir) {
  let rel = path.relative(fileDir, LOADER_OUT).replace(/\\/g, '/')
  if (!rel.startsWith('.')) rel = './' + rel
  return rel
}

let compiled = 0
const failures = []

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(full)
      continue
    }
    if (!entry.name.endsWith('.cjs')) continue
    // The vendored loader must stay plain JS — it is what teaches Node to load
    // .jsc at all, so it can never itself be compiled to .jsc.
    if (entry.name === LOADER_NAME) continue
    const rel = path.relative(OUT_DIR, full).replace(/\\/g, '/')
    if (isPreloadOnly(rel)) {
      console.log(`[bytecode] skip (preload JS)  ${rel}`)
      continue
    }
    const jscBasename = entry.name.replace(/\.cjs$/, '.jsc')
    const jscPath = path.join(dir, jscBasename)
    try {
      bytenode.compileFile({ filename: full, output: jscPath, compileAsModule: true })
      const size = fs.statSync(jscPath).size
      if (!size) throw new Error('produced empty .jsc')
      // Only overwrite the source with the stub AFTER a good .jsc exists, so a
      // failed compile never leaves a stub pointing at a missing/empty file.
      fs.writeFileSync(full, stub(jscBasename, loaderSpecifierFor(dir)), 'utf8')
      compiled++
      console.log(`[bytecode] ${rel} -> ${jscBasename} (${size} bytes)`)
    } catch (e) {
      failures.push(`${rel}: ${(e && e.message) || e}`)
    }
  }
}

if (!fs.existsSync(OUT_DIR)) {
  console.error(`[bytecode] electron-dist not found at ${OUT_DIR} — run obfuscate first.`)
  process.exit(1)
}

// Vendor bytenode's runtime into electron-dist so it ships in the asar. Copied
// verbatim from the installed package (self-contained: only Node built-ins).
// Done BEFORE walk() would matter, but the file is written here — after the
// existence check — and walk() skips it by name regardless, so a stale copy from
// a previous run can never be compiled into a self-referencing stub.
try {
  const src = require.resolve('bytenode')
  fs.copyFileSync(src, LOADER_OUT)
  console.log(`[bytecode] vendored bytenode runtime -> electron-dist/${LOADER_NAME}`)
} catch (e) {
  console.error(`[bytecode] could not vendor bytenode runtime: ${(e && e.message) || e}`)
  process.exit(1)
}

walk(OUT_DIR)

if (failures.length) {
  console.error(`[bytecode] FAILED to compile ${failures.length} file(s):`)
  for (const f of failures) console.error('   - ' + f)
  process.exit(1)
}
console.log(`[bytecode] done — ${compiled} file(s) compiled to V8 bytecode.`)
