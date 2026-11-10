import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button, Card, Chip, ErrorText, Input, Label, Screen } from '../components/ui';
import { CM_PER_IN, formatTime, LB_PER_KG, REMINDER_TIMES, suggestTargets } from '../lib/nutrition';
import { ensureNotificationPermission, refreshMealRemindersFromDb } from '../lib/reminders';
import { supabase } from '../lib/supabase';
import { colors, space } from '../lib/theme';
import type { Profile } from '../lib/types';
import { useAuth } from '../providers/AuthProvider';

const num = (s: string) => {
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
};
const round1 = (n: number) => Math.round(n * 10) / 10;

export default function NutritionSettings() {
  const { session, profile, refreshProfile } = useAuth();
  const imperial = profile?.units === 'lb';

  const [sex, setSex] = useState<'male' | 'female' | null>(null);
  const [birthYear, setBirthYear] = useState('');
  const [height, setHeight] = useState('');
  const [weight, setWeight] = useState('');
  const [calories, setCalories] = useState('');
  const [protein, setProtein] = useState('');
  const [carbs, setCarbs] = useState('');
  const [fat, setFat] = useState('');
  const [reminder, setReminder] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!profile) return;
    setSex(profile.sex);
    setBirthYear(profile.birth_year ? String(profile.birth_year) : '');
    if (profile.height_cm) {
      setHeight(String(imperial ? Math.round(Number(profile.height_cm) / CM_PER_IN) : Number(profile.height_cm)));
    }
    if (profile.weight_kg) {
      setWeight(String(imperial ? Math.round(Number(profile.weight_kg) * LB_PER_KG) : Number(profile.weight_kg)));
    }
    setCalories(profile.calorie_target ? String(profile.calorie_target) : '');
    setProtein(profile.protein_target_g ? String(profile.protein_target_g) : '');
    setCarbs(profile.carbs_target_g ? String(profile.carbs_target_g) : '');
    setFat(profile.fat_target_g ? String(profile.fat_target_g) : '');
    setReminder(profile.meal_reminder_time?.slice(0, 5) ?? null);
  }, [profile, imperial]);

  const heightCm = num(height) ? round1(imperial ? num(height)! * CM_PER_IN : num(height)!) : null;
  const weightKg = num(weight) ? round1(imperial ? num(weight)! / LB_PER_KG : num(weight)!) : null;

  function workOut() {
    setError(null);
    const t = suggestTargets({
      sex,
      birth_year: num(birthYear),
      height_cm: heightCm,
      weight_kg: weightKg,
      goal: profile?.goal ?? null,
      days_per_week: profile?.days_per_week ?? null,
    } as Pick<Profile, 'sex' | 'birth_year' | 'height_cm' | 'weight_kg' | 'goal' | 'days_per_week'>);
    if (!t) return setError('Fill in sex, birth year, height and weight first.');
    setCalories(String(t.calories));
    setProtein(String(t.protein_g));
    setCarbs(String(t.carbs_g));
    setFat(String(t.fat_g));
  }

  async function save() {
    if (!session) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    const year = num(birthYear);
    const { error: err } = await supabase
      .from('profiles')
      .update({
        sex,
        birth_year: year ? Math.round(year) : null,
        height_cm: heightCm,
        weight_kg: weightKg,
        calorie_target: num(calories) ? Math.round(num(calories)!) : null,
        protein_target_g: num(protein) ? Math.round(num(protein)!) : null,
        carbs_target_g: num(carbs) ? Math.round(num(carbs)!) : null,
        fat_target_g: num(fat) ? Math.round(num(fat)!) : null,
        meal_reminder_time: reminder ? `${reminder}:00` : null,
      })
      .eq('id', session.user.id);
    if (err) {
      setSaving(false);
      return setError(err.message);
    }
    let blocked = false;
    if (reminder) {
      const allowed = await ensureNotificationPermission();
      if (!allowed) {
        blocked = true;
        setNotice('Notifications are turned off for Spotter. Turn them on in your phone Settings to get meal reminders.');
      }
    }
    await refreshProfile();
    const { data } = await supabase.from('profiles').select('*').eq('id', session.user.id).single();
    await refreshMealRemindersFromDb(data as Profile);
    setSaving(false);
    if (!blocked) router.back();
  }

  return (
    <Screen scroll edges={['bottom']}>
      <Text style={styles.intro}>
        Spotter uses these to set your daily calories and protein for your goal. You can change any number.
      </Text>

      <Label>Sex (for the calorie formula)</Label>
      <View style={styles.row}>
        <Chip label="Male" selected={sex === 'male'} onPress={() => setSex('male')} />
        <Chip label="Female" selected={sex === 'female'} onPress={() => setSex('female')} />
      </View>

      <Label>Birth year</Label>
      <Input value={birthYear} onChangeText={setBirthYear} keyboardType="number-pad" placeholder="e.g. 2000" maxLength={4} />

      <Label>Height ({imperial ? 'inches' : 'cm'})</Label>
      <Input
        value={height}
        onChangeText={setHeight}
        keyboardType="decimal-pad"
        placeholder={imperial ? 'e.g. 70 (5 ft 10)' : 'e.g. 178'}
      />

      <Label>Weight ({imperial ? 'lb' : 'kg'})</Label>
      <Input value={weight} onChangeText={setWeight} keyboardType="decimal-pad" placeholder={imperial ? 'e.g. 170' : 'e.g. 77'} />

      <Button title="Work out my targets" variant="secondary" onPress={workOut} />

      <Card style={{ gap: space.md }}>
        <Text style={styles.cardLabel}>DAILY TARGETS</Text>
        <View style={styles.grid}>
          <Field label="Calories (kcal)" value={calories} onChange={setCalories} />
          <Field label="Protein (g)" value={protein} onChange={setProtein} />
          <Field label="Carbs (g)" value={carbs} onChange={setCarbs} />
          <Field label="Fat (g)" value={fat} onChange={setFat} />
        </View>
      </Card>

      <Label>Meal reminder</Label>
      <Text style={styles.muted}>
        If you're short on protein or calories at this time, Spotter sends you a meal idea that fills the gap.
      </Text>
      <View style={styles.row}>
        <Chip label="Off" selected={reminder === null} onPress={() => setReminder(null)} />
        {REMINDER_TIMES.map((t) => (
          <Chip key={t} label={formatTime(t)} selected={reminder === t} onPress={() => setReminder(t)} />
        ))}
      </View>

      <ErrorText>{error}</ErrorText>
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      <Button title="Save" onPress={save} loading={saving} />
    </Screen>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <View style={{ width: '48%', gap: space.xs }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Input value={value} onChangeText={onChange} keyboardType="number-pad" />
    </View>
  );
}

const styles = StyleSheet.create({
  intro: { color: colors.muted, fontSize: 15, lineHeight: 21 },
  muted: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  cardLabel: { color: colors.muted, fontSize: 12, fontWeight: '700', letterSpacing: 0.8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: space.md },
  fieldLabel: { color: colors.muted, fontSize: 13, fontWeight: '600' },
  notice: { color: colors.warn, fontSize: 14, lineHeight: 20 },
});
