import { describe, expect, it } from 'vitest'

import {
  findLockPin,
  findOnlinePackage,
  hasLockPin,
  isOnDemandTool,
  listOnDemandFiles,
  listOnDemandTools,
  parseOnlineManifest,
  parseStagingChecksums,
  parseToolsLock,
  requireLockPin,
  ONLINE_TOOL_KEYS,
  SIDECAR_SCHEMA_VERSION,
  SIDECAR_TOOL_KEYS
} from './schema'

const SHA = 'a'.repeat(64)

function buildLock(): unknown {
  return {
    schemaVersion: SIDECAR_SCHEMA_VERSION,
    tools: {
      corex: {
        platforms: {
          'win32-x64': { version: '14.0.0', url: 'https://example.invalid/corex.zip', sha256: SHA }
        }
      },
      pandoc: {
        onDemand: true,
        platforms: {
          'win32-x64': { version: '3.6.4', url: 'https://example.invalid/pandoc.zip', sha256: SHA },
          'linux-x64': { version: '3.6.4', url: 'https://example.invalid/pandoc.tgz', sha256: SHA }
        }
      }
    }
  }
}

function buildManifest(): unknown {
  return {
    schemaVersion: SIDECAR_SCHEMA_VERSION,
    tools: {
      pandoc: {
        label: 'Pandoc',
        summary: '文档转换',
        version: '3.6.4',
        binaries: ['pandoc'],
        platforms: { 'win32-x64': { url: 'https://example.invalid/pandoc.zip', sha256: SHA } }
      }
    }
  }
}

function buildChecksums(): unknown {
  return {
    schemaVersion: SIDECAR_SCHEMA_VERSION,
    platform: 'win32-x64',
    files: {
      'corex-daemon-x86_64-pc-windows-msvc.exe': {
        tool: 'corex',
        version: '14.0.0',
        sha256: SHA
      },
      'pandoc.exe': { tool: 'pandoc', version: '3.6.4', sha256: SHA, onDemand: true }
    }
  }
}

describe('sidecar 产物契约', function () {
  it('keeps the online tool keys inside the full key set', function () {
    for (const key of ONLINE_TOOL_KEYS) {
      expect(SIDECAR_TOOL_KEYS).toContain(key)
    }
  })

  it('parses tools.lock and answers pin questions', function () {
    const lock = parseToolsLock(buildLock(), 'test.lock.json')

    expect(findLockPin(lock, 'pandoc', 'linux-x64')?.version).toBe('3.6.4')
    expect(hasLockPin(lock, 'corex', 'linux-x64')).toBe(false)
    expect(requireLockPin(lock, 'corex', 'win32-x64').version).toBe('14.0.0')
    expect(function () {
      return requireLockPin(lock, 'corex', 'linux-x64')
    }).toThrow(/corex/)
    expect(isOnDemandTool(lock, 'pandoc')).toBe(true)
    expect(isOnDemandTool(lock, 'corex')).toBe(false)
    expect(listOnDemandTools(lock)).toEqual(['pandoc'])
  })

  it('rejects a tools.lock from before the shape change', function () {
    const legacy = { schemaVersion: 1, corex: { 'win32-x64': { version: '1', url: 'https://x', sha256: SHA } } }
    expect(function () {
      return parseToolsLock(legacy)
    }).toThrow(/schemaVersion/)
  })

  it('rejects a pin whose url is not pinned to https', function () {
    const lock = buildLock() as { tools: { corex: { platforms: Record<string, unknown> } } }
    lock.tools.corex.platforms['win32-x64'] = { version: '1', url: 'http://x/y.zip', sha256: SHA }
    expect(function () {
      return parseToolsLock(lock)
    }).toThrow(/https/)
  })

  it('reads the online package per platform, null when the platform has none', function () {
    const manifest = parseOnlineManifest(buildManifest())

    expect(findOnlinePackage(manifest, 'pandoc', 'win32-x64')?.sha256).toBe(SHA)
    expect(findOnlinePackage(manifest, 'pandoc', 'darwin-arm64')).toBeNull()
    expect(findOnlinePackage(manifest, 'ffmpeg', 'win32-x64')).toBeNull()
  })

  it('parses checksums and lists the on-demand files', function () {
    const checksums = parseStagingChecksums(buildChecksums())

    expect(checksums.platform).toBe('win32-x64')
    expect(checksums.files['pandoc.exe']?.version).toBe('3.6.4')
    expect(listOnDemandFiles(checksums)).toEqual(['pandoc.exe'])
  })

  it('rejects the legacy “file name → bare hash” checksums', function () {
    const legacy = { platform: 'win32-x64', onDemand: ['pandoc.exe'], files: { 'pandoc.exe': SHA } }
    expect(function () {
      return parseStagingChecksums(legacy)
    }).toThrow(/schemaVersion/)
  })

  it('rejects a staged file that names an unknown tool', function () {
    const broken = buildChecksums() as { files: Record<string, unknown> }
    broken.files['x.exe'] = { tool: 'nope', version: '1', sha256: SHA }
    expect(function () {
      return parseStagingChecksums(broken)
    }).toThrow(/已知工具/)
  })
})
