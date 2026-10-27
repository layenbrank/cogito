import { Icon } from '@iconify/react/offline'
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage
} from '@cogito/design/components/form'
import { Input } from '@cogito/design/components/input'
import { cn } from 'cn'
import { useState, type ReactNode } from 'react'
import type { Control, FieldPath, FieldValues } from 'react-hook-form'

interface AuthFieldProps<T extends FieldValues> {
  control: Control<T>
  name: FieldPath<T>
  label: string
  placeholder: string
  /** 左侧装饰图标（lucide）；密码框已有显隐切换，一般不传 */
  icon?: ReactNode
  /** 传 password 时渲染为可切换明文的密码框 */
  type?: 'text' | 'password'
  maxLength?: number
  inputMode?: 'text' | 'numeric'
  autoComplete?: string
}

/**
 * 登录/注册用的受控字段：图标 + 标签 + 校验信息。
 *
 * 单独抽出来只是为了避免三套表单里重复 8 次同样的组合，
 * 内部仍是标准 shadcn 的 FormField + FormItem + FormControl + FormMessage。
 */
function AuthField<T extends FieldValues>(props: AuthFieldProps<T>) {
  const {
    control,
    name,
    label,
    placeholder,
    icon,
    type = 'text',
    maxLength,
    inputMode,
    autoComplete
  } = props
  const [isRevealed, updateRevealed] = useState(false)
  const isPassword = type === 'password'
  const hasPrefix = icon != null

  return (
    <FormField
      control={control}
      name={name}
      render={function ({ field }) {
        return (
          <FormItem>
            <FormLabel>{label}</FormLabel>
            <div className="relative">
              {hasPrefix && (
                <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground [&_svg]:size-4">
                  {icon}
                </span>
              )}
              <FormControl>
                <Input
                  {...field}
                  value={(field.value as string | undefined) ?? ''}
                  className={cn('h-11', hasPrefix && 'pl-9', isPassword && 'pr-10')}
                  type={isPassword && !isRevealed ? 'password' : 'text'}
                  maxLength={maxLength}
                  inputMode={inputMode}
                  autoComplete={autoComplete}
                  placeholder={placeholder}
                  aria-label={label}
                />
              </FormControl>
              {isPassword && (
                <button
                  type="button"
                  className="absolute top-1/2 right-1.5 flex size-9 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground"
                  onClick={function () {
                    updateRevealed(function (prev) {
                      return !prev
                    })
                  }}
                  aria-label={isRevealed ? '隐藏密码' : '显示密码'}>
                  {isRevealed ? (
                    <Icon
                      icon="lucide:eye-off"
                      className="size-4"
                    />
                  ) : (
                    <Icon
                      icon="lucide:eye"
                      className="size-4"
                    />
                  )}
                </button>
              )}
            </div>
            <FormMessage />
          </FormItem>
        )
      }}
    />
  )
}

export { AuthField }
export type { AuthFieldProps }
