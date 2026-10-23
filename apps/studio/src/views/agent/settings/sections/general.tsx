import { Icon } from '@iconify/react/offline'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@cogito/design/components/select'
import { Switch } from '@cogito/design/components/switch'
import { APPROVAL_POLICIES, findApprovalPolicy } from '@/features/chat/approval.ts'
import { findPlatformBlocker, findPlatformRow } from '@/features/chat/platform.ts'
import { useProviders } from '@/features/chat/provider/query.ts'
import { collectProviderModels } from '@/features/chat/provider/row.ts'
import { useAgentStore, type DurationFormat } from '@/stores/agent.ts'
import { SettingRow, SettingsSection } from '@/views/agent/settings/components/section.tsx'

/**
 * 耗时格式：`items` 与下拉里的选项共用这一份 —— base-ui 的触发器标签只认 `items`
 * （或 Root 的 `itemToStringLabel`），不像 radix 那样回读选中项的子树。
 */
const DURATION_FORMATS = [
  { value: 'integer', label: '整数秒' },
  { value: 'precise', label: '精确到 0.1 秒' }
] as const satisfies readonly { value: DurationFormat; label: string }[]

/**
 * 常规：对话区怎么渲染，模型从哪来，以及审批。
 *
 * 每个开关都有真实的消费者，不是摆设。原先这里有个「对话通路」选择器（本地 / 在线）——
 * 那是个伪选项：通路由**选中的模型**决定，两边的发送链路、工具、审批本来就是同一套，
 * 所以现在只报告状态，切换去「模型」页选模型。
 */
export function GeneralSection() {
  const chat = useAgentStore(function (state) {
    return state.settings.chat
  })
  const update = useAgentStore(function (state) {
    return state.update
  })

  const providers = useProviders().data ?? []
  const platform = findPlatformRow(providers)
  const blocker = findPlatformBlocker()
  const personalCount = providers.length - (platform ? 1 : 0)
  const policy = APPROVAL_POLICIES.find(function (item) {
    return item.value === chat.approval
  })

  return (
    <div className="flex flex-col gap-6">
      <SettingsSection
        title="常规"
        hint="这些开关直接决定对话区的渲染方式，改完立刻生效。">
        <SettingRow
          label="默认展开工具调用"
          hint="关掉后工具只显示一行摘要，点开才看参数与结果。"
          control={
            <Switch
              checked={chat.expandTools}
              aria-label="默认展开工具调用"
              onCheckedChange={function (checked) {
                void update('chat', { expandTools: checked })
              }}
            />
          }
        />

        <SettingRow
          label="显示工具调用次数"
          hint="关掉后折叠条只说「执行工具」，不播报次数与失败数。"
          control={
            <Switch
              checked={chat.showToolCount}
              aria-label="显示工具调用次数"
              onCheckedChange={function (checked) {
                void update('chat', { showToolCount: checked })
              }}
            />
          }
        />

        <SettingRow
          label="折叠回复过程"
          hint="回合结束后把推理与工具收成一行；关掉则保持展开。"
          control={
            <Switch
              checked={chat.collapseProcess}
              aria-label="折叠回复过程"
              onCheckedChange={function (checked) {
                void update('chat', { collapseProcess: checked })
              }}
            />
          }
        />

        <SettingRow
          label="耗时显示格式"
          hint="回合摘要里的秒数怎么取整。"
          control={
            <Select
              items={DURATION_FORMATS}
              value={chat.durationFormat}
              onValueChange={function (value) {
                if (value === null) return
                void update('chat', { durationFormat: value as DurationFormat })
              }}>
              <SelectTrigger
                className="w-36"
                aria-label="耗时显示格式">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DURATION_FORMATS.map(function (format) {
                  return (
                    <SelectItem
                      key={format.value}
                      value={format.value}>
                      {format.label}
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
          }
        />
      </SettingsSection>

      <SettingsSection
        title="模型来源"
        hint="组织模型由管理员在服务端配置，个人模型用你自己的 API Key 添加。两类模型走同一条发送链路，能力完全一致。">
        <SettingRow
          label="组织模型"
          hint={blocker ?? '登录后自动同步服务端目录，在「模型」页可见。'}
          control={
            <span className="text-sm">
              {platform ? `${collectProviderModels(platform).length} 个模型` : '未同步'}
            </span>
          }
        />

        <SettingRow
          label="个人模型"
          hint="本机 Ollama / LM Studio，或任意 OpenAI 兼容服务。密钥只写入主进程密钥库。"
          control={<span className="text-sm">{personalCount} 个</span>}
        />

        {blocker ? (
          <p className="text-muted-foreground flex items-start gap-1.5 pb-2.5 text-xs">
            <Icon
              icon="lucide:circle-alert"
              className="mt-0.5 size-3.5 shrink-0"
            />
            组织模型当前不可用：{blocker}
          </p>
        ) : null}
      </SettingsSection>

      <SettingsSection
        title="工具审批"
        hint="决定 Agent 调用工具前是否需要你拍板；输入区右下角的快捷开关改的是同一项。">
        <SettingRow
          label="审批策略"
          hint={policy?.hint}
          control={
            <Select
              items={APPROVAL_POLICIES}
              value={chat.approval}
              onValueChange={function (value) {
                if (value === null) return
                const next = findApprovalPolicy(value)
                if (next) void update('chat', { approval: next.value })
              }}>
              <SelectTrigger
                className="w-40"
                aria-label="工具审批策略">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {APPROVAL_POLICIES.map(function (item) {
                  return (
                    <SelectItem
                      key={item.value}
                      value={item.value}>
                      {item.label}
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
          }
        />
      </SettingsSection>
    </div>
  )
}
