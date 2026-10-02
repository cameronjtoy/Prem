import {
  DEFAULTS,
  validate,
  withSetting,
  type SettingKey,
  type Settings,
  type SettingsSnapshot
} from '@shared/settings/schema'
import { WatchedJsonFile } from './jsonFile'

const isObject = (raw: unknown): raw is Record<string, unknown> =>
  raw !== null && typeof raw === 'object' && !Array.isArray(raw)

/** The person's settings.json. It holds only what they changed; everything else is a default. */
export class SettingsStore extends WatchedJsonFile<SettingsSnapshot> {
  constructor(file: string, onChange?: (snapshot: SettingsSnapshot) => void) {
    super(file, (raw) => (raw === undefined ? { values: DEFAULTS, problems: [] } : validate(raw)), '{\n}\n', onChange)
  }

  get values(): Settings {
    return this.current.values
  }

  /** Changes one setting and saves the file. */
  set(key: SettingKey, value: unknown): Promise<SettingsSnapshot> {
    return this.update((raw) => withSetting(isObject(raw) ? raw : {}, key, value))
  }
}
