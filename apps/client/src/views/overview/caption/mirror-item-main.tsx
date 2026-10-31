import { Button } from '@cogito/design/components/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@cogito/design/components/tooltip'
import { Icon } from '@iconify/react/offline'

import styles from '@/views/overview/caption/caption.module.scss'

interface MirrorItemMainProps {
  index: number
  title: string
  description: string
  isActive: boolean
  onSelect: () => void
}

/** 列表行：默认只显示序号 + 标题；有描述时延迟 Tooltip */
function MirrorItemMain(props: MirrorItemMainProps) {
  const body = (
    <>
      <span className={styles.mirrorItemIndex}>{props.index}</span>
      <span className={styles.mirrorItemTitle}>{props.title}</span>
      {props.isActive ? (
        <Icon
          icon="lucide:check"
          className={styles.mirrorItemCheck}
          aria-hidden
        />
      ) : null}
    </>
  )

  if (!props.description) {
    return (
      <Button
        type="button"
        variant="ghost"
        data-region="false"
        className={styles.mirrorItemMain}
        onClick={props.onSelect}>
        {body}
      </Button>
    )
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            data-region="false"
            className={styles.mirrorItemMain}
            onClick={props.onSelect}
          />
        }>
        {body}
      </TooltipTrigger>
      <TooltipContent
        side="right"
        sideOffset={10}
        className={styles.mirrorDescTip}>
        {props.description}
      </TooltipContent>
    </Tooltip>
  )
}

export { MirrorItemMain }
