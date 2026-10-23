/**
 * 跨域 PIN/锁：读写 `vault.json`（persist.vault），图库等只消费本 API。
 */
import { ensurePersist, findPref, patchPref } from '@/features/persist'

import { PIN_MAX_LENGTH, PIN_MIN_LENGTH } from '@/views/gallery/constraints'

let sessionUnlocked = false

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
  await ensurePersist()
  return findPref('vault').pinHash
}

async function hasVaultPin(): Promise<boolean> {
  const hash = await findPinHash()
  return Boolean(hash)
}

async function setupVaultPin(pin: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!isValidPin(pin)) {
    return { ok: false, reason: `PIN 需为 ${PIN_MIN_LENGTH}–${PIN_MAX_LENGTH} 位数字` }
  }
  const pinHash = await hashPin(pin)
  await patchPref('vault', { pinHash })
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
