import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button, Card, Chip, ErrorText, Screen } from '../components/ui';
import { ENERGY_QUESTIONS, energyAdvice, energyScore } from '../lib/energy';
import { supabase } from '../lib/supabase';
import { colors, space } from '../lib/theme';
import { useAuth } from '../providers/AuthProvider';

export default function CheckIn() {
  const { profile } = useAuth();
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const complete = ENERGY_QUESTIONS.every((q) => answers[q.id] !== undefined);
  const score = energyScore(answers);
  const restThreshold = profile?.rest_threshold ?? 30;

  async function save() {
    setSaving(true);
    setError(null);
    const detail = Object.fromEntries(
      ENERGY_QUESTIONS.map((q) => [q.id, { answer: q.options[answers[q.id]].label, score: q.options[answers[q.id]].score }]),
    );
    const { error: err } = await supabase
      .from('energy_checkins')
      .insert({ score, source: 'questions', answers: detail });
    setSaving(false);
    if (err) {
      setError(err.message);
      return;
    }
    router.back();
  }

  return (
    <Screen scroll edges={['bottom']}>
      <Text style={styles.intro}>Five quick questions. Your coach uses this to lighten or adjust today's training.</Text>
      {ENERGY_QUESTIONS.map((q) => (
        <View key={q.id} style={{ gap: space.sm, marginBottom: space.md }}>
          <Text style={styles.question}>{q.question}</Text>
          <View style={styles.options}>
            {q.options.map((o, i) => (
              <Chip
                key={o.label}
                label={o.label}
                selected={answers[q.id] === i}
                onPress={() => setAnswers((a) => ({ ...a, [q.id]: i }))}
              />
            ))}
          </View>
        </View>
      ))}

      {complete && (
        <Card style={score < restThreshold ? { borderColor: colors.warn } : undefined}>
          <Text style={styles.score}>{score}%</Text>
          <Text style={styles.advice}>{energyAdvice(score, restThreshold)}</Text>
        </Card>
      )}
      <ErrorText>{error}</ErrorText>
      <Button title="Save check-in" onPress={save} disabled={!complete} loading={saving} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  intro: { color: colors.muted, fontSize: 15, lineHeight: 21, marginBottom: space.sm },
  question: { color: colors.text, fontSize: 17, fontWeight: '700' },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  score: { color: colors.text, fontSize: 40, fontWeight: '900' },
  advice: { color: colors.muted, fontSize: 15, lineHeight: 21 },
});
