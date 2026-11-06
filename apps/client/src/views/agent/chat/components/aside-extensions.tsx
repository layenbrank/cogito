/**
 * 右栏「扩展」页签：MCP / 内置扩展开关 + 「添加 MCP」。
 *
 * 内容原样复用 `ExtensionsPane`（它以前挂在输入区 `+` 面板里）；这里只补一个跳转：
 * 改扩展配置要去设置页，右栏没有设置入口。
 */
import { useNavigate } from 'react-router-dom'

import { ExtensionsPane } from './extensions-pane.tsx'

function AsideExtensions() {
  const navigate = useNavigate()
  return (
    <ExtensionsPane
      active
      onManage={function () {
        void navigate('/agent/settings?section=extensions')
      }}
    />
  )
}

export { AsideExtensions }
