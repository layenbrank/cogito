import { LazyStore } from '@tauri-apps/plugin-store'

import { PIN_MAX_LENGTH, PIN_MIN_LENGTH } from '@/views/gallery/constraints'

interface VaultPersisted {
  pinHash: string | null
}

const VAULT_STORE = new LazyStore('gallery-vault.json', {
  defaults: { pinHash: null } as VaultPersisted as unknown as Record<string, unknown>,
  autoSave: 200
})

let isVaultReady = false
let sessionUnlocked = false

async function ensureVaultStore(): Promise<void> {
  if (isVaultReady) return
  await VAULT_STORE.init()
  isVaultReady = true
}

async function hashPin(pin: string): Promise<string> {
  const bytes = new TextEncoder().encode(pin)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map(function (byte) {
      return byte.toString(16).padStart(2, '0')
    })
    .join('')
}

function isValidPin(pin: string): boolean {
  return /^\d+$/.test(pin) && pin.length >= PIN_MIN_LENGTH && pin.length <= PIN_MAX_LENGTH
}

async function findPinHash(): Promise<string | null> {
  await ensureVaultStore()
  const value = await VAULT_STORE.get<string | null>('pinHash')
  return value ?? null
}

async function hasVaultPin(): Promise<boolean> {
  const hash = await findPinHash()
  return Boolean(hash)
}

async function setupVaultPin(pin: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!isValidPin(pin)) {
    return { ok: false, reason: `PIN 需为 ${PIN_MIN_LENGTH}–${PIN_MAX_LENGTH} 位数字` }
  }
  await ensureVaultStore()
  const pinHash = await hashPin(pin)
  await VAULT_STORE.set('pinHash', pinHash)
  sessionUnlocked = true
  return { ok: true }
}

async function unlockVault(pin: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!isValidPin(pin)) {
    return { ok: false, reason: 'PIN 格式无效' }
  }
  const stored = await findPinHash()
  if (!stored) {
    return setupVaultPin(pin)
  }
  const pinHash = await hashPin(pin)
  if (pinHash !== stored) {
    return { ok: false, reason: 'PIN 不正确' }
  }
  sessionUnlocked = true
  return { ok: true }
}

function lockVaultSession(): void {
  sessionUnlocked = false
}

function isVaultUnlocked(): boolean {
  return sessionUnlocked
}

export {
  hasVaultPin,
  isValidPin,
  isVaultUnlocked,
  lockVaultSession,
  setupVaultPin,
  unlockVault
}
