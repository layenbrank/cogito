import Constants, { ExecutionEnvironment } from 'expo-constants'

/**
 * Minimal key/value API shared by MMKV and the Expo Go fallback.
 */
interface KeyValueStorage {
  set(key: string, value: string): void
  getString(key: string): string | undefined
  remove(key: string): void
}

/**
 * In-memory storage used when native MMKV is unavailable (Expo Go).
 */
function createMemoryStorage(): KeyValueStorage {
  const store = new Map<string, string>()

  return {
    set(key, value) {
      store.set(key, value)
    },
    getString(key) {
      return store.get(key)
    },
    remove(key) {
      store.delete(key)
    }
  }
}

/**
 * Returns true when the app is running inside Expo Go.
 */
function isExpoGo(): boolean {
  return Constants.executionEnvironment === ExecutionEnvironment.StoreClient
}

/**
 * Creates app storage: MMKV in native/dev builds, memory fallback in Expo Go.
 * MMKV must not be imported statically — loading it crashes Expo Go via NitroModules.
 */
function createAppStorage(): KeyValueStorage {
  if (isExpoGo()) {
    return createMemoryStorage()
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy load avoids Expo Go crash
    const { createMMKV } = require('react-native-mmkv') as typeof import('react-native-mmkv')
    return createMMKV({
      id: 'app-storage',
      encryptionKey: 'enterprise-secret-key'
    })
  } catch {
    return createMemoryStorage()
  }
}

const storage = createAppStorage()

const mmkvStorage = {
  setItem(key: string, value: string) {
    storage.set(key, value)
  },
  getItem(key: string) {
    return storage.getString(key) ?? null
  },
  removeItem(key: string) {
    storage.remove(key)
  }
}

export { mmkvStorage, storage }
