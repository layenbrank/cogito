import { BrandShader as DeskShader } from '@cogito/brand/shader'

interface BrandShaderProps {
  onUnavailable?: () => void
}

function BrandShader(props: BrandShaderProps) {
  return (
    <DeskShader
      className="absolute inset-0 size-full"
      onUnavailable={props.onUnavailable}
    />
  )
}

export { BrandShader }
export type { BrandShaderProps }
