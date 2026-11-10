import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { RecipeView } from '../../components/RecipeView';
import { Button, Card, ErrorText, ProgressBar } from '../../components/ui';
import { type MealIdea, type MealSuggestion, suggestMeal } from '../../lib/api';
import { formatTime, overTargets, profileTargets, startOfTodayIso, sumMeals } from '../../lib/nutrition';
import { logRecipeAsMeal, saveRecipe } from '../../lib/recipes';
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
  const [ideaVersion, setIdeaVersion] = useState(0);
  const [savedIdea, setSavedIdea] = useState<MealIdea | null>(null);
  const [savingIdea, setSavingIdea] = useState(false);
  const [loggingIdea, setLoggingIdea] = useState(false);
  const [savedCount, setSavedCount] = useState<number | null>(null);

  const targets = profileTargets(profile);
  const totals = sumMeals(meals);
  const overs = overTargets(totals, targets);

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
    const { count } = await supabase.from('saved_recipes').select('id', { count: 'exact', head: true });
    setSavedCount(count ?? null);
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
      setIdeaVersion((v) => v + 1);
      setSavedIdea(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not get a meal idea');
    } finally {
      setLoadingIdea(false);
    }
  }

  async function saveIdea() {
    if (!idea?.suggestion) return;
    setSavingIdea(true);
    setError(null);
    try {
      await saveRecipe(idea.suggestion);
      setSavedIdea(idea.suggestion);
      setSavedCount((c) => (c ?? 0) + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the recipe');
    } finally {
      setSavingIdea(false);
    }
  }

  async function logIdea() {
    if (!idea?.suggestion) return;
    setLoggingIdea(true);
    setError(null);
    try {
      await logRecipeAsMeal(idea.suggestion);
      setIdea(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not log the meal');
    } finally {
      setLoggingIdea(false);
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

      {overs.length ? (
        <Card style={{ gap: space.sm, borderColor: colors.warn }}>
          <Text style={[styles.cardLabel, { color: colors.warn }]}>OVER TARGET TODAY</Text>
          {overs.map((o) => (
            <View key={o.key} style={{ gap: 2 }}>
              <Text style={styles.overLine}>
                {o.label}: {o.over} {o.unit} over
              </Text>
              <Text style={styles.muted}>{o.tip}</Text>
            </View>
          ))}
        </Card>
      ) : null}

      {targets ? (
        <Card style={{ gap: space.sm }}>
          <View style={styles.headerRow}>
            <Text style={styles.cardLabel}>MEAL IDEA</Text>
            <Pressable onPress={() => router.push('/recipes')} hitSlop={8}>
              <Text style={styles.link}>Saved recipes{savedCount ? ` (${savedCount})` : ''}</Text>
            </Pressable>
          </View>
          {idea?.met ? (
            <Text style={styles.text}>You've hit your targets for today. Nice work.</Text>
          ) : idea?.suggestion ? (
            <>
              <RecipeView
                key={ideaVersion}
                recipe={idea.suggestion}
                onChange={(recipe) => setIdea({ ...idea, suggestion: recipe })}
              />
              <View style={styles.row}>
                <Button
                  title={savedIdea === idea.suggestion ? 'Saved ♥' : '♡ Save recipe'}
                  variant="secondary"
                  onPress={saveIdea}
                  loading={savingIdea}
                  disabled={savedIdea === idea.suggestion}
                  style={{ flex: 1 }}
                />
                <Button title="I ate this" variant="secondary" onPress={logIdea} loading={loggingIdea} style={{ flex: 1 }} />
              </View>
            </>
          ) : (
            <Text style={styles.muted}>
              Get a recipe that fills what you have left today, with amounts, steps and macros.
            </Text>
          )}
          <Button
            title={idea ? 'Another idea' : 'Suggest a meal'}
            variant="secondary"
            onPress={getIdea}
            loading={loadingIdea}
          />
        </Card>
      ) : savedCount ? (
        <Button title={`♥ Saved recipes (${savedCount})`} variant="secondary" onPress={() => router.push('/recipes')} />
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
  overLine: { color: colors.text, fontSize: 16, fontWeight: '800' },
  section: { color: colors.text, fontSize: 20, fontWeight: '800', marginTop: space.sm },
  mealName: { color: colors.text, fontSize: 17, fontWeight: '700', flex: 1 },
  hint: { color: colors.muted, fontSize: 13, textAlign: 'center' },
});
