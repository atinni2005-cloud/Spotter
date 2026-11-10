import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, View } from 'react-native';
import { Button, Card, ErrorText, Input, Label, Screen } from '../../components/ui';
import { analyzeMeal, type MealEstimate } from '../../lib/api';
import { pickMealPhoto, type Source } from '../../lib/media';
import { refreshMealRemindersFromDb } from '../../lib/reminders';
import { supabase } from '../../lib/supabase';
import { colors, radius, space } from '../../lib/theme';
import { useAuth } from '../../providers/AuthProvider';

type Fields = { name: string; calories: string; protein_g: string; carbs_g: string; fat_g: string };

const toFields = (e: MealEstimate): Fields => ({
  name: e.name,
  calories: String(e.calories),
  protein_g: String(e.protein_g),
  carbs_g: String(e.carbs_g),
  fat_g: String(e.fat_g),
});

const num = (s: string) => {
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

export default function NewMeal() {
  const { source } = useLocalSearchParams<{ source?: string }>();
  const { profile } = useAuth();
  const [photo, setPhoto] = useState<{ uri: string; base64: string } | null>(null);
  const [description, setDescription] = useState('');
  const [estimate, setEstimate] = useState<MealEstimate | null>(null);
  const [fields, setFields] = useState<Fields | null>(null);
  const [analysing, setAnalysing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  async function analyse(input: { imageBase64?: string; description?: string }) {
    setAnalysing(true);
    setError(null);
    try {
      const result = await analyzeMeal(input);
      setEstimate(result);
      setFields(toFields(result));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not estimate this meal');
    } finally {
      setAnalysing(false);
    }
  }

  async function takePhoto(from: Source) {
    setError(null);
    try {
      const picked = await pickMealPhoto(from);
      if (!picked) {
        if (!photo && !estimate) router.back();
        return;
      }
      setPhoto(picked);
      setEstimate(null);
      setFields(null);
      analyse({ imageBase64: picked.base64 });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open the camera');
    }
  }

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (source === 'camera' || source === 'library') takePhoto(source);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);

  async function save() {
    if (!fields) return;
    setSaving(true);
    setError(null);
    const { error: err } = await supabase.from('meal_logs').insert({
      name: fields.name.trim() || 'Meal',
      description: description.trim() || null,
      calories: Math.round(num(fields.calories)),
      protein_g: num(fields.protein_g),
      carbs_g: num(fields.carbs_g),
      fat_g: num(fields.fat_g),
      confidence: estimate?.confidence ?? null,
      source: photo ? 'photo' : 'text',
      raw: estimate ? { items: estimate.items, note: estimate.note } : null,
    });
    setSaving(false);
    if (err) return setError(err.message);
    refreshMealRemindersFromDb(profile);
    router.back();
  }

  const set = (k: keyof Fields) => (v: string) => setFields((f) => (f ? { ...f, [k]: v } : f));

  return (
    <Screen scroll edges={['bottom']}>
      {photo ? <Image source={{ uri: photo.uri }} style={styles.photo} resizeMode="cover" /> : null}

      {!photo && !estimate ? (
        <>
          <Text style={styles.intro}>
            Describe what you ate with rough amounts, for example "2 eggs, 2 slices of toast with butter, a latte".
          </Text>
          <Input value={description} onChangeText={setDescription} placeholder="What did you eat?" multiline />
          <Button
            title="Estimate macros"
            onPress={() => analyse({ description })}
            disabled={!description.trim()}
            loading={analysing}
          />
          {source !== 'text' ? null : (
            <Button title="Use a photo instead" variant="ghost" onPress={() => takePhoto('camera')} />
          )}
        </>
      ) : null}

      {analysing && photo ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.muted}>Reading your plate…</Text>
        </View>
      ) : null}

      <ErrorText>{error}</ErrorText>

      {photo && !analysing && !estimate ? (
        <>
          <Label>Add details (optional)</Label>
          <Input
            value={description}
            onChangeText={setDescription}
            placeholder='e.g. "about 200 g chicken, cooked in olive oil"'
            multiline
          />
          <Button title="Try again" onPress={() => analyse({ imageBase64: photo.base64, description })} />
          <Button title="Retake photo" variant="secondary" onPress={() => takePhoto('camera')} />
        </>
      ) : null}

      {estimate && fields ? (
        <>
          <Card style={{ gap: space.xs }}>
            <Text style={styles.cardLabel}>WHAT SPOTTER SEES</Text>
            {estimate.items.map((i, idx) => (
              <Text key={idx} style={styles.item}>
                {i.name} <Text style={styles.muted}>({i.portion})</Text>: {i.calories} kcal, {i.protein_g} g protein
              </Text>
            ))}
            {estimate.note ? <Text style={[styles.muted, { marginTop: space.xs }]}>{estimate.note}</Text> : null}
            <Text style={[styles.muted, { marginTop: space.xs }]}>
              Photo estimates can be off by 15 to 30%. Fix any number below before saving.
            </Text>
          </Card>

          <Label>Meal</Label>
          <Input value={fields.name} onChangeText={set('name')} />
          <View style={styles.grid}>
            <NumberField label="Calories (kcal)" value={fields.calories} onChange={set('calories')} />
            <NumberField label="Protein (g)" value={fields.protein_g} onChange={set('protein_g')} />
            <NumberField label="Carbs (g)" value={fields.carbs_g} onChange={set('carbs_g')} />
            <NumberField label="Fat (g)" value={fields.fat_g} onChange={set('fat_g')} />
          </View>

          {photo ? (
            <>
              <Label>Something off? Add details and re-check</Label>
              <Input
                value={description}
                onChangeText={setDescription}
                placeholder='e.g. "it was a double portion of rice"'
                multiline
              />
              {description.trim() ? (
                <Button
                  title="Re-check with details"
                  variant="secondary"
                  onPress={() => analyse({ imageBase64: photo.base64, description })}
                  loading={analysing}
                />
              ) : null}
            </>
          ) : null}

          <Button title="Save meal" onPress={save} loading={saving} />
        </>
      ) : null}
    </Screen>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <View style={{ width: '48%', gap: space.xs }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Input value={value} onChangeText={onChange} keyboardType="decimal-pad" />
    </View>
  );
}

const styles = StyleSheet.create({
  photo: { width: '100%', aspectRatio: 4 / 3, borderRadius: radius.lg, backgroundColor: colors.card },
  intro: { color: colors.muted, fontSize: 15, lineHeight: 21 },
  loading: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md },
  muted: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  cardLabel: { color: colors.muted, fontSize: 12, fontWeight: '700', letterSpacing: 0.8 },
  item: { color: colors.text, fontSize: 15, lineHeight: 21 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: space.md },
  fieldLabel: { color: colors.muted, fontSize: 13, fontWeight: '600' },
});
