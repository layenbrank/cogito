import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'

import styles from '@/views/agent/settings/settings.module.scss'

function ModelHeader(props: { onAdd: () => void }) {
  return (
    <header className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className={styles.title}>模型</h2>
        <p className={styles.desc}>
          组织模型由管理员在后台配置；个人模型用自己的 API Key 添加，密钥只保存在本机。
        </p>
      </div>
      <Button
        type="button"
        size="sm"
        className="shrink-0 gap-1.5"
        onClick={props.onAdd}>
        <Icon
          icon="lucide:plus"
          className="size-3.5"
        />
        添加模型
      </Button>
    </header>
  )
}

export { ModelHeader }
