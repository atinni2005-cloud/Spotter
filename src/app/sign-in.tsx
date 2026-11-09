import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Button, ErrorText, Input, Screen, Subtitle, Title } from '../components/ui';
import { supabase } from '../lib/supabase';
import { colors, space } from '../lib/theme';

export default function SignIn() {
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-up');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit() {
    setError(null);
    setNotice(null);
    if (!email.trim() || password.length < 6) {
      setError('Enter your email and a password of at least 6 characters.');
      return;
    }
    setLoading(true);
    try {
      if (mode === 'sign-up') {
        const { data, error: err } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { display_name: name.trim() || null } },
        });
        if (err) throw err;
        if (!data.session) {
          setNotice('Check your email to confirm your account, then sign in.');
          setMode('sign-in');
        }
      } else {
        const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (err) throw err;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.wrap}>
        <View style={styles.brand}>
          <Text style={styles.logo}>SPOTTER</Text>
          <Text style={styles.tagline}>Your AI coach for the gym</Text>
        </View>

        <Title>{mode === 'sign-up' ? 'Create your account' : 'Welcome back'}</Title>
        <Subtitle>
          {mode === 'sign-up'
            ? 'Tell us a bit about you and get a plan built around your goal.'
            : 'Sign in to pick up where you left off.'}
        </Subtitle>

        <View style={{ gap: space.md }}>
          {mode === 'sign-up' && (
            <Input placeholder="First name" value={name} onChangeText={setName} autoCapitalize="words" />
          )}
          <Input
            placeholder="Email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
          />
          <Input
            placeholder="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'}
          />
          <ErrorText>{error}</ErrorText>
          {notice ? <Text style={styles.notice}>{notice}</Text> : null}
          <Button title={mode === 'sign-up' ? 'Create account' : 'Sign in'} onPress={submit} loading={loading} />
          <Pressable
            onPress={() => {
              setMode(mode === 'sign-up' ? 'sign-in' : 'sign-up');
              setError(null);
            }}
            style={{ padding: space.sm, alignItems: 'center' }}
          >
            <Text style={styles.switch}>
              {mode === 'sign-up' ? 'Already have an account? Sign in' : 'New here? Create an account'}
            </Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, justifyContent: 'center' },
  brand: { marginBottom: space.xxl },
  logo: { color: colors.accent, fontSize: 34, fontWeight: '900', letterSpacing: 4 },
  tagline: { color: colors.muted, fontSize: 15, marginTop: 4 },
  notice: { color: colors.accent, fontSize: 14 },
  switch: { color: colors.muted, fontSize: 15 },
});
