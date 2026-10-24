import type { ReactNode } from 'react'
import { ScrollView, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { useThemeColors } from '@/components/ui/useThemeColors'

interface ScreenProps {
  children: ReactNode
  scroll?: boolean
  padded?: boolean
  edges?: ('top' | 'right' | 'bottom' | 'left')[]
}

function Screen({
  children,
  scroll = false,
  padded = true,
  edges = ['top', 'left', 'right']
}: ScreenProps) {
  const colors = useThemeColors()
  const contentClass = padded ? 'flex-1 px-5 py-4' : 'flex-1'

  return (
    <SafeAreaView
      className="flex-1"
      edges={edges}
      style={{ backgroundColor: colors.background }}>
      {scroll ? (
        <ScrollView
          className="flex-1"
          contentContainerClassName={padded ? 'px-5 py-4 grow' : 'grow'}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          {children}
        </ScrollView>
      ) : (
        <View className={contentClass}>{children}</View>
      )}
    </SafeAreaView>
  )
}

export { Screen }
