import { expect, test } from './fixtures'

// Running from source never checks for updates, so the main process announces one the way electron-updater
// would once a download finishes.
test('a downloaded update is offered with Restart now, and Later puts it off', async ({ prem: { app, page } }) => {
  await expect(page.locator('.update-ready')).toHaveCount(0)
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.send('app:updateReady', '9.9.9')
  )
  const banner = page.locator('.update-ready')
  await expect(banner).toContainText("Prem 9.9.9 is ready. It's installed when you restart.")
  await expect(banner.getByRole('button', { name: 'Restart now' })).toBeVisible()
  await banner.getByRole('button', { name: 'Later' }).click()
  await expect(banner).toHaveCount(0)

  // Settings → Updates has the switch.
  await page.keyboard.press('ControlOrMeta+Comma')
  await expect(page.locator('[data-setting="updates.check"]')).toContainText('Check for updates')
})
