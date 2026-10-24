import { zodResolver } from '@hookform/resolvers/zod'
import { Link, router } from 'expo-router'
import { Lock, User, UserPlus } from 'lucide-react-native'
import { Controller, useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { Alert, Pressable, Text, View } from 'react-native'
import { z } from 'zod'

import { useSlideProof } from '@/components/auth/SlideCaptcha'
import { FormField } from '@/components/ui/FormField'
import { PrimaryButton } from '@/components/ui/PrimaryButton'
import { Screen } from '@/components/ui/Screen'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { useThemeColors } from '@/components/ui/useThemeColors'
import { findApiBaseUrl } from '@/constants/config'
import { useAuthStore } from '@/stores/authStore'

const schema = z
  .object({
    username: z.string().min(2, 'invalidUsername'),
    password: z.string().min(6, 'passwordMin'),
    confirmPassword: z.string()
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'passwordMismatch',
    path: ['confirmPassword']
  })

type FormData = z.infer<typeof schema>

export default function RegisterScreen() {
  const { t } = useTranslation()
  const colors = useThemeColors()
  const signUp = useAuthStore((state) => state.signUp)
  const isLoading = useAuthStore((state) => state.isLoading)
  const { askSlide, dialog } = useSlideProof()

  const {
    control,
    handleSubmit,
    formState: { errors }
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { username: '', password: '', confirmPassword: '' }
  })

  async function onSubmit(data: FormData) {
    const proof = await askSlide()
    if (!proof) {
      return
    }

    const error = await signUp({
      username: data.username,
      password: data.password,
      captchaKey: proof.captchaKey,
      captchaValue: proof.captchaValue,
      captchaKind: proof.captchaKind
    })
    if (error) {
      Alert.alert(t('signUp'), error)
      return
    }
    router.replace('/(navigation)')
  }

  return (
    <Screen scroll>
      {dialog}
      <SectionHeader
        icon={UserPlus}
        title={t('signUp')}
        description={`${t('welcome')}\n${findApiBaseUrl()}`}
      />

      <View className="gap-5">
        <Controller
          control={control}
          name="username"
          render={({ field: { onChange, onBlur, value } }) => (
            <FormField
              autoCapitalize="none"
              error={errors.username ? t(errors.username.message as 'invalidUsername') : undefined}
              icon={User}
              label={t('username')}
              onBlur={onBlur}
              onChangeText={onChange}
              placeholder="newuser"
              value={value}
            />
          )}
        />

        <Controller
          control={control}
          name="password"
          render={({ field: { onChange, onBlur, value } }) => (
            <FormField
              autoCapitalize="none"
              error={errors.password ? t(errors.password.message as 'passwordMin') : undefined}
              icon={Lock}
              label={t('password')}
              onBlur={onBlur}
              onChangeText={onChange}
              placeholder="••••••"
              secureTextEntry
              value={value}
            />
          )}
        />

        <Controller
          control={control}
          name="confirmPassword"
          render={({ field: { onChange, onBlur, value } }) => (
            <FormField
              autoCapitalize="none"
              error={
                errors.confirmPassword
                  ? t(errors.confirmPassword.message as 'passwordMismatch')
                  : undefined
              }
              icon={Lock}
              label={t('confirmPassword')}
              onBlur={onBlur}
              onChangeText={onChange}
              placeholder="••••••"
              secureTextEntry
              value={value}
            />
          )}
        />

        <PrimaryButton
          label={t('signUp')}
          loading={isLoading}
          onPress={handleSubmit(onSubmit)}
        />

        <View className="flex-row items-center justify-center gap-1">
          <Text
            className="text-sm"
            style={{ color: colors.textSecondary }}>
            {t('hasAccount')}
          </Text>
          <Link
            href="/(auth)/login"
            asChild>
            <Pressable
              accessibilityRole="link"
              className="min-h-[44px] justify-center px-1 active:opacity-70">
              <Text
                className="text-sm font-semibold"
                style={{ color: colors.tint }}>
                {t('goLogin')}
              </Text>
            </Pressable>
          </Link>
        </View>
      </View>
    </Screen>
  )
}
