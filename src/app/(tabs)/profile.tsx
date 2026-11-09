import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button, Chip, Choice, ErrorText, Input, Label, Screen } from '../../components/ui';
import { supabase } from '../../lib/supabase';
import { colors, space } from '../../lib/theme';
import { DAY_SHORT, EXPERIENCE, type Experience, type Goal, GOALS } from '../../lib/types';
import { useAuth } from '../../providers/AuthProvider';

const SESSION_LENGTHS = [30, 45, 60, 75, 90];
const REST_THRESHOLDS = [20, 30, 40, 50];

export default function ProfileScreen() {
  const { session, profile, refreshProfile, signOut } = useAuth();
  const [name, setName] = useState('');
  const [goal, setGoal] = useState<Goal | null>(null);
  const [experience, setExperience] = useState<Experience | null>(null);
  const [days, setDays] = useState<number[]>([]);
  const [minutes, setMinutes] = useState(60);
  const [injuries, setInjuries] = useState('');
  const [units, setUnits] = useState<'kg' | 'lb'>('kg');
  const [restThreshold, setRestThreshold] = useState(30);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!profile) return;
    setName(profile.display_name ?? '');
    setGoal(profile.goal);
    setExperience(profile.experience);
    setDays(profile.training_days ?? []);
    setMinutes(profile.session_minutes ?? 60);
    setInjuries(profile.injuries ?? '');
    setUnits(profile.units);
    setRestThreshold(profile.rest_threshold);
  }, [profile]);

  async function save() {
    if (!session) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    const { error: err } = await supabase
      .from('profiles')
      .update({
        display_name: name.trim() || null,
        goal,
        experience,
        training_days: days,
        days_per_week: days.length || null,
        session_minutes: minutes,
        injuries: injuries.trim() || null,
        units,
        rest_threshold: restThreshold,
      })
      .eq('id', session.user.id);
    setSaving(false);
    if (err) return setError(err.message);
    setSaved(true);
    await refreshProfile();
  }

  const toggleDay = (i: number) =>
    setDays((d) => (d.includes(i) ? d.filter((x) => x !== i) : [...d, i].sort()));

  return (
    <Screen scroll edges={[]}>
      <Text style={styles.email}>{session?.user.email}</Text>

      <Label>Name</Label>
      <Input value={name} onChangeText={setName} placeholder="First name" />

      <Label>Goal</Label>
      {GOALS.map((g) => (
        <Choice key={g.value} label={g.label} selected={goal === g.value} onPress={() => setGoal(g.value)} />
      ))}

      <Label>Experience</Label>
      <View style={styles.row}>
        {EXPERIENCE.map((e) => (
          <Chip key={e.value} label={e.label} selected={experience === e.value} onPress={() => setExperience(e.value)} />
        ))}
      </View>

      <Label>Training days</Label>
      <View style={styles.row}>
        {DAY_SHORT.map((d, i) => (
          <Chip key={d} label={d} selected={days.includes(i)} onPress={() => toggleDay(i)} />
        ))}
      </View>

      <Label>Session length</Label>
      <View style={styles.row}>
        {SESSION_LENGTHS.map((m) => (
          <Chip key={m} label={`${m} min`} selected={minutes === m} onPress={() => setMinutes(m)} />
        ))}
      </View>

      <Label>Injuries or limits</Label>
      <Input value={injuries} onChangeText={setInjuries} placeholder="None" multiline />

      <Label>Units</Label>
      <View style={styles.row}>
        <Chip label="kg" selected={units === 'kg'} onPress={() => setUnits('kg')} />
        <Chip label="lb" selected={units === 'lb'} onPress={() => setUnits('lb')} />
      </View>

      <Label>Suggest a rest day when energy is below</Label>
      <View style={styles.row}>
        {REST_THRESHOLDS.map((t) => (
          <Chip key={t} label={`${t}%`} selected={restThreshold === t} onPress={() => setRestThreshold(t)} />
        ))}
      </View>

      <ErrorText>{error}</ErrorText>
      {saved ? <Text style={styles.saved}>Saved. New plans will use these settings.</Text> : null}
      <Button title="Save" onPress={save} loading={saving} />
      <Button title="Sign out" variant="danger" onPress={signOut} style={{ marginTop: space.xl }} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  email: { color: colors.muted, fontSize: 14, marginBottom: space.sm },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  saved: { color: colors.accent },
});
