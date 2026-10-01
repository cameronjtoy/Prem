import type { Api } from '../shared/vault/ipc'

declare global {
  interface Window {
    api: Api
  }
}
