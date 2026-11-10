import { Tabs } from 'expo-router';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { refreshMealRemindersFromDb } from '../../lib/reminders';
import { colors } from '../../lib/theme';
import { useAuth } from '../../providers/AuthProvider';

export default function TabsLayout() {
  const { profile } = useAuth();

  // Re-plan today's meal reminder whenever the app opens.
  useEffect(() => {
    refreshMealRemindersFromDb(profile);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refreshMealRemindersFromDb(profile);
    });
    return () => sub.remove();
  }, [profile]);

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
        headerShadowVisible: false,
        sceneStyle: { backgroundColor: colors.bg },
        tabBarStyle: { backgroundColor: colors.card, borderTopColor: colors.border },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.muted,
        tabBarIconStyle: { display: 'none' },
        tabBarLabelStyle: { fontSize: 14, fontWeight: '700' },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Coach' }} />
      <Tabs.Screen name="plan" options={{ title: 'Plan' }} />
      <Tabs.Screen name="eat" options={{ title: 'Eat' }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile' }} />
    </Tabs>
  );
}
