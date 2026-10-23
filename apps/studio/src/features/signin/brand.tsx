import styles from './signin.module.scss'

const NOTES = ['Agent，对话留在同一处', '指令，流水线可以接着跑'] as const
const TAGLINE = '网址放在磁贴，书签收进集合。'
const FOOTNOTE = '© 2026 cogito'

/** 登录弹窗左侧。真磁贴在弹窗后面，这里不再另画一套图标。 */
function Brand() {
  return (
    <aside className={styles.brand}>
      <div className={styles.core}>
        <h3>cogito</h3>
        <p>{TAGLINE}</p>
        <ul className={styles.notes}>
          {NOTES.map(function (note) {
            return <li key={note}>{note}</li>
          })}
        </ul>
      </div>
      <footer className={styles.foot}>{FOOTNOTE}</footer>
    </aside>
  )
}

export { Brand }
