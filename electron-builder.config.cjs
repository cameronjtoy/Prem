// Packaging for macOS, Windows and Linux. Run `npm run package` for the current platform;
// the release workflow (.github/workflows/release.yml) builds all three on tagged versions.
//
// Signing switches on by itself when its secrets are present, and everything else stays the same:
//   macOS:   CSC_LINK + CSC_KEY_PASSWORD (a Developer ID certificate), and for notarization
//            APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID
//   Windows: WIN_CSC_LINK + WIN_CSC_KEY_PASSWORD (or CSC_LINK on the Windows runner)
// Without them the installers are unsigned, as described in docs/install.md.

const macSigned = !!process.env.CSC_LINK
const notarize =
  macSigned && !!(process.env.APPLE_ID && process.env.APPLE_APP_SPECIFIC_PASSWORD && process.env.APPLE_TEAM_ID)

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: 'io.github.cameronjtoy.prem',
  productName: 'Prem',
  copyright: 'Copyright © 2026 Prem contributors',
  artifactName: 'Prem-${version}-${os}-${arch}.${ext}',

  directories: { output: 'dist', buildResources: 'build' },

  // Everything the app needs is bundled into out/ by electron-vite, so no node_modules are shipped.
  files: ['out/**', 'package.json', '!out/server/**', '!**/*.map'],

  extraResources: [
    { from: 'THIRD_PARTY_NOTICES.md', to: 'THIRD_PARTY_NOTICES.md' },
    { from: 'LICENSE', to: 'LICENSE' }
  ],

  // Ad-hoc signs the macOS app when no Developer ID certificate is configured (see build/afterPack.cjs).
  afterPack: 'build/afterPack.cjs',

  mac: {
    category: 'public.app-category.productivity',
    target: [
      { target: 'dmg', arch: ['arm64', 'x64'] },
      // The zip is what auto-update downloads on macOS.
      { target: 'zip', arch: ['arm64', 'x64'] }
    ],
    // null skips signing; undefined lets electron-builder use the Developer ID from CSC_LINK.
    identity: macSigned ? undefined : null,
    hardenedRuntime: macSigned,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.plist',
    notarize
  },

  dmg: { title: 'Prem ${version}' },

  win: { target: [{ target: 'nsis', arch: ['x64'] }] },

  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true
  },

  linux: {
    category: 'Science',
    syncDesktopName: true,
    icon: 'build/icons',
    synopsis: 'Open-source lab notebook that runs on your own machines',
    description:
      'Protocols, protocol runs, samples, attachments and signed records, stored as plain markdown files you own.',
    maintainer: 'Prem contributors <https://github.com/cameronjtoy/Prem>',
    target: [
      { target: 'AppImage', arch: ['x64'] },
      { target: 'deb', arch: ['x64'] }
    ]
  },

  // Where installed copies look for updates. Releases are still published by the workflow (--publish never),
  // which also uploads the latest*.yml files electron-builder writes next to the installers.
  publish: { provider: 'github', owner: 'cameronjtoy', repo: 'Prem' }
}
