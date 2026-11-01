import { describe, expect, it } from 'vitest'

import {
  isManifestKey,
  isPublicKey,
  SETUP_EXE_KEY,
  UPDATER_ZIP_KEY
} from './setup-key.ts'

describe('isPublicKey / 读侧白名单', function () {
  it('放行 setup.exe、msi、nsis.zip、渠道 latest.json', function () {
    expect(isPublicKey('1.3.0/cogito_1.3.0_x64-setup.exe')).toBe(true)
    expect(isPublicKey('1.5.0/cogito_1.5.0_x64_zh-CN.msi')).toBe(true)
    expect(isPublicKey('1.5.0/cogito_1.5.0_x64_en-US.msi')).toBe(true)
    expect(isPublicKey('1.5.0/cogito_1.5.0_x64-setup.nsis.zip')).toBe(true)
    expect(isPublicKey('1.5.0-alpha.1/cogito_1.5.0-alpha.1_x64-setup.nsis.zip')).toBe(true)
    expect(isPublicKey('updater-stable/latest.json')).toBe(true)
    expect(isPublicKey('updater-alpha/latest.json')).toBe(true)
  })

  it('拒绝工具产物、错误渠道、裸文件名', function () {
    expect(isPublicKey('tools/ffmpeg.zip')).toBe(false)
    expect(isPublicKey('updater-nightly/latest.json')).toBe(false)
    expect(isPublicKey('latest.json')).toBe(false)
    expect(isPublicKey('1.3.0/notes.txt')).toBe(false)
    expect(isPublicKey('1.3.0/cogito_1.3.0_x64-setup.nsis.zip.sig')).toBe(false)
  })

  it('isManifestKey 仅渠道清单', function () {
    expect(isManifestKey('updater-rc/latest.json')).toBe(true)
    expect(isManifestKey('1.3.0/cogito_1.3.0_x64-setup.exe')).toBe(false)
  })

  it('SETUP_EXE_KEY / UPDATER_ZIP_KEY 互不混淆', function () {
    expect(SETUP_EXE_KEY.test('1.3.0/x-setup.exe')).toBe(true)
    expect(SETUP_EXE_KEY.test('1.3.0/x-setup.nsis.zip')).toBe(false)
    expect(UPDATER_ZIP_KEY.test('1.3.0/x-setup.nsis.zip')).toBe(true)
    expect(UPDATER_ZIP_KEY.test('1.3.0/x-setup.exe')).toBe(false)
  })
})
