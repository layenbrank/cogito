/**
 * Glow Up 5 — watermarked preview.
 *
 * Full export needs Shaders Pro (collection: glow-up).
 * Unlock: https://shaders.com/pro#pricing
 * Then: `npx shaders login && npx shaders install glow-up-5`
 * (or `npx shaders update`) to replace this Preview with the real component tree.
 *
 * Preset id: 7ad1b01c-d3ec-488d-9cb9-b21bbc28f8a6
 */
import { Preview } from 'shaders/react'

interface GlowUp5Props {
  className?: string
}

function GlowUp5(props: GlowUp5Props) {
  return (
    <Preview
      presetId="7ad1b01c-d3ec-488d-9cb9-b21bbc28f8a6"
      className={props.className}
    />
  )
}

export { GlowUp5 }
export type { GlowUp5Props }
