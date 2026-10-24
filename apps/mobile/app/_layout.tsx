import FontAwesome from '@expo/vector-icons/FontAwesome'
import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router/react-navigation'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useFonts } from 'expo-font'
import { Redirect, Stack, useSegments } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import type { ReactNode } from 'react'
import { useEffect } from 'react'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import 'react-native-reanimated'

import { useAppColorScheme } from '@/components/useAppColorScheme'
import { useAuthStore } from '@/stores/authStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useTileStore } from '@/stores/tileStore'

import i18n from '@/i18n'
import '../global.css'

export { ErrorBoundary } from 'expo-router'

export const unstable_settings = {
  initialRouteName: '(navigation)'
}

SplashScreen.preventAutoHideAsync()

const queryClient = new QueryClient()

function AuthGate({ children }: { children: ReactNode }) {
  const segments = useSegments()
  const isHydrated = useAuthStore((state) => state.isHydrated)
  const userId = useAuthStore((state) => state.userId)
  const tilesHydrated = useTileStore((state) => state.isHydrated)

  useEffect(function () {
    void useAuthStore.getState().hydrate()
    useSettingsStore.getState().hydrate()
  }, [])

  useEffect(function () {
    const language = useSettingsStore.getState().language
    void i18n.changeLanguage(language)
  }, [])

  useEffect(
    function () {
      if (userId && !tilesHydrated) {
        useTileStore.getState().hydrate(userId)
      }
    },
    [userId, tilesHydrated]
  )

  if (!isHydrated) {
    return null
  }

  const inAuthGroup = segments[0] === '(auth)'

  if (!userId && !inAuthGroup) {
    return <Redirect href="/(auth)/login" />
  }

  if (userId && inAuthGroup) {
    return <Redirect href="/(navigation)" />
  }

  return children
}

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
    ...FontAwesome.font
  })

  useEffect(
    function () {
      if (error) throw error
    },
    [error]
  )

  useEffect(
    function () {
      if (loaded) {
        void SplashScreen.hideAsync()
      }
    },
    [loaded]
  )

  if (!loaded) {
    return null
  }

  return (
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        <RootLayoutNav />
      </SafeAreaProvider>
    </QueryClientProvider>
  )
}

function RootLayoutNav() {
  const colorScheme = useAppColorScheme()

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AuthGate>
        <Stack>
          <Stack.Screen
            name="(auth)"
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="(navigation)"
            options={{ headerShown: false }}
          />
        </Stack>
      </AuthGate>
    </ThemeProvider>
  )
}
