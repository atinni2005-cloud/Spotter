import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button, Chip, Choice, ErrorText, Input, Label, Screen, Subtitle, Title } from '../components/ui';
import { supabase } from '../lib/supabase';
import { colors, space } from '../lib/theme';
import { DAY_SHORT, EXPERIENCE, type Experience, type Goal, GOALS, SPLITS, type TrainingSplit } from '../lib/types';
import { useAuth } from '../providers/AuthProvider';

const SESSION_LENGTHS = [30, 45, 60, 75, 90];
const STEPS = 5;

export default function Onboarding() {
  const { session, profile, refreshProfile } = useAuth();
  const [step, setStep] = useState(0);
  const [goal, setGoal] = useState<Goal | null>(profile?.goal ?? null);
  const [experience, setExperience] = useState<Experience | null>(profile?.experience ?? null);
  const [days, setDays] = useState<number[]>(profile?.training_days?.length ? profile.training_days : [0, 2, 4]);
  const [minutes, setMinutes] = useState<number>(profile?.session_minutes ?? 60);
  const [split, setSplit] = useState<TrainingSplit>(profile?.training_split ?? 'auto');
  const [splitNotes, setSplitNotes] = useState(profile?.split_notes ?? '');
  const [name, setName] = useState(profile?.display_name ?? '');
  const [injuries, setInjuries] = useState(profile?.injuries ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canContinue =
    (step === 0 && goal) ||
    (step === 1 && experience) ||
    (step === 2 && days.length > 0) ||
    (step === 3 && (split !== 'custom' || splitNotes.trim().length > 0)) ||
    step === 4;

  function toggleDay(i: number) {
    setDays((d) => (d.includes(i) ? d.filter((x) => x !== i) : [...d, i].sort()));
  }

  async function finish() {
    if (!session) return;
    setSaving(true);
    setError(null);
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC';
    const { error: err } = await supabase
      .from('profiles')
      .update({
        display_name: name.trim() || null,
        goal,
        experience,
        training_days: days,
        days_per_week: days.length,
        session_minutes: minutes,
        training_split: split,
        split_notes: split === 'custom' ? splitNotes.trim() : null,
        injuries: injuries.trim() || null,
        timezone,
        onboarded_at: new Date().toISOString(),
      })
      .eq('id', session.user.id);
    if (err) {
      setError(err.message);
      setSaving(false);
      return;
    }
    await refreshProfile();
  }

  return (
    <Screen scroll>
      <View style={styles.progress}>
        {Array.from({ length: STEPS }).map((_, i) => (
          <View key={i} style={[styles.bar, i <= step && { backgroundColor: colors.accent }]} />
        ))}
      </View>

      {step === 0 && (
        <>
          <Title>What's your main goal?</Title>
          <Subtitle>Your coach builds your training around this. You can change it later.</Subtitle>
          {GOALS.map((g) => (
            <Choice key={g.value} label={g.label} blurb={g.blurb} selected={goal === g.value} onPress={() => setGoal(g.value)} />
          ))}
        </>
      )}

      {step === 1 && (
        <>
          <Title>How long have you been lifting?</Title>
          <Subtitle>This sets how much volume and complexity your plan has.</Subtitle>
          {EXPERIENCE.map((e) => (
            <Choice
              key={e.value}
              label={e.label}
              blurb={e.blurb}
              selected={experience === e.value}
              onPress={() => setExperience(e.value)}
            />
          ))}
        </>
      )}

      {step === 2 && (
        <>
          <Title>When do you train?</Title>
          <Subtitle>Pick the days you can usually get to the gym.</Subtitle>
          <View style={styles.row}>
            {DAY_SHORT.map((d, i) => (
              <Chip key={d} label={d} selected={days.includes(i)} onPress={() => toggleDay(i)} />
            ))}
          </View>
          <Text style={styles.hint}>{days.length} days a week</Text>
          <View style={{ height: space.lg }} />
          <Label>Session length</Label>
          <View style={styles.row}>
            {SESSION_LENGTHS.map((m) => (
              <Chip key={m} label={`${m} min`} selected={minutes === m} onPress={() => setMinutes(m)} />
            ))}
          </View>
        </>
      )}

      {step === 3 && (
        <>
          <Title>What split do you run?</Title>
          <Subtitle>Your plans will follow this. Not sure? Let your coach choose.</Subtitle>
          {SPLITS.map((sp) => (
            <Choice
              key={sp.value}
              label={sp.label}
              blurb={sp.blurb}
              selected={split === sp.value}
              onPress={() => setSplit(sp.value)}
            />
          ))}
          {split === 'custom' && (
            <Input
              placeholder="e.g. Chest/Back, Legs, Shoulders/Arms, repeat"
              value={splitNotes}
              onChangeText={setSplitNotes}
              multiline
              autoFocus
            />
          )}
        </>
      )}

      {step === 4 && (
        <>
          <Title>Almost done</Title>
          <Subtitle>A couple of details so your coach can look after you.</Subtitle>
          <Label>What should your coach call you?</Label>
          <Input placeholder="First name" value={name} onChangeText={setName} autoCapitalize="words" />
          <View style={{ height: space.sm }} />
          <Label>Any injuries or movements to avoid? (optional)</Label>
          <Input
            placeholder="e.g. sore left shoulder, no overhead pressing"
            value={injuries}
            onChangeText={setInjuries}
            multiline
            style={{ minHeight: 90, textAlignVertical: 'top' }}
          />
        </>
      )}

      <ErrorText>{error}</ErrorText>

      <View style={styles.footer}>
        {step > 0 && <Button title="Back" variant="secondary" onPress={() => setStep(step - 1)} style={{ flex: 1 }} />}
        <Button
          title={step === STEPS - 1 ? 'Start training' : 'Continue'}
          onPress={() => (step === STEPS - 1 ? finish() : setStep(step + 1))}
          disabled={!canContinue}
          loading={saving}
          style={{ flex: 2 }}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  progress: { flexDirection: 'row', gap: space.xs, marginBottom: space.xl },
  bar: { flex: 1, height: 4, borderRadius: 2, backgroundColor: colors.border },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  hint: { color: colors.muted, marginTop: space.xs },
  footer: { flexDirection: 'row', gap: space.md, marginTop: space.xl },
});
