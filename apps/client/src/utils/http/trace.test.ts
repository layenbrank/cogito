import { describe, expect, it } from 'vitest'

import { makeTraceparent, traceIdOf } from '@/utils/http/trace.ts'

const ZERO_TRACE_ID = '0'.repeat(32)

describe('makeTraceparent', function () {
  it('builds a well-formed w3c traceparent', function () {
    expect(makeTraceparent()).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/)
  })

  it('marks the trace as sampled so the server keeps it', function () {
    expect(makeTraceparent().endsWith('-01')).toBe(true)
  })

  it('never produces a zero trace-id or span-id', function () {
    for (let round = 0; round < 200; round += 1) {
      expect(traceIdOf(makeTraceparent())).toBeDefined()
    }
  })

  it('starts a new trace per call', function () {
    const seen = new Set<string>()
    for (let round = 0; round < 50; round += 1) seen.add(makeTraceparent())

    expect(seen.size).toBe(50)
  })
})

describe('traceIdOf', function () {
  const traceId = '4bf92f3577b34da6a3ce929d0e0e4736'

  it('reads the trace-id out of a traceparent', function () {
    expect(traceIdOf(`00-${traceId}-00f067aa0ba902b7-01`)).toBe(traceId)
  })

  it('rejects anything that is not a traceparent', function () {
    expect(traceIdOf(null)).toBeUndefined()
    expect(traceIdOf(undefined)).toBeUndefined()
    expect(traceIdOf('')).toBeUndefined()
    expect(traceIdOf('not-a-traceparent')).toBeUndefined()
  })

  it('rejects uppercase hex that violates the w3c format', function () {
    expect(traceIdOf(`00-${traceId.toUpperCase()}-00f067aa0ba902b7-01`)).toBeUndefined()
  })

  it('tolerates the whitespace the http layer may leave around a header', function () {
    expect(traceIdOf(` 00-${traceId}-00f067aa0ba902b7-01 `)).toBe(traceId)
  })

  it('rejects the all-zero trace-id that w3c forbids', function () {
    expect(traceIdOf(`00-${ZERO_TRACE_ID}-00f067aa0ba902b7-01`)).toBeUndefined()
  })

  it('rejects short or over-long identifiers', function () {
    expect(traceIdOf(`00-${traceId.slice(0, 31)}-00f067aa0ba902b7-01`)).toBeUndefined()
    expect(traceIdOf(`00-${traceId}-00f067aa0ba902b7-0102-01`)).toBeUndefined()
  })
})
