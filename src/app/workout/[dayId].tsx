import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Button, Card, ErrorText, Input, Screen } from '../../components/ui';
import { startOfTodayIso } from '../../lib/nutrition';
import { supabase } from '../../lib/supabase';
import { colors, radius, space } from '../../lib/theme';
import { exerciseVideoUrl, type PlanDay, type PlanExercise, type SetLog } from '../../lib/types';
import { describeSets, lightenedSets, overloadAdvice } from '../../lib/workout';
import { useAuth } from '../../providers/AuthProvider';

type Draft = { weight: string; reps: string };

export default function Workout() {
  const { dayId } = useLocalSearchParams<{ dayId: string }>();
  const { profile } = useAuth();
  const units = profile?.units ?? 'kg';
  const restThreshold = profile?.rest_threshold ?? 30;

  const [day, setDay] = useState<PlanDay | null>(null);
  const [energy, setEnergy] = useState<{ id: string; score: number } | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [logged, setLogged] = useState<SetLog[]>([]);
  const [previous, setPrevious] = useState<Record<string, SetLog[]>>({});
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [extraSets, setExtraSets] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const since = new Date(Date.now() - 18 * 60 * 60 * 1000).toISOString();
    const [dayRes, energyRes, sessionRes] = await Promise.all([
      supabase
        .from('plan_days')
        .select('id, plan_id, day_index, title, focus, is_rest, notes, plan_exercises(id, day_id, position, name, equipment, sets, reps, rest_seconds, target_rpe, notes)')
        .eq('id', dayId)
        .single(),
      supabase
        .from('energy_checkins')
        .select('id, score')
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('workout_sessions')
        .select('id')
        .eq('plan_day_id', dayId)
        .is('finished_at', null)
        .gte('started_at', startOfTodayIso())
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    if (dayRes.error) return setError(dayRes.error.message);
    const d = dayRes.data as PlanDay;
    setDay(d);
    setEnergy(energyRes.data ?? null);
    const sid = sessionRes.data?.id ?? null;
    setSessionId(sid);

    const names = d.plan_exercises.map((e) => e.name);
    const [currentRes, historyRes] = await Promise.all([
      sid
        ? supabase.from('set_logs').select('*').eq('session_id', sid).order('set_number')
        : Promise.resolve({ data: [] as SetLog[] }),
      names.length
        ? supabase
            .from('set_logs')
            .select('*')
            .in('exercise_name', names)
            .order('created_at', { ascending: false })
            .limit(300)
        : Promise.resolve({ data: [] as SetLog[] }),
    ]);
    setLogged((currentRes.data as SetLog[]) ?? []);

    // For each exercise keep only the sets from its most recent earlier session.
    const prev: Record<string, SetLog[]> = {};
    for (const s of (historyRes.data as SetLog[]) ?? []) {
      if (s.session_id === sid) continue;
      const list = prev[s.exercise_name];
      if (!list) prev[s.exercise_name] = [s];
      else if (list[0].session_id === s.session_id) list.push(s);
    }
    for (const k of Object.keys(prev)) prev[k].sort((a, b) => a.set_number - b.set_number);
    setPrevious(prev);
  }, [dayId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function ensureSession(): Promise<string> {
    if (sessionId) return sessionId;
    const { data, error: err } = await supabase
      .from('workout_sessions')
      .insert({
        plan_day_id: dayId,
        energy_checkin_id: energy?.id ?? null,
        adjusted: energy !== null && energy.score < 50,
      })
      .select('id')
      .single();
    if (err || !data) throw new Error(err?.message ?? 'Could not start the workout');
    setSessionId(data.id);
    return data.id;
  }

  async function logSet(ex: PlanExercise, setNumber: number, draft: Draft) {
    const reps = Number(draft.reps);
    const weight = draft.weight.trim() ? Number(draft.weight.replace(',', '.')) : null;
    if (!Number.isFinite(reps) || reps <= 0) return setError('Enter how many reps you did.');
    if (weight !== null && !Number.isFinite(weight)) return setError('Weight must be a number.');
    setError(null);
    setBusy(`${ex.id}:${setNumber}`);
    try {
      const sid = await ensureSession();
      const { data, error: err } = await supabase
        .from('set_logs')
        .insert({ session_id: sid, exercise_id: ex.id, exercise_name: ex.name, set_number: setNumber, reps, weight })
        .select('*')
        .single();
      if (err) throw new Error(err.message);
      setLogged((l) => [...l, data as SetLog]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the set');
    } finally {
      setBusy(null);
    }
  }

  async function undoSet(set: SetLog) {
    await supabase.from('set_logs').delete().eq('id', set.id);
    setLogged((l) => l.filter((s) => s.id !== set.id));
  }

  async function finish() {
    if (sessionId) {
      await supabase.from('workout_sessions').update({ finished_at: new Date().toISOString() }).eq('id', sessionId);
    }
    router.back();
  }

  function confirmFinish() {
    if (!logged.length) return router.back();
    Alert.alert('Finish workout?', `${logged.length} sets logged.`, [
      { text: 'Keep going', style: 'cancel' },
      { text: 'Finish', onPress: finish },
    ]);
  }

  if (!day) {
    return (
      <Screen edges={['bottom']}>
        <ErrorText>{error}</ErrorText>
      </Screen>
    );
  }

  const exercises = [...day.plan_exercises].sort((a, b) => a.position - b.position);
  const score = energy?.score ?? null;

  return (
    <Screen scroll edges={['bottom']}>
      <Stack.Screen options={{ title: day.title }} />

      {score !== null && score < restThreshold ? (
        <Card style={{ borderColor: colors.warn }}>
          <Text style={styles.bannerTitle}>Energy {score}%: rest is the smart call</Text>
          <Text style={styles.muted}>
            You're below your rest threshold. A walk or some stretching will help more today. If you train, keep it light.
          </Text>
        </Card>
      ) : score !== null && score < 50 ? (
        <Card style={{ borderColor: colors.warn }}>
          <Text style={styles.bannerTitle}>Lightened for low energy ({score}%)</Text>
          <Text style={styles.muted}>Fewer sets today. Stop 2 to 3 reps before failure.</Text>
        </Card>
      ) : score === null ? (
        <Pressable onPress={() => router.push('/check-in')}>
          <Card>
            <Text style={styles.muted}>
              <Text style={{ color: colors.accent, fontWeight: '700' }}>Check in first</Text> so Spotter can adjust today's sets
              to your energy.
            </Text>
          </Card>
        </Pressable>
      ) : null}

      <ErrorText>{error}</ErrorText>

      {exercises.map((ex) => {
        const target = lightenedSets(ex.sets, score) + (extraSets[ex.id] ?? 0);
        const done = logged.filter((s) => s.exercise_id === ex.id || (!s.exercise_id && s.exercise_name === ex.name));
        const last = previous[ex.name] ?? [];
        const advice = overloadAdvice(last, ex.reps, units);
        const rows = Math.max(target, done.length);
        const firstSet = [...done].sort((a, b) => a.set_number - b.set_number)[0];
        return (
          <Card key={ex.id} style={{ gap: space.sm }}>
            <View style={styles.headerRow}>
              <Text style={styles.exName}>{ex.name}</Text>
              <Pressable hitSlop={8} onPress={() => Linking.openURL(exerciseVideoUrl(ex.name))}>
                <Text style={styles.link}>▶ Watch</Text>
              </Pressable>
            </View>
            <Text style={styles.muted}>
              {target} × {ex.reps}
              {ex.rest_seconds ? ` · rest ${ex.rest_seconds}s` : ''}
              {ex.target_rpe ? ` · RPE ${Number(ex.target_rpe)}` : ''}
            </Text>
            {last.length ? <Text style={styles.muted}>Last time: {describeSets(last, units)}</Text> : null}
            {advice ? <Text style={styles.advice}>{advice.text}</Text> : null}

            {Array.from({ length: rows }, (_, i) => i + 1).map((n) => {
              const doneSet = done.find((s) => s.set_number === n);
              if (doneSet) {
                return (
                  <View key={n} style={[styles.setRow, styles.setDone]}>
                    <Text style={styles.setNum}>{n}</Text>
                    <Text style={styles.setText}>
                      {doneSet.weight ? `${Number(doneSet.weight)} ${units} × ` : ''}
                      {doneSet.reps} reps ✓
                    </Text>
                    <Pressable hitSlop={8} onPress={() => undoSet(doneSet)}>
                      <Text style={styles.undo}>Undo</Text>
                    </Pressable>
                  </View>
                );
              }
              const key = `${ex.id}:${n}`;
              const prevSameSet = done[done.length - 1];
              const draft = drafts[key] ?? {
                weight: prevSameSet?.weight
                  ? String(Number(prevSameSet.weight))
                  : advice?.suggestedWeight
                    ? String(advice.suggestedWeight)
                    : '',
                reps: '',
              };
              const update = (patch: Partial<Draft>) => setDrafts((d) => ({ ...d, [key]: { ...draft, ...patch } }));
              return (
                <View key={n} style={styles.setRow}>
                  <Text style={styles.setNum}>{n}</Text>
                  <Input
                    value={draft.weight}
                    onChangeText={(v) => update({ weight: v })}
                    placeholder={units}
                    keyboardType="decimal-pad"
                    style={styles.setInput}
                  />
                  <Text style={styles.muted}>×</Text>
                  <Input
                    value={draft.reps}
                    onChangeText={(v) => update({ reps: v })}
                    placeholder="reps"
                    keyboardType="number-pad"
                    style={styles.setInput}
                  />
                  <Button
                    title="✓"
                    onPress={() => logSet(ex, n, draft)}
                    loading={busy === key}
                    style={styles.logButton}
                  />
                </View>
              );
            })}

            <View style={styles.headerRow}>
              <Pressable hitSlop={8} onPress={() => setExtraSets((x) => ({ ...x, [ex.id]: (x[ex.id] ?? 0) + 1 }))}>
                <Text style={styles.link}>+ Add set</Text>
              </Pressable>
              <Pressable
                hitSlop={8}
                onPress={() =>
                  router.push({
                    pathname: '/form-check/new',
                    params: { exercise: ex.name, setLogId: firstSet?.id ?? '' },
                  })
                }
              >
                <Text style={styles.link}>🎥 Check form</Text>
              </Pressable>
            </View>
          </Card>
        );
      })}

      <Button title="Finish workout" onPress={confirmFinish} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.md },
  bannerTitle: { color: colors.text, fontSize: 16, fontWeight: '800', marginBottom: space.xs },
  exName: { color: colors.text, fontSize: 18, fontWeight: '800', flex: 1 },
  muted: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  advice: { color: colors.accent, fontSize: 14, lineHeight: 20 },
  link: { color: colors.accent, fontSize: 14, fontWeight: '700' },
  setRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  setDone: { backgroundColor: colors.cardAlt, borderRadius: radius.md, padding: space.md },
  setNum: { color: colors.muted, fontSize: 15, fontWeight: '800', width: 18 },
  setText: { color: colors.text, fontSize: 15, flex: 1 },
  setInput: { flex: 1, paddingVertical: space.sm },
  logButton: { minHeight: 44, paddingHorizontal: space.lg },
  undo: { color: colors.muted, fontSize: 13 },
});
