import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { isConfigured } from '../lib/supabase';
import { colors } from '../lib/theme';
import { AuthProvider, useAuth } from '../providers/AuthProvider';

function RootNavigator() {
  const { session, profile, loading } = useAuth();

  if (loading || (session && !profile)) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  const signedIn = Boolean(session);
  const onboarded = Boolean(profile?.onboarded_at);

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="sign-in" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Protected guard={signedIn && !onboarded}>
        <Stack.Screen name="onboarding" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Protected guard={signedIn && onboarded}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="check-in" options={{ presentation: 'modal', title: 'Energy check-in' }} />
        <Stack.Screen name="plan/[dayId]" options={{ title: 'Edit day' }} />
      </Stack.Protected>
    </Stack>
  );
}

function MissingConfig() {
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, padding: 24, justifyContent: 'center' }}>
      <Text style={{ color: colors.text, fontSize: 22, fontWeight: '800', marginBottom: 8 }}>Almost there</Text>
      <Text style={{ color: colors.muted, fontSize: 15, lineHeight: 22 }}>
        Add EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY to a .env.local file in the project folder,
        then restart Expo. See the README for details.
      </Text>
    </View>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      {isConfigured ? (
        <AuthProvider>
          <RootNavigator />
        </AuthProvider>
      ) : (
        <MissingConfig />
      )}
    </SafeAreaProvider>
  );
}
