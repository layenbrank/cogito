import { Icon } from '@iconify/react/offline'
import { Input } from '@i-thinking/design/components/input'
import { Spinner } from '@i-thinking/design/components/spinner'
import type { RefObject } from 'react'
import { toast } from 'sonner'

import type { WorkspaceSkill } from '@/lib/workspace-skills'

import styles from './attach-menu.module.scss'

interface AttachMenuSkillsPaneProps {
  searchRef: RefObject<HTMLInputElement | null>
  query: string
  onQueryChange: (query: string) => void
  loading: boolean
  skills: WorkspaceSkill[]
  onAttachPath: (path: string, name: string, relativePath?: string) => void
}

function AttachMenuSkillsPane(props: AttachMenuSkillsPaneProps) {
  function handleSkillFooter(kind: 'manage' | 'explore') {
    toast.info(kind === 'manage' ? '管理技能即将推出' : '探索更多技能即将推出')
  }

  return (
    <>
      <div className={styles.searchWrap}>
        <div className={styles.searchField}>
          <Icon
            icon="mdi:magnify"
            className={styles.searchIcon}
            width={15}
            height={15}
          />
          <Input
            ref={props.searchRef}
            placeholder="搜索技能"
            className={styles.searchInput}
            value={props.query}
            onChange={function (event) {
              props.onQueryChange(event.target.value)
            }}
          />
        </div>
      </div>
      <div className={styles.list}>
        {props.loading ? (
          <div className={styles.loading}>
            <Spinner />
          </div>
        ) : props.skills.length === 0 ? (
          <p className={styles.empty}>未发现技能</p>
        ) : (
          props.skills.map(function (skill) {
            return (
              <button
                key={skill.id}
                type="button"
                className={styles.row}
                onClick={function () {
                  props.onAttachPath(skill.path, skill.name, skill.relative)
                }}>
                <span className={styles.rowIconBadge}>
                  <Icon
                    icon="mdi:hammer-wrench"
                    width={16}
                    height={16}
                  />
                </span>
                <span className={styles.rowBody}>
                  <span className={styles.rowTitle}>{skill.name}</span>
                  {skill.description ? (
                    <span className={styles.rowMeta}>{skill.description}</span>
                  ) : null}
                </span>
                <span className={styles.rowAdd}>
                  <Icon
                    icon="mdi:plus"
                    width={14}
                    height={14}
                  />
                </span>
              </button>
            )
          })
        )}
      </div>
      <div className={styles.footer}>
        <button
          type="button"
          className={styles.footerItem}
          onClick={function () {
            handleSkillFooter('manage')
          }}>
          <Icon
            icon="mdi:cog-outline"
            width={15}
            height={15}
          />
          管理技能
        </button>
        <button
          type="button"
          className={styles.footerItem}
          onClick={function () {
            handleSkillFooter('explore')
          }}>
          <Icon
            icon="mdi:compass-outline"
            width={15}
            height={15}
          />
          探索更多技能
        </button>
      </div>
    </>
  )
}

export { AttachMenuSkillsPane }
