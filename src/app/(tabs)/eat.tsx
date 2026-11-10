import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, Card, ErrorText, Input, ProgressBar } from '../../components/ui';
import { type MealSuggestion, suggestMeal, swapMealIngredients } from '../../lib/api';
import { formatTime, profileTargets, startOfTodayIso, sumMeals } from '../../lib/nutrition';
import { refreshMealReminders } from '../../lib/reminders';
import { supabase } from '../../lib/supabase';
import { colors, space } from '../../lib/theme';
import type { MealLog } from '../../lib/types';
import { useAuth } from '../../providers/AuthProvider';

export default function Eat() {
  const { profile } = useAuth();
  const [meals, setMeals] = useState<MealLog[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [idea, setIdea] = useState<MealSuggestion | null>(null);
  const [loadingIdea, setLoadingIdea] = useState(false);
  const [missing, setMissing] = useState<string[]>([]);
  const [swapNote, setSwapNote] = useState('');
  const [swaps, setSwaps] = useState<{ from: string; to: string }[]>([]);
  const [swapping, setSwapping] = useState(false);

  const targets = profileTargets(profile);
  const totals = sumMeals(meals);

  const load = useCallback(async () => {
    const { data, error: err } = await supabase
      .from('meal_logs')
      .select('id, name, description, eaten_at, calories, protein_g, carbs_g, fat_g, confidence, source')
      .gte('eaten_at', startOfTodayIso())
      .order('eaten_at', { ascending: false });
    if (err) setError(err.message);
    const rows = (data as MealLog[]) ?? [];
    setMeals(rows);
    refreshMealReminders(profile, sumMeals(rows));
  }, [profile]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function getIdea() {
    setLoadingIdea(true);
    setError(null);
    try {
      setIdea(await suggestMeal());
      setMissing([]);
      setSwaps([]);
      setSwapNote('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not get a meal idea');
    } finally {
      setLoadingIdea(false);
    }
  }

  const toggleMissing = (name: string) =>
    setMissing((m) => (m.includes(name) ? m.filter((x) => x !== name) : [...m, name]));

  async function swapMissing() {
    if (!idea?.suggestion) return;
    setSwapping(true);
    setError(null);
    try {
      const result = await swapMealIngredients(idea.suggestion, missing, swapNote);
      setIdea({ ...idea, suggestion: result.suggestion });
      setSwaps(result.swaps);
      setMissing([]);
      setSwapNote('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not swap ingredients');
    } finally {
      setSwapping(false);
    }
  }

  function confirmDelete(meal: MealLog) {
    Alert.alert('Delete this meal?', meal.name ?? undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await supabase.from('meal_logs').delete().eq('id', meal.id);
          setIdea(null);
          load();
        },
      },
    ]);
  }

  const addMeal = (source: 'camera' | 'library' | 'text') => router.push({ pathname: '/meal/new', params: { source } });
  const reminder = profile?.meal_reminder_time?.slice(0, 5);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: space.xxl * 2 }}
      refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={colors.accent} />}
    >
      <Card style={{ gap: space.md }}>
        <View style={styles.headerRow}>
          <Text style={styles.cardLabel}>TODAY</Text>
          <Pressable onPress={() => router.push('/nutrition-settings')} hitSlop={8}>
            <Text style={styles.link}>{targets ? 'Targets & reminder' : 'Set targets'}</Text>
          </Pressable>
        </View>
        <ProgressBar label="Calories" value={totals.calories} target={targets?.calories ?? null} unit="kcal" />
        <ProgressBar label="Protein" value={totals.protein_g} target={targets?.protein_g ?? null} unit="g" />
        <View style={styles.smallRow}>
          <Text style={styles.muted}>
            Carbs {totals.carbs_g}
            {targets?.carbs_g ? ` / ${targets.carbs_g}` : ''} g
          </Text>
          <Text style={styles.muted}>
            Fat {totals.fat_g}
            {targets?.fat_g ? ` / ${targets.fat_g}` : ''} g
          </Text>
        </View>
        {!targets ? (
          <>
            <Text style={styles.muted}>
              Add your height and weight and Spotter works out your daily calories and protein from your goal.
            </Text>
            <Button title="Add height & weight" onPress={() => router.push('/nutrition-settings')} />
          </>
        ) : (
          <Text style={styles.muted}>
            {reminder
              ? `Meal reminder at ${formatTime(reminder)} if you're short.`
              : 'Meal reminder is off. Turn it on in Targets & reminder.'}
          </Text>
        )}
      </Card>

      <Button title="📷  Snap a meal" onPress={() => addMeal('camera')} />
      <View style={styles.row}>
        <Button title="Choose photo" variant="secondary" onPress={() => addMeal('library')} style={{ flex: 1 }} />
        <Button title="Type it" variant="secondary" onPress={() => addMeal('text')} style={{ flex: 1 }} />
      </View>

      <ErrorText>{error}</ErrorText>

      {targets ? (
        <Card style={{ gap: space.sm }}>
          <Text style={styles.cardLabel}>MEAL IDEA</Text>
          {idea?.met ? (
            <Text style={styles.text}>You've hit your targets for today. Nice work.</Text>
          ) : idea?.suggestion ? (
            <>
              <Text style={styles.ideaTitle}>{idea.suggestion.title}</Text>
              <Text style={styles.muted}>
                About {idea.suggestion.protein_g} g protein · {idea.suggestion.calories} kcal
              </Text>
              <Text style={styles.text}>{idea.suggestion.description}</Text>
              {idea.suggestion.ingredients?.length ? (
                <>
                  <Text style={[styles.muted, { marginTop: space.xs }]}>Tap anything you don't have:</Text>
                  <View style={styles.chips}>
                    {idea.suggestion.ingredients.map((ing) => {
                      const off = missing.includes(ing.name);
                      return (
                        <Pressable
                          key={ing.name}
                          onPress={() => toggleMissing(ing.name)}
                          accessibilityRole="button"
                          accessibilityState={{ selected: off }}
                          style={[styles.ingredient, off && styles.ingredientOff]}
                        >
                          <Text style={[styles.ingredientText, off && styles.ingredientTextOff]}>
                            {ing.amount ? `${ing.amount} ` : ''}
                            {ing.name}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  {missing.length ? (
                    <>
                      <Input
                        value={swapNote}
                        onChangeText={setSwapNote}
                        placeholder='Optional: what you do have, e.g. "I have tuna and rice"'
                      />
                      <Button
                        title={`Swap ${missing.length === 1 ? 'it' : `these ${missing.length}`}`}
                        onPress={swapMissing}
                        loading={swapping}
                      />
                    </>
                  ) : null}
                  {swaps.length ? (
                    <View style={{ gap: 2 }}>
                      {swaps.map((x, i) => (
                        <Text key={i} style={styles.swap}>
                          ↺ {x.from} → {x.to}
                        </Text>
                      ))}
                    </View>
                  ) : null}
                </>
              ) : null}
            </>
          ) : (
            <Text style={styles.muted}>Get a meal that fills what you have left today.</Text>
          )}
          <Button
            title={idea ? 'Another idea' : 'Suggest a meal'}
            variant="secondary"
            onPress={getIdea}
            loading={loadingIdea}
          />
        </Card>
      ) : null}

      <Text style={styles.section}>Logged today</Text>
      {meals.length === 0 ? (
        <Text style={styles.muted}>Nothing yet. Snap your next meal.</Text>
      ) : (
        meals.map((m) => (
          <Pressable key={m.id} onLongPress={() => confirmDelete(m)}>
            <Card>
              <View style={styles.headerRow}>
                <Text style={styles.mealName} numberOfLines={1}>
                  {m.name ?? m.description ?? 'Meal'}
                </Text>
                <Text style={styles.muted}>
                  {new Date(m.eaten_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                </Text>
              </View>
              <Text style={styles.muted}>
                {m.calories ?? 0} kcal · {Math.round(Number(m.protein_g) || 0)} g protein ·{' '}
                {Math.round(Number(m.carbs_g) || 0)} g carbs · {Math.round(Number(m.fat_g) || 0)} g fat
              </Text>
            </Card>
          </Pressable>
        ))
      )}
      {meals.length > 0 ? <Text style={styles.hint}>Press and hold a meal to delete it.</Text> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.md },
  cardLabel: { color: colors.muted, fontSize: 12, fontWeight: '700', letterSpacing: 0.8 },
  link: { color: colors.accent, fontSize: 14, fontWeight: '700' },
  smallRow: { flexDirection: 'row', gap: space.lg },
  row: { flexDirection: 'row', gap: space.sm },
  muted: { color: colors.muted, fontSize: 15, lineHeight: 21 },
  text: { color: colors.text, fontSize: 15, lineHeight: 21 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  ingredient: {
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.cardAlt,
  },
  ingredientOff: { borderColor: colors.danger, backgroundColor: 'transparent' },
  ingredientText: { color: colors.text, fontSize: 14 },
  ingredientTextOff: { color: colors.danger, textDecorationLine: 'line-through' },
  swap: { color: colors.accent, fontSize: 14, lineHeight: 20 },
  ideaTitle: { color: colors.text, fontSize: 18, fontWeight: '800' },
  section: { color: colors.text, fontSize: 20, fontWeight: '800', marginTop: space.sm },
  mealName: { color: colors.text, fontSize: 17, fontWeight: '700', flex: 1 },
  hint: { color: colors.muted, fontSize: 13, textAlign: 'center' },
});
