import { useMemo, useState } from 'react'

import {
  generateDerivedShades,
  parsePresetHues
} from '@/features/capture/components/colors'
import { THEME_PRIMARY } from './constants'

interface UtilityColorState {
  pickerOpen: boolean
  setPickerOpen: (open: boolean) => void
  pinnedMainColor: string
  setPinnedMainColor: (color: string) => void
  presetHues: string[]
  mainColor: string
  derivedShades: string[]
  isCustomColor: boolean
}

function useUtilityColor(color: string): UtilityColorState {
  const [pinnedMainColor, setPinnedMainColor] = useState(color)
  const [pickerOpen, setPickerOpen] = useState(false)

  const presetHues = useMemo(function () {
    return parsePresetHues(THEME_PRIMARY)
  }, [])

  const presetMatch = useMemo(
    function () {
      return (
        presetHues.find(function (c) {
          return c.toUpperCase() === color.toUpperCase()
        }) ?? null
      )
    },
    [color, presetHues]
  )
  const mainColor = presetMatch ?? pinnedMainColor

  const derivedShades = useMemo(
    function () {
      return generateDerivedShades(mainColor)
    },
    [mainColor]
  )

  const isCustomColor =
    !presetHues.some((c) => c.toUpperCase() === color.toUpperCase()) &&
    !derivedShades.some((c) => c.toUpperCase() === color.toUpperCase())

  return {
    pickerOpen,
    setPickerOpen,
    pinnedMainColor,
    setPinnedMainColor,
    presetHues,
    mainColor,
    derivedShades,
    isCustomColor
  }
}

export type { UtilityColorState }
export { useUtilityColor }
