import { Button } from '@cogito/design/components/button'
import { Input } from '@cogito/design/components/input'
import { useState, type ChangeEvent } from 'react'

import { findExecutor } from '@/features/agent/port/router.ts'
import type { Executor } from '@/features/agent/port/cloud.ts'
import { findPref, patchPref } from '@/features/platform/prefs.ts'
import { findAuthToken, writeAuthToken } from '@/features/platform/secrets.ts'
import { SURFACE_STACK, SettingsRow, SettingsSection } from '@/views/settings/surfaces/section.tsx'

function AccountSurface() {
  const [token, updateToken] = useState(function () {
    return findAuthToken() ?? ''
  })
  const [model, updateModel] = useState(function () {
    return findPref('agent').model ?? ''
  })
  const [executor, updateExecutor] = useState<Executor | null>(null)

  return (
    <div className={SURFACE_STACK}>
      <SettingsSection title="云端网关">
        <SettingsRow
          label="令牌"
          hint="装了桌面端并开启 Agent 代理时走本机 agentd；否则用这份令牌走云端，仅对话。">
          <Input
            type="password"
            value={token}
            placeholder="登录后拿到的 JWT"
            className="max-w-sm"
            onChange={function (event: ChangeEvent<HTMLInputElement>) {
              updateToken(event.target.value)
            }}
            onBlur={function () {
              void writeAuthToken(token)
            }}
          />
        </SettingsRow>
        <SettingsRow label="模型">
          <Input
            value={model}
            placeholder="如 deepseek-chat"
            className="max-w-sm"
            onChange={function (event: ChangeEvent<HTMLInputElement>) {
              updateModel(event.target.value)
            }}
            onBlur={function () {
              void patchPref('agent', { model: model.trim() || null })
            }}
          />
        </SettingsRow>
        <SettingsRow label="执行者">
          <Button
            type="button"
            variant="outline"
            onClick={function () {
              void findExecutor().then(updateExecutor)
            }}>
            检测
          </Button>
          <span className="text-sm text-muted-foreground">
            {executor ? `${executor.kind} · ${executor.detail}` : '未检测'}
          </span>
        </SettingsRow>
      </SettingsSection>
    </div>
  )
}

export default AccountSurface
