import type { MealIdea } from './api';
import { supabase } from './supabase';
import type { SavedRecipe } from './types';

const COLUMNS =
  'id, title, description, calories, protein_g, carbs_g, fat_g, prep_minutes, cook_minutes, servings, ingredients, steps, created_at';

/** A saved recipe in the same shape as a meal idea, so one view shows both. */
export function recipeFromSaved(r: SavedRecipe): MealIdea {
  return {
    title: r.title,
    description: r.description ?? '',
    calories: Number(r.calories) || 0,
    protein_g: Math.round(Number(r.protein_g) || 0),
    carbs_g: Math.round(Number(r.carbs_g) || 0),
    fat_g: Math.round(Number(r.fat_g) || 0),
    prep_minutes: r.prep_minutes ?? undefined,
    cook_minutes: r.cook_minutes ?? undefined,
    servings: r.servings,
    ingredients: Array.isArray(r.ingredients) ? r.ingredients : [],
    steps: Array.isArray(r.steps) ? r.steps : [],
  };
}

function toRow(recipe: MealIdea) {
  return {
    title: recipe.title.trim() || 'Recipe',
    description: recipe.description || null,
    calories: Math.round(recipe.calories || 0),
    protein_g: recipe.protein_g ?? null,
    carbs_g: recipe.carbs_g ?? null,
    fat_g: recipe.fat_g ?? null,
    prep_minutes: recipe.prep_minutes ?? null,
    cook_minutes: recipe.cook_minutes ?? null,
    servings: recipe.servings ?? 1,
    ingredients: recipe.ingredients ?? [],
    steps: recipe.steps ?? [],
  };
}

export async function listSavedRecipes(): Promise<SavedRecipe[]> {
  const { data, error } = await supabase.from('saved_recipes').select(COLUMNS).order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data as SavedRecipe[]) ?? [];
}

export async function getSavedRecipe(id: string): Promise<SavedRecipe | null> {
  const { data, error } = await supabase.from('saved_recipes').select(COLUMNS).eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as SavedRecipe) ?? null;
}

/** Saves a recipe to favourites. Returns the new id. */
export async function saveRecipe(recipe: MealIdea): Promise<string> {
  const { data, error } = await supabase.from('saved_recipes').insert(toRow(recipe)).select('id').single();
  if (error || !data) throw new Error(error?.message ?? 'Could not save the recipe');
  return data.id;
}

export async function updateSavedRecipe(id: string, recipe: MealIdea): Promise<void> {
  const { error } = await supabase.from('saved_recipes').update(toRow(recipe)).eq('id', id);
  if (error) throw new Error(error.message);
}

export async function deleteSavedRecipe(id: string): Promise<void> {
  const { error } = await supabase.from('saved_recipes').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

/** Logs one serving of the recipe as a meal eaten now. */
export async function logRecipeAsMeal(recipe: MealIdea): Promise<void> {
  const servings = Math.max(1, recipe.servings ?? 1);
  const per = (n: number | undefined) => (n == null ? null : Math.round((n / servings) * 10) / 10);
  const { error } = await supabase.from('meal_logs').insert({
    name: recipe.title,
    description: 'From a Spotter recipe',
    calories: Math.round((recipe.calories || 0) / servings),
    protein_g: per(recipe.protein_g),
    carbs_g: per(recipe.carbs_g),
    fat_g: per(recipe.fat_g),
    source: 'manual',
    raw: { recipe },
  });
  if (error) throw new Error(error.message);
}

/** "10 min prep · 15 min cook", or null when the recipe has no times. */
export function describeTime(recipe: MealIdea): string | null {
  const parts: string[] = [];
  if (recipe.prep_minutes) parts.push(`${recipe.prep_minutes} min prep`);
  if (recipe.cook_minutes) parts.push(`${recipe.cook_minutes} min cook`);
  else if (recipe.prep_minutes && recipe.cook_minutes === 0) parts.push('no cooking');
  return parts.length ? parts.join(' · ') : null;
}

/** "640 kcal · 52 g protein · 60 g carbs · 18 g fat" */
export function describeMacros(recipe: MealIdea): string {
  const parts = [`${Math.round(recipe.calories || 0)} kcal`, `${Math.round(recipe.protein_g || 0)} g protein`];
  if (recipe.carbs_g != null) parts.push(`${Math.round(recipe.carbs_g)} g carbs`);
  if (recipe.fat_g != null) parts.push(`${Math.round(recipe.fat_g)} g fat`);
  return parts.join(' · ');
}
