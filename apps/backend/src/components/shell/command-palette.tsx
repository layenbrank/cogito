import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator
} from '@i-thinking/design/components/command'
import { Icon } from '@iconify/react/offline'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'

import { GET_GATEWAY_ADMIN_MODELS } from '@/apis/gateway.ts'
import { GET_TENANTS } from '@/apis/tenant.ts'
import { GET_USERS } from '@/apis/user.ts'
import { NAV_GROUPS, NAV_ITEMS } from '@/constants/nav.ts'

interface CommandPaletteProps {
  open: boolean
  onOpenChange(open: boolean): void
}

function CommandPalette(props: CommandPaletteProps) {
  const navigate = useNavigate()
  const users = useQuery({
    queryKey: ['users', 'cmdk'],
    queryFn: GET_USERS,
    enabled: props.open,
    staleTime: 60_000
  })
  const tenants = useQuery({
    queryKey: ['tenants', 'cmdk'],
    queryFn: GET_TENANTS,
    enabled: props.open,
    staleTime: 60_000
  })
  const models = useQuery({
    queryKey: ['gateway-admin-models', 'cmdk'],
    queryFn: GET_GATEWAY_ADMIN_MODELS,
    enabled: props.open,
    staleTime: 60_000
  })

  function go(path: string) {
    props.onOpenChange(false)
    void navigate(path)
  }

  return (
    <CommandDialog
      open={props.open}
      onOpenChange={function (open) {
        props.onOpenChange(open)
      }}
      title="命令面板"
      description="跳转模块或搜索实体"
      className="top-[12%] max-h-[min(84vh,44rem)] sm:max-w-2xl">
      <Command className="gap-1 p-1.5">
        <CommandInput placeholder="搜索页面、用户、租户、模型…" />
        <CommandList className="max-h-[min(62vh,32rem)]">
          <CommandEmpty>无匹配结果</CommandEmpty>
          {NAV_GROUPS.map(function (group) {
            const items = NAV_ITEMS.filter(function (item) {
              return item.group === group.id
            })
            if (items.length === 0) return null
            return (
              <CommandGroup
                key={group.id}
                heading={group.label}>
                {items.map(function (item) {
                  return (
                    <CommandItem
                      key={item.id}
                      value={`${item.label} ${item.path} ${group.label}`}
                      onSelect={function () {
                        go(item.path)
                      }}>
                      <Icon
                        icon={item.icon}
                        className="size-4"
                      />
                      {item.label}
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            )
          })}
          <CommandSeparator />
          <CommandGroup heading="用户">
            {(users.data ?? []).slice(0, 8).map(function (user) {
              return (
                <CommandItem
                  key={user.id}
                  value={`user ${user.username} ${user.email ?? ''}`}
                  onSelect={function () {
                    go(`/users?focus=${user.id}`)
                  }}>
                  <Icon
                    icon="lucide:user"
                    className="size-4"
                  />
                  {user.username}
                  <span className="ms-auto font-mono text-[10px] text-muted-foreground">
                    {user.role}
                  </span>
                </CommandItem>
              )
            })}
          </CommandGroup>
          <CommandGroup heading="租户">
            {(tenants.data ?? []).slice(0, 8).map(function (tenant) {
              return (
                <CommandItem
                  key={tenant.id}
                  value={`tenant ${tenant.name} ${tenant.id}`}
                  onSelect={function () {
                    go(`/tenants?focus=${tenant.id}`)
                  }}>
                  <Icon
                    icon="lucide:building-2"
                    className="size-4"
                  />
                  {tenant.name}
                </CommandItem>
              )
            })}
          </CommandGroup>
          <CommandGroup heading="模型">
            {(models.data ?? []).slice(0, 8).map(function (model) {
              return (
                <CommandItem
                  key={model.id}
                  value={`model ${model.label} ${model.name} ${model.id}`}
                  onSelect={function () {
                    go(`/gateway/models?focus=${model.id}`)
                  }}>
                  <Icon
                    icon="lucide:boxes"
                    className="size-4"
                  />
                  {model.label || model.name}
                </CommandItem>
              )
            })}
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  )
}

export { CommandPalette }
