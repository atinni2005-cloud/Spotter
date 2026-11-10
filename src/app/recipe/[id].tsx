import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Text } from 'react-native';
import { RecipeView } from '../../components/RecipeView';
import { Button, Card, ErrorText, Screen } from '../../components/ui';
import type { MealIdea } from '../../lib/api';
import {
  deleteSavedRecipe,
  getSavedRecipe,
  logRecipeAsMeal,
  recipeFromSaved,
  updateSavedRecipe,
} from '../../lib/recipes';
import { refreshMealRemindersFromDb } from '../../lib/reminders';
import { colors } from '../../lib/theme';
import { useAuth } from '../../providers/AuthProvider';

export default function Recipe() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { profile } = useAuth();
  const [recipe, setRecipe] = useState<MealIdea | null>(null);
  const [changed, setChanged] = useState(false);
  const [busy, setBusy] = useState<'save' | 'log' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getSavedRecipe(id)
      .then((r) => (r ? setRecipe(recipeFromSaved(r)) : setError('This recipe was deleted.')))
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load the recipe'));
  }, [id]);

  async function saveChanges() {
    if (!recipe) return;
    setBusy('save');
    setError(null);
    try {
      await updateSavedRecipe(id, recipe);
      setChanged(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setBusy(null);
    }
  }

  async function ateThis() {
    if (!recipe) return;
    setBusy('log');
    setError(null);
    try {
      await logRecipeAsMeal(recipe);
      refreshMealRemindersFromDb(profile);
      Alert.alert('Logged', `${recipe.title} was added to today's food.`, [{ text: 'OK', onPress: () => router.back() }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not log the meal');
    } finally {
      setBusy(null);
    }
  }

  function confirmDelete() {
    Alert.alert('Remove from saved recipes?', recipe?.title, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteSavedRecipe(id);
            router.back();
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not remove it');
          }
        },
      },
    ]);
  }

  return (
    <Screen scroll edges={['bottom']}>
      <Stack.Screen options={{ title: 'Recipe' }} />
      <ErrorText>{error}</ErrorText>
      {recipe ? (
        <>
          <Card>
            <RecipeView
              recipe={recipe}
              stepsOpen
              onChange={(r) => {
                setRecipe(r);
                setChanged(true);
              }}
            />
          </Card>
          {changed ? (
            <>
              <Text style={{ color: colors.muted, fontSize: 14 }}>
                Keep these swaps for next time?
              </Text>
              <Button title="Save changes" onPress={saveChanges} loading={busy === 'save'} />
            </>
          ) : null}
          <Button title="I ate this" variant="secondary" onPress={ateThis} loading={busy === 'log'} />
          <Button title="Remove from saved" variant="danger" onPress={confirmDelete} />
        </>
      ) : null}
    </Screen>
  );
}
