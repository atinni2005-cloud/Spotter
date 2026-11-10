import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Button, Card, ErrorText, Screen } from '../../components/ui';
import { supabase } from '../../lib/supabase';
import { colors, space } from '../../lib/theme';
import type { FormCheck } from '../../lib/types';

const VERDICT: Record<string, { label: string; color: string }> = {
  good: { label: 'Good form', color: colors.accent },
  minor_fixes: { label: 'Good, with small fixes', color: colors.accent },
  needs_work: { label: 'Needs work', color: colors.warn },
  unclear: { label: "Couldn't see clearly", color: colors.muted },
};

export default function FormCheckResult() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [check, setCheck] = useState<FormCheck | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error: err } = await supabase
      .from('form_checks')
      .select('id, exercise_name, status, feedback, created_at')
      .eq('id', id)
      .single();
    if (err) setError(err.message);
    else setCheck(data as FormCheck);
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // While the coach is reviewing, check again every few seconds.
  const pending = !check || check.status === 'processing' || check.status === 'uploaded';
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(load, 4000);
    return () => clearInterval(timer);
  }, [pending, load]);

  if (!check) {
    return (
      <Screen edges={['bottom']}>
        <ErrorText>{error}</ErrorText>
      </Screen>
    );
  }

  const fb = check.feedback;
  const verdict = fb?.verdict ? VERDICT[fb.verdict] : null;

  return (
    <Screen scroll edges={['bottom']}>
      <Text style={styles.title}>{check.exercise_name}</Text>
      <Text style={styles.muted}>{new Date(check.created_at).toLocaleString()}</Text>

      {pending ? (
        <Card style={{ alignItems: 'center', gap: space.md, paddingVertical: space.xl }}>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.text}>Your coach is reviewing your set.</Text>
          <Text style={[styles.muted, { textAlign: 'center' }]}>
            This takes about a minute. You can go back to your workout and find it later under Plan → Form checks.
          </Text>
          <Button title="Back to workout" variant="secondary" onPress={() => router.back()} />
        </Card>
      ) : check.status === 'failed' ? (
        <Card style={{ gap: space.md }}>
          <Text style={styles.text}>{fb?.error ?? "The coach couldn't review this video."}</Text>
          <Button
            title="Try again"
            onPress={() => router.replace({ pathname: '/form-check/new', params: { exercise: check.exercise_name } })}
          />
        </Card>
      ) : fb ? (
        <>
          <Card style={{ gap: space.xs, borderColor: verdict?.color ?? colors.border }}>
            <Text style={[styles.verdict, { color: verdict?.color ?? colors.text }]}>{verdict?.label}</Text>
            <Text style={styles.text}>{fb.headline}</Text>
            {fb.rep_count ? <Text style={styles.muted}>{fb.rep_count} reps counted</Text> : null}
          </Card>

          {fb.safety ? (
            <Card style={{ borderColor: colors.danger }}>
              <Text style={[styles.section, { color: colors.danger }]}>Safety</Text>
              <Text style={styles.text}>{fb.safety}</Text>
            </Card>
          ) : null}

          {fb.fixes?.length ? (
            <Card style={{ gap: space.md }}>
              <Text style={styles.section}>Fix next set</Text>
              {fb.fixes.map((f, i) => (
                <View key={i} style={{ gap: 2 }}>
                  <Text style={styles.fixIssue}>
                    {i + 1}. {f.issue}
                  </Text>
                  <Text style={styles.muted}>{f.why}</Text>
                  <Text style={styles.cue}>Cue: "{f.cue}"</Text>
                </View>
              ))}
            </Card>
          ) : null}

          {fb.went_well?.length ? (
            <Card style={{ gap: space.xs }}>
              <Text style={styles.section}>What went well</Text>
              {fb.went_well.map((w, i) => (
                <Text key={i} style={styles.text}>
                  • {w}
                </Text>
              ))}
            </Card>
          ) : null}

          {fb.next_set ? (
            <Card style={{ gap: space.xs }}>
              <Text style={styles.section}>Your next sets</Text>
              <Text style={styles.text}>{fb.next_set}</Text>
            </Card>
          ) : null}

          {fb.camera_tip ? <Text style={styles.muted}>🎥 Filming tip: {fb.camera_tip}</Text> : null}
          <Text style={styles.disclaimer}>
            AI feedback from still frames of your video. It can miss things, so if something hurts, stop and see a
            professional.
          </Text>
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { color: colors.text, fontSize: 26, fontWeight: '800' },
  muted: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  text: { color: colors.text, fontSize: 15, lineHeight: 22 },
  verdict: { fontSize: 20, fontWeight: '900' },
  section: { color: colors.text, fontSize: 17, fontWeight: '800', marginBottom: space.xs },
  fixIssue: { color: colors.text, fontSize: 15, fontWeight: '700' },
  cue: { color: colors.accent, fontSize: 15, fontWeight: '600' },
  disclaimer: { color: colors.muted, fontSize: 12, lineHeight: 17, marginTop: space.md },
});
