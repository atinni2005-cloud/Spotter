import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { Card, ErrorText, Screen } from '../components/ui';
import { describeMacros, describeTime, listSavedRecipes, recipeFromSaved } from '../lib/recipes';
import { colors, space } from '../lib/theme';
import type { SavedRecipe } from '../lib/types';

export default function Recipes() {
  const [recipes, setRecipes] = useState<SavedRecipe[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      listSavedRecipes()
        .then(setRecipes)
        .catch((e) => setError(e instanceof Error ? e.message : 'Could not load your recipes'));
    }, []),
  );

  return (
    <Screen scroll edges={['bottom']}>
      <ErrorText>{error}</ErrorText>
      {recipes?.length === 0 ? (
        <Text style={styles.muted}>
          No saved recipes yet. On the Eat tab, tap "Suggest a meal", then "Save recipe" on one you like.
        </Text>
      ) : null}
      {(recipes ?? []).map((r) => {
        const recipe = recipeFromSaved(r);
        const time = describeTime(recipe);
        return (
          <Pressable key={r.id} onPress={() => router.push({ pathname: '/recipe/[id]', params: { id: r.id } })}>
            <Card style={{ gap: 2 }}>
              <Text style={styles.name} numberOfLines={1}>
                {r.title}
              </Text>
              <Text style={styles.macros}>{describeMacros(recipe)}</Text>
              {time ? <Text style={styles.muted}>⏱ {time}</Text> : null}
            </Card>
          </Pressable>
        );
      })}
    </Screen>
  );
}

const styles = StyleSheet.create({
  name: { color: colors.text, fontSize: 17, fontWeight: '700' },
  macros: { color: colors.accent, fontSize: 14, fontWeight: '600' },
  muted: { color: colors.muted, fontSize: 14, lineHeight: 20, marginTop: space.xs },
});
