import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { Button, Card, ErrorText, Input, Label, Screen } from '../../components/ui';
import { supabase } from '../../lib/supabase';
import { colors, space } from '../../lib/theme';
import { DAY_NAMES, type PlanDay } from '../../lib/types';

type DraftExercise = {
  key: string;
  id?: string;
  name: string;
  equipment: string;
  sets: string;
  reps: string;
  rest_seconds: string;
  notes: string;
};

let tempKey = 0;
const newKey = () => `new-${tempKey++}`;

export default function EditDay() {
  const { dayId } = useLocalSearchParams<{ dayId: string }>();
  const [day, setDay] = useState<PlanDay | null>(null);
  const [title, setTitle] = useState('');
  const [isRest, setIsRest] = useState(false);
  const [notes, setNotes] = useState('');
  const [exercises, setExercises] = useState<DraftExercise[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from('plan_days')
      .select('id, plan_id, day_index, title, focus, is_rest, notes, plan_exercises(*)')
      .eq('id', dayId)
      .single()
      .then(({ data, error: err }) => {
        if (err || !data) {
          setError(err?.message ?? 'Day not found');
          return;
        }
        const d = data as PlanDay;
        setDay(d);
        setTitle(d.title);
        setIsRest(d.is_rest);
        setNotes(d.notes ?? '');
        setExercises(
          [...d.plan_exercises]
            .sort((a, b) => a.position - b.position)
            .map((e) => ({
              key: e.id,
              id: e.id,
              name: e.name,
              equipment: e.equipment ?? '',
              sets: String(e.sets),
              reps: e.reps,
              rest_seconds: e.rest_seconds == null ? '' : String(e.rest_seconds),
              notes: e.notes ?? '',
            })),
        );
      });
  }, [dayId]);

  function update(key: string, patch: Partial<DraftExercise>) {
    setExercises((list) => list.map((e) => (e.key === key ? { ...e, ...patch } : e)));
  }

  function move(index: number, delta: number) {
    setExercises((list) => {
      const next = [...list];
      const target = index + delta;
      if (target < 0 || target >= next.length) return list;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function add() {
    setExercises((list) => [
      ...list,
      { key: newKey(), name: '', equipment: '', sets: '3', reps: '8-12', rest_seconds: '90', notes: '' },
    ]);
  }

  async function save() {
    if (!day) return;
    setSaving(true);
    setError(null);
    try {
      const kept = isRest ? [] : exercises.filter((e) => e.name.trim());
      const { error: dayErr } = await supabase
        .from('plan_days')
        .update({ title: title.trim() || (isRest ? 'Rest' : 'Workout'), is_rest: isRest, notes: notes.trim() || null })
        .eq('id', day.id);
      if (dayErr) throw dayErr;

      const keptIds = new Set(kept.filter((e) => e.id).map((e) => e.id));
      const removed = day.plan_exercises.filter((e) => !keptIds.has(e.id)).map((e) => e.id);
      if (removed.length) {
        const { error: delErr } = await supabase.from('plan_exercises').delete().in('id', removed);
        if (delErr) throw delErr;
      }

      const rows = kept.map((e, position) => ({
        ...(e.id ? { id: e.id } : {}),
        day_id: day.id,
        position,
        name: e.name.trim(),
        equipment: e.equipment.trim() || null,
        sets: Math.min(20, Math.max(1, parseInt(e.sets, 10) || 3)),
        reps: e.reps.trim() || '8-12',
        rest_seconds: e.rest_seconds.trim() ? Math.min(900, Math.max(0, parseInt(e.rest_seconds, 10) || 0)) : null,
        notes: e.notes.trim() || null,
      }));
      const existing = rows.filter((r) => 'id' in r);
      const added = rows.filter((r) => !('id' in r));
      if (existing.length) {
        const { error: upErr } = await supabase.from('plan_exercises').upsert(existing);
        if (upErr) throw upErr;
      }
      if (added.length) {
        const { error: insErr } = await supabase.from('plan_exercises').insert(added);
        if (insErr) throw insErr;
      }
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  }

  if (!day) {
    return (
      <Screen edges={['bottom']}>
        {error ? <ErrorText>{error}</ErrorText> : <ActivityIndicator color={colors.accent} />}
      </Screen>
    );
  }

  return (
    <Screen scroll edges={['bottom']}>
      <Stack.Screen options={{ title: DAY_NAMES[day.day_index] }} />

      <Label>Day name</Label>
      <Input value={title} onChangeText={setTitle} placeholder="e.g. Push day" />

      <View style={styles.restRow}>
        <Text style={styles.restText}>Rest day</Text>
        <Switch
          value={isRest}
          onValueChange={setIsRest}
          trackColor={{ true: colors.accent, false: colors.border }}
          thumbColor={colors.text}
        />
      </View>

      <Label>Notes</Label>
      <Input value={notes} onChangeText={setNotes} placeholder="Optional" multiline />

      {!isRest && (
        <>
          <View style={{ height: space.sm }} />
          <Label>Exercises</Label>
          {exercises.map((e, i) => (
            <Card key={e.key} style={{ gap: space.sm }}>
              <Input value={e.name} onChangeText={(name) => update(e.key, { name })} placeholder="Exercise name" />
              <View style={styles.fieldRow}>
                <Field label="Sets" value={e.sets} onChange={(sets) => update(e.key, { sets })} numeric />
                <Field label="Reps" value={e.reps} onChange={(reps) => update(e.key, { reps })} />
                <Field
                  label="Rest (s)"
                  value={e.rest_seconds}
                  onChange={(rest_seconds) => update(e.key, { rest_seconds })}
                  numeric
                />
              </View>
              <Input
                value={e.equipment}
                onChangeText={(equipment) => update(e.key, { equipment })}
                placeholder="Machine / equipment (optional)"
              />
              <Input value={e.notes} onChangeText={(n) => update(e.key, { notes: n })} placeholder="Cue or note (optional)" />
              <View style={styles.actions}>
                <SmallAction label="↑ Up" onPress={() => move(i, -1)} disabled={i === 0} />
                <SmallAction label="↓ Down" onPress={() => move(i, 1)} disabled={i === exercises.length - 1} />
                <View style={{ flex: 1 }} />
                <SmallAction
                  label="Remove"
                  danger
                  onPress={() => setExercises((list) => list.filter((x) => x.key !== e.key))}
                />
              </View>
            </Card>
          ))}
          <Button title="+ Add exercise" variant="secondary" onPress={add} />
        </>
      )}

      <ErrorText>{error}</ErrorText>
      <Button title="Save changes" onPress={save} loading={saving} style={{ marginTop: space.md }} />
    </Screen>
  );
}

function Field({
  label,
  value,
  onChange,
  numeric,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  numeric?: boolean;
}) {
  return (
    <View style={{ flex: 1, gap: 4 }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Input value={value} onChangeText={onChange} keyboardType={numeric ? 'number-pad' : 'default'} />
    </View>
  );
}

function SmallAction({
  label,
  onPress,
  disabled,
  danger,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={{ padding: space.xs, opacity: disabled ? 0.3 : 1 }}>
      <Text style={{ color: danger ? colors.danger : colors.muted, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  restRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: space.sm,
  },
  restText: { color: colors.text, fontSize: 16, fontWeight: '600' },
  fieldRow: { flexDirection: 'row', gap: space.sm },
  fieldLabel: { color: colors.muted, fontSize: 12 },
  actions: { flexDirection: 'row', gap: space.md, alignItems: 'center' },
});
