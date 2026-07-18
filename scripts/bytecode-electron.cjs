// Orchestrator (plain Node, part of the dist:win chain). It can't compile bytecode
// itself: bytenode must run under Electron's V8, not the system Node, or the .jsc
// won't match the Electron that ships. So it spawns the Electron binary as Node
// (ELECTRON_RUN_AS_NODE=1) to run bytecode-worker.cjs, with cwd = project root so
// require('bytenode') resolves. A non-zero worker exit aborts the whole build,
// before electron-builder can package a half-bytecoded (broken) app.
const path = require('path')
const { spawnSync } = require('child_process')

const ROOT = path.join(__dirname, '..')
// require('electron') outside an Electron runtime returns the path to electron.exe.
const electronPath = require('electron')
const worker = path.join(__dirname, 'bytecode-worker.cjs')

console.log('[bytecode] compiling electron-dist with Electron V8 (this is quick)...')
const res = spawnSync(electronPath, [worker], {
  cwd: ROOT,
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
})

if (res.error) {
  console.error('[bytecode] could not launch Electron:', res.error.message)
  process.exit(1)
}
process.exit(res.status == null ? 1 : res.status)
