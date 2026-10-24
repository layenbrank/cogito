import { Bot, LayoutGrid, Settings, type LucideIcon } from 'lucide-react-native'
import { Tabs } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { Platform, type ColorValue } from 'react-native'

import { useThemeColors } from '@/components/ui/useThemeColors'

interface NavIconProps {
  icon: LucideIcon
  color: ColorValue
  focused: boolean
}

function NavIcon({ icon: Icon, color, focused }: NavIconProps) {
  return (
    <Icon
      size={22}
      color={typeof color === 'string' ? color : '#000'}
      strokeWidth={focused ? 2.25 : 1.75}
    />
  )
}

export default function NavigationLayout() {
  const colors = useThemeColors()
  const { t } = useTranslation()

  return (
    <Tabs
      screenOptions={{
        headerStyle: {
          backgroundColor: colors.surface
        },
        headerTintColor: colors.text,
        headerTitleStyle: {
          fontWeight: '600',
          fontSize: 17
        },
        headerShadowVisible: false,
        headerTitleAlign: 'center',
        tabBarActiveTintColor: colors.tabIconSelected,
        tabBarInactiveTintColor: colors.tabIconDefault,
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
          marginTop: 2
        },
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          borderTopWidth: 1,
          height: Platform.OS === 'ios' ? 88 : 64,
          paddingTop: 8,
          paddingBottom: Platform.OS === 'ios' ? 28 : 10
        },
        tabBarItemStyle: {
          minHeight: 44,
          gap: 2
        }
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: t('tiles'),
          headerShown: false,
          tabBarAccessibilityLabel: t('tiles'),
          tabBarIcon: ({ color, focused }) => (
            <NavIcon
              icon={LayoutGrid}
              color={color}
              focused={focused}
            />
          )
        }}
      />
      <Tabs.Screen
        name="agent"
        options={{
          title: t('agent'),
          tabBarAccessibilityLabel: t('agent'),
          tabBarIcon: ({ color, focused }) => (
            <NavIcon
              icon={Bot}
              color={color}
              focused={focused}
            />
          )
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: t('settings'),
          tabBarAccessibilityLabel: t('settings'),
          tabBarIcon: ({ color, focused }) => (
            <NavIcon
              icon={Settings}
              color={color}
              focused={focused}
            />
          )
        }}
      />
    </Tabs>
  )
}
