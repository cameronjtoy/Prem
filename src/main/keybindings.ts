import { resetBinding, validateKeybindings, withBinding, type KeybindingsSnapshot } from '@shared/keybindings'
import { WatchedJsonFile } from './jsonFile'

/** The person's keybindings.json: their changes to the default shortcuts. */
export class KeybindingsStore extends WatchedJsonFile<KeybindingsSnapshot> {
  constructor(file: string, onChange?: (snapshot: KeybindingsSnapshot) => void) {
    super(
      file,
      (raw) => (raw === undefined ? { entries: [], problems: [] } : validateKeybindings(raw)),
      '[\n]\n',
      onChange
    )
  }

  /** Gives a command a new shortcut, or none with `null`, and saves the file. */
  set(command: string, key: string | null): Promise<KeybindingsSnapshot> {
    return this.update((raw) => withBinding(Array.isArray(raw) ? raw : [], command, key))
  }

  reset(command: string): Promise<KeybindingsSnapshot> {
    return this.update((raw) => resetBinding(Array.isArray(raw) ? raw : [], command))
  }
}
