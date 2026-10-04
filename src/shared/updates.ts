// When Prem updates itself. Installed copies check GitHub Releases once a day and download a new version in
// the background, then offer to restart. Only builds that can update safely do this: signed ones (an unsigned
// macOS app can't replace itself, and an unsigned update on Windows couldn't be told apart from a fake), and
// Linux AppImages. Running from source, or with the setting off, never checks.

export interface UpdateEnvironment {
  /** Running from an installed copy, not from source. */
  packaged: boolean
  /** Built with a signing certificate. */
  signed: boolean
  /** A Linux AppImage, which updates itself without signing. */
  appImage: boolean
  /** Settings → Updates → Check for updates. */
  enabled: boolean
}

export function canAutoUpdate(env: UpdateEnvironment): boolean {
  return env.packaged && env.enabled && (env.signed || env.appImage)
}

export const UPDATE_CHECK_MS = 24 * 60 * 60 * 1000
