/**
 * Liquid Reveal — watermarked preview.
 *
 * Full export needs Shaders Pro (collection: liquid-reveal).
 * Unlock: https://shaders.com/pro#pricing
 * Then: `npx shaders login && npx shaders install liquid-reveal-1`
 * (or `npx shaders update`) to replace this Preview with the real component tree.
 *
 * Preset id: 50f5a15f-fd6b-404b-a81e-01fc746fb8b0
 */
import { Preview } from 'shaders/react'

interface LiquidRevealProps {
  className?: string
}

function LiquidReveal(props: LiquidRevealProps) {
  return (
    <Preview
      presetId="50f5a15f-fd6b-404b-a81e-01fc746fb8b0"
      className={props.className}
    />
  )
}

export { LiquidReveal }
export type { LiquidRevealProps }
