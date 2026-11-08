import { Button } from '@cogito/design/components/button'
import { Input } from '@cogito/design/components/input'
import { Label } from '@cogito/design/components/label'
import { Icon } from '@iconify/react/offline'
import clsx from 'clsx'
import { useState, type Ref } from 'react'

import { SIGNIN_COPY } from '@/features/signin/constants.ts'

interface SignInFieldProps {
  id: string
  label: string
  value: string
  onValueChange: (value: string) => void
  type?: 'text' | 'password'
  autoComplete?: string
  icon: string
  placeholder?: string
  error?: string
  autoFocus?: boolean
  disabled?: boolean
  inputRef?: Ref<HTMLInputElement>
}

function SignInField(props: SignInFieldProps) {
  const {
    id,
    label,
    value,
    onValueChange,
    type = 'text',
    autoComplete,
    icon,
    placeholder,
    error,
    autoFocus,
    disabled,
    inputRef
  } = props
  const [isRevealed, updateRevealed] = useState(false)
  const isPassword = type === 'password'
  const errorId = `${id}-error`

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground">
          <Icon
            icon={icon}
            className="size-4"
          />
        </span>
        <Input
          ref={inputRef}
          id={id}
          name={id}
          value={value}
          placeholder={placeholder}
          autoComplete={autoComplete}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          autoFocus={autoFocus}
          disabled={disabled}
          type={isPassword && !isRevealed ? 'password' : 'text'}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? errorId : undefined}
          className={clsx('h-11 pl-9', isPassword && 'pr-10')}
          onChange={function (event) {
            onValueChange(event.target.value)
          }}
        />
        {isPassword ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={disabled}
            className="absolute top-1/2 right-1.5 size-9 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            aria-label={isRevealed ? SIGNIN_COPY.hidePassword : SIGNIN_COPY.revealPassword}
            onClick={function () {
              updateRevealed(function (current) {
                return !current
              })
            }}>
            <Icon
              icon={isRevealed ? 'lucide:eye-off' : 'lucide:eye'}
              className="size-4"
            />
          </Button>
        ) : null}
      </div>
      {error ? (
        <p
          id={errorId}
          role="alert"
          className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}

export { SignInField }
export type { SignInFieldProps }
