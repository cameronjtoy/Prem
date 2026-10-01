// Ad-hoc signs the packaged macOS app when there's no Developer ID certificate.
//
// Apple Silicon Macs refuse to run code with no signature at all, and electron-builder skips signing
// when `mac.identity` is null. Without this, macOS reports the app as "damaged" instead of showing the
// usual "unidentified developer" prompt that users can get past with System Settings → Open Anyway.
// Once a real certificate is configured (CSC_LINK), electron-builder signs properly and this does nothing.
const { execFileSync } = require('node:child_process')
const path = require('node:path')

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin' || process.env.CSC_LINK) return
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' })
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' })
}
