import { BrandShader as DeskShader, type BrandShaderProps } from '@cogito/brand/shader'

import styles from '../signin.module.scss'

function BrandShader(props: BrandShaderProps) {
  return (
    <DeskShader
      className={styles.brandShaderMount}
      onUnavailable={props.onUnavailable}
    />
  )
}

export { BrandShader }
export type { BrandShaderProps }
