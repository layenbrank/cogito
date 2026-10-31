import { describe, expect, it } from 'vitest'

import { findDayLabel, startsNewDay } from './thread-day'

const WORDS = { today: 'Today', yesterday: 'Yesterday' }

describe('startsNewDay', function () {
  it('starts a new day when there is no previous message', function () {
    expect(startsNewDay(new Date(2026, 9, 31, 9, 0))).toBe(true)
  })

  it('keeps one divider for messages of the same local day', function () {
    expect(
      startsNewDay(new Date(2026, 9, 31, 23, 59), new Date(2026, 9, 31, 0, 1))
    ).toBe(false)
  })

  it('splits right after midnight', function () {
    expect(startsNewDay(new Date(2026, 10, 1, 0, 1), new Date(2026, 9, 31, 23, 59))).toBe(true)
  })
})

describe('findDayLabel', function () {
  it('names the current day', function () {
    expect(findDayLabel(new Date(), WORDS, 'en-US')).toBe('Today')
  })

  it('names the previous day', function () {
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)

    expect(findDayLabel(yesterday, WORDS, 'en-US')).toBe('Yesterday')
  })

  it('formats older dates with the injected locale', function () {
    const label = findDayLabel(new Date(2020, 0, 2), WORDS, 'en-US')

    expect(label).toBe('Jan 2, 2020')
  })
})
