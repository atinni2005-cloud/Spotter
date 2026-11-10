import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Button, Card, Screen } from '../components/ui';
import { supabase } from '../lib/supabase';
import { colors, space } from '../lib/theme';
import type { FormCheck } from '../lib/types';

const STATUS: Record<FormCheck['status'], string> = {
  uploaded: 'Waiting…',
  processing: 'Reviewing…',
  done: '',
  failed: 'Failed',
};

export default function FormChecks() {
  const [checks, setChecks] = useState<FormCheck[] | null>(null);

  useFocusEffect(
    useCallback(() => {
      supabase
        .from('form_checks')
        .select('id, exercise_name, status, feedback, created_at')
        .order('created_at', { ascending: false })
        .limit(50)
        .then(({ data }) => setChecks((data as FormCheck[]) ?? []));
    }, []),
  );

  return (
    <Screen scroll edges={['bottom']}>
      <Button title="🎥  New form check" onPress={() => router.push('/form-check/new')} />
      {checks?.length === 0 ? (
        <Text style={styles.muted}>
          No form checks yet. During a workout, tap "Check form" on an exercise and film your first set.
        </Text>
      ) : null}
      {(checks ?? []).map((c) => (
        <Pressable key={c.id} onPress={() => router.push({ pathname: '/form-check/[id]', params: { id: c.id } })}>
          <Card style={{ gap: 2 }}>
            <View style={styles.row}>
              <Text style={styles.name} numberOfLines={1}>
                {c.exercise_name}
              </Text>
              <Text style={styles.muted}>{new Date(c.created_at).toLocaleDateString()}</Text>
            </View>
            <Text style={styles.muted} numberOfLines={2}>
              {STATUS[c.status] || c.feedback?.headline || ''}
            </Text>
          </Card>
        </Pressable>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: space.md },
  name: { color: colors.text, fontSize: 17, fontWeight: '700', flex: 1 },
  muted: { color: colors.muted, fontSize: 14, lineHeight: 20 },
});
