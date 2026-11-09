import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, Card, ErrorText } from '../../components/ui';
import { generatePlan } from '../../lib/api';
import { energyAdvice } from '../../lib/energy';
import { supabase } from '../../lib/supabase';
import { colors, space } from '../../lib/theme';
import { DAY_NAMES, type PlanDay, todayIndex, type WorkoutPlan } from '../../lib/types';
import { useAuth } from '../../providers/AuthProvider';

const PLAN_SELECT =
  'id, title, summary, week_start, energy_score, plan_days(id, plan_id, day_index, title, focus, is_rest, notes, plan_exercises(id, day_id, position, name, equipment, sets, reps, rest_seconds, target_rpe, notes))';

export default function Plan() {
  const { profile } = useAuth();
  const [plan, setPlan] = useState<WorkoutPlan | null>(null);
  const [energy, setEnergy] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const since = new Date(Date.now() - 18 * 60 * 60 * 1000).toISOString();
    const [planRes, energyRes] = await Promise.all([
      supabase.from('workout_plans').select(PLAN_SELECT).eq('status', 'active').maybeSingle(),
      supabase
        .from('energy_checkins')
        .select('score')
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    if (planRes.error) setError(planRes.error.message);
    setPlan((planRes.data as WorkoutPlan | null) ?? null);
    setEnergy(energyRes.data?.score ?? null);
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function buildPlan() {
    setGenerating(true);
    setError(null);
    try {
      await generatePlan();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create a plan');
    } finally {
      setGenerating(false);
    }
  }

  function confirmRegenerate() {
    Alert.alert('Build a new week?', 'This replaces your current plan, including any edits.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Build new week', onPress: buildPlan },
    ]);
  }

  const days = [...(plan?.plan_days ?? [])].sort((a, b) => a.day_index - b.day_index);
  const today = todayIndex();
  const restThreshold = profile?.rest_threshold ?? 30;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: space.xxl * 2 }}
      refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={colors.accent} />}
    >
      <Card style={energy !== null && energy < restThreshold ? { borderColor: colors.warn } : undefined}>
        <View style={styles.energyRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardLabel}>TODAY'S ENERGY</Text>
            <Text style={styles.energyValue}>{energy === null ? '—' : `${energy}%`}</Text>
          </View>
          <Button
            title={energy === null ? 'Check in' : 'Update'}
            variant={energy === null ? 'primary' : 'secondary'}
            onPress={() => router.push('/check-in')}
          />
        </View>
        <Text style={styles.muted}>
          {energy === null
            ? 'Answer 5 quick questions so your coach can adjust today.'
            : energyAdvice(energy, restThreshold)}
        </Text>
      </Card>

      <ErrorText>{error}</ErrorText>

      {loading ? null : !plan ? (
        <Card>
          <Text style={styles.planTitle}>No plan yet</Text>
          <Text style={[styles.muted, { marginBottom: space.lg }]}>
            Your coach will build a week around your goal, schedule and today's energy. Takes about 20 seconds.
          </Text>
          <Button title="Build my week" onPress={buildPlan} loading={generating} />
        </Card>
      ) : (
        <>
          <View>
            <Text style={styles.planTitle}>{plan.title}</Text>
            {plan.summary ? <Text style={styles.muted}>{plan.summary}</Text> : null}
          </View>
          {days.map((day) => (
            <DayCard key={day.id} day={day} isToday={day.day_index === today} />
          ))}
          <Button title="Build a new week" variant="secondary" onPress={confirmRegenerate} loading={generating} />
        </>
      )}
    </ScrollView>
  );
}

function DayCard({ day, isToday }: { day: PlanDay; isToday: boolean }) {
  const exercises = [...day.plan_exercises].sort((a, b) => a.position - b.position);
  return (
    <Pressable onPress={() => router.push({ pathname: '/plan/[dayId]', params: { dayId: day.id } })}>
      <Card style={isToday ? { borderColor: colors.accent } : undefined}>
        <View style={styles.dayHeader}>
          <Text style={styles.dayName}>
            {DAY_NAMES[day.day_index]}
            {isToday ? '  · Today' : ''}
          </Text>
          <Text style={styles.edit}>Edit</Text>
        </View>
        <Text style={styles.dayTitle}>{day.title}</Text>
        {day.is_rest ? (
          <Text style={styles.muted}>{day.notes || 'Rest and recover.'}</Text>
        ) : (
          exercises.map((e) => (
            <View key={e.id} style={styles.exerciseRow}>
              <Text style={styles.exerciseName} numberOfLines={1}>
                {e.name}
              </Text>
              <Text style={styles.exerciseSets}>
                {e.sets} × {e.reps}
              </Text>
            </View>
          ))
        )}
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  energyRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginBottom: space.sm },
  cardLabel: { color: colors.muted, fontSize: 12, fontWeight: '700', letterSpacing: 0.8 },
  energyValue: { color: colors.text, fontSize: 34, fontWeight: '900' },
  muted: { color: colors.muted, fontSize: 15, lineHeight: 21 },
  planTitle: { color: colors.text, fontSize: 22, fontWeight: '800', marginBottom: space.xs },
  dayHeader: { flexDirection: 'row', justifyContent: 'space-between' },
  dayName: { color: colors.accent, fontSize: 13, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase' },
  edit: { color: colors.muted, fontSize: 13 },
  dayTitle: { color: colors.text, fontSize: 18, fontWeight: '700', marginVertical: space.xs },
  exerciseRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    gap: space.md,
  },
  exerciseName: { color: colors.text, fontSize: 15, flex: 1 },
  exerciseSets: { color: colors.muted, fontSize: 15, fontVariant: ['tabular-nums'] },
});
