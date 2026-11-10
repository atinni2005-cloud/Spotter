import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { type MealIdea, swapMealIngredients } from '../lib/api';
import { describeMacros, describeTime } from '../lib/recipes';
import { colors, radius, space } from '../lib/theme';
import { Button, ErrorText, Input } from './ui';

/**
 * A full recipe: macros, time, ingredients with amounts and cooking steps.
 * Tap ingredients you don't have and swap them for equivalents; the new recipe
 * (with updated amounts, steps and macros) is passed to `onChange`.
 * Give it a new `key` to start fresh for a different recipe.
 */
export function RecipeView({
  recipe,
  onChange,
  stepsOpen = false,
}: {
  recipe: MealIdea;
  onChange: (recipe: MealIdea, swaps: { from: string; to: string }[]) => void;
  stepsOpen?: boolean;
}) {
  const [missing, setMissing] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [swaps, setSwaps] = useState<{ from: string; to: string }[]>([]);
  const [swapping, setSwapping] = useState(false);
  const [showSteps, setShowSteps] = useState(stepsOpen);
  const [error, setError] = useState<string | null>(null);

  const toggle = (name: string) => setMissing((m) => (m.includes(name) ? m.filter((x) => x !== name) : [...m, name]));

  async function swap() {
    setSwapping(true);
    setError(null);
    try {
      const result = await swapMealIngredients(recipe, missing, note);
      setMissing([]);
      setNote('');
      setSwaps(result.swaps);
      onChange(result.suggestion, result.swaps);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not swap ingredients');
    } finally {
      setSwapping(false);
    }
  }

  const time = describeTime(recipe);
  const steps = recipe.steps ?? [];

  return (
    <View style={{ gap: space.sm }}>
      <Text style={styles.title}>{recipe.title}</Text>
      <Text style={styles.macros}>{describeMacros(recipe)}</Text>
      {time || (recipe.servings ?? 1) > 1 ? (
        <Text style={styles.muted}>
          {time ? `⏱ ${time}` : ''}
          {(recipe.servings ?? 1) > 1 ? `${time ? ' · ' : ''}${recipe.servings} servings` : ''}
        </Text>
      ) : null}
      {recipe.description ? <Text style={styles.text}>{recipe.description}</Text> : null}

      {recipe.ingredients?.length ? (
        <>
          <Text style={styles.section}>Ingredients</Text>
          <Text style={styles.muted}>Tap anything you don't have:</Text>
          <View style={styles.chips}>
            {recipe.ingredients.map((ing) => {
              const off = missing.includes(ing.name);
              return (
                <Pressable
                  key={ing.name}
                  onPress={() => toggle(ing.name)}
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
                value={note}
                onChangeText={setNote}
                placeholder='Optional: what you do have, e.g. "I have tuna and rice"'
              />
              <Button
                title={`Swap ${missing.length === 1 ? 'it' : `these ${missing.length}`}`}
                onPress={swap}
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
          <ErrorText>{error}</ErrorText>
        </>
      ) : null}

      {steps.length ? (
        <>
          <Pressable onPress={() => setShowSteps((s) => !s)} hitSlop={8} accessibilityRole="button">
            <Text style={styles.link}>{showSteps ? 'Hide steps ▲' : `Show ${steps.length} cooking steps ▼`}</Text>
          </Pressable>
          {showSteps ? (
            <View style={{ gap: space.sm }}>
              {steps.map((step, i) => (
                <View key={i} style={styles.stepRow}>
                  <View style={styles.stepNum}>
                    <Text style={styles.stepNumText}>{i + 1}</Text>
                  </View>
                  <Text style={[styles.text, { flex: 1 }]}>{step}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  title: { color: colors.text, fontSize: 18, fontWeight: '800' },
  macros: { color: colors.accent, fontSize: 14, fontWeight: '700' },
  muted: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  text: { color: colors.text, fontSize: 15, lineHeight: 21 },
  section: { color: colors.text, fontSize: 15, fontWeight: '800', marginTop: space.xs },
  link: { color: colors.accent, fontSize: 14, fontWeight: '700', marginTop: space.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  ingredient: {
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.cardAlt,
  },
  ingredientOff: { borderColor: colors.danger, backgroundColor: 'transparent' },
  ingredientText: { color: colors.text, fontSize: 14 },
  ingredientTextOff: { color: colors.danger, textDecorationLine: 'line-through' },
  swap: { color: colors.accent, fontSize: 14, lineHeight: 20 },
  stepRow: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  stepNum: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.cardAlt,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  stepNumText: { color: colors.accent, fontSize: 13, fontWeight: '800' },
});
