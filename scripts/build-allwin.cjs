// Build ONE locked installer that runs on EVERY Windows: 7 SP1, 8, 8.1, 10, 11 —
// on both 32-bit and 64-bit machines.
//
// Two facts drive the whole design:
//
//  1. Electron DROPPED Windows 7/8/8.1 in version 23, so the normal `dist:win`
//     (Electron 33 / Chromium 130) installs on Win7 but the exe never opens —
//     the install ends with "Unspecified error" creating the Start Menu shortcut.
//     Electron 22.3.27 is the last release supporting Win7 SP1+, and it still
//     runs fine on Windows 10/11. So ONE Electron 22 build covers everything.
//
//  2. A 32-bit build runs on 64-bit Windows too (WoW64), but not the reverse.
//     So the universal installer is ia32 — one file, every machine.
//
//  3. V8 BYTECODE IS ARCHITECTURE-SPECIFIC. A .jsc compiled by a 64-bit Electron
//     dies in a 32-bit Electron with "Invalid or incompatible cached data"
//     (verified — it is what broke the first attempt at this build). So the
//     bytecode step must run under an Electron of the SAME arch being packaged;
//     each arch gets its own toolchain download and its own compile pass.
//
// Everything else matches `dist:win`: same source, same trial/licence gate, same
// obfuscation + bytecode protection. Only the Electron runtime, the output folder
// (release-allwin/) and the installer name differ, so this never overwrites the
// modern build in release/.
//
// Usage:
//   node scripts/build-allwin.cjs             -> 32-bit, runs on ALL Windows (default)
//   node scripts/build-allwin.cjs --arch=x64  -> 64-bit only (Win7 x64 and newer)
//   node scripts/build-allwin.cjs --arch=both -> both installers, built one after the other
const fs = require('fs')
const path = require('path')
const { execFileSync, execSync } = require('child_process')

const ROOT = path.join(__dirname, '..')
// Last Electron with Windows 7/8/8.1 support. Do NOT bump — 23+ breaks Win7.
const ELECTRON_VERSION = '22.3.27'
// Kept out of the project's own node_modules so the electron@33 devDependency
// used by `npm run dev` and `dist:win` is left completely untouched.
const TOOLCHAIN = path.join(ROOT, '.win7-toolchain')
const CONFIG_FILE = path.join(ROOT, 'electron-builder.allwin.json')

const ARCH_LABEL = {
  // ia32 is the default because it is the one that runs everywhere.
  ia32: 'All-Windows',
  x64: 'Win7-x64'
}

const archArg = (process.argv.find((a) => a.startsWith('--arch=')) || '--arch=ia32').split('=')[1]
const arches = archArg === 'both' ? ['ia32', 'x64'] : [archArg]
for (const a of arches) {
  if (!ARCH_LABEL[a]) {
    console.error(`[allwin] unknown --arch=${a} (use ia32, x64 or both)`)
    process.exit(1)
  }
}

const run = (cmd, cwd = ROOT) => execSync(cmd, { stdio: 'inherit', cwd })

// Electron 22 for a given arch — needed BOTH to compile matching bytecode and
// (via electronVersion in the config) as the runtime electron-builder packages.
function ensureElectron22(arch) {
  const dir = path.join(TOOLCHAIN, arch)
  const pkgDir = path.join(dir, 'node_modules', 'electron')
  const pathTxt = path.join(pkgDir, 'path.txt')
  if (!fs.existsSync(pathTxt)) {
    console.log(`[allwin] downloading Electron ${ELECTRON_VERSION} ${arch} toolchain (one time, ~90MB)...`)
    fs.mkdirSync(dir, { recursive: true })
    // Own package.json so npm does not walk up and touch the project's.
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: `goldlab-toolchain-${arch}`, version: '1.0.0', private: true }, null, 2)
    )
    // electron's postinstall reads npm_config_arch — this is what makes it fetch
    // the ia32 binary on a 64-bit build machine.
    execSync(`npm install electron@${ELECTRON_VERSION} --no-save --no-audit --no-fund`, {
      stdio: 'inherit',
      cwd: dir,
      env: { ...process.env, npm_config_platform: 'win32', npm_config_arch: arch }
    })
  }
  const exe = path.join(pkgDir, 'dist', fs.readFileSync(pathTxt, 'utf8').trim())
  if (!fs.existsSync(exe)) {
    console.error(`[allwin] Electron ${ELECTRON_VERSION} ${arch} binary missing at ${exe}`)
    process.exit(1)
  }
  return exe
}

// Passing --config REPLACES package.json's "build" field rather than merging, so
// this derives from that field and overrides only what differs — no second copy
// of the packaging rules to drift out of sync.
function writeConfig(arch) {
  const base = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).build
  const config = {
    ...base,
    // Package Electron 22 instead of the version in devDependencies.
    electronVersion: ELECTRON_VERSION,
    directories: { ...base.directories, output: 'release-allwin' },
    win: { ...base.win, target: [{ target: 'nsis', arch: [arch] }] },
    nsis: {
      ...base.nsis,
      // Distinct name so it is never confused with the modern-Windows installer.
      // build-unlocked.cjs --allwin sets GOLDLAB_UNLOCKED so the no-trial personal
      // build is also unmistakable next to the customer (gated) installer.
      artifactName: `Chaudhry Gold Lab Setup \${version} ${ARCH_LABEL[arch]}${process.env.GOLDLAB_UNLOCKED ? ' UNLOCKED' : ''}.\${ext}`
    }
  }
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8')
}

for (const arch of arches) {
  console.log(`\n[allwin] ===== building ${arch} (${ARCH_LABEL[arch]}) =====`)
  const electron22 = ensureElectron22(arch)

  console.log('[allwin] 1/4 vite build')
  run('npm run build')

  console.log('[allwin] 2/4 obfuscate')
  run('npm run obfuscate')

  // Must use the SAME-ARCH Electron, or the .jsc is rejected at startup.
  console.log(`[allwin] 3/4 bytecode (Electron ${ELECTRON_VERSION} ${arch} V8)`)
  execFileSync(process.execPath, [path.join(__dirname, 'bytecode-electron.cjs')], {
    stdio: 'inherit',
    cwd: ROOT,
    env: { ...process.env, GOLDLAB_ELECTRON_BIN: electron22 }
  })

  console.log(`[allwin] 4/4 packaging ${arch}`)
  writeConfig(arch)
  run(`npx electron-builder --win --${arch} --config "${path.basename(CONFIG_FILE)}"`)
}

console.log('\n[allwin] done — installer(s) in release-allwin/')
console.log('[allwin] release/ (the Electron 33 build) is untouched.')
