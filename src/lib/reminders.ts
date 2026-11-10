// Meal reminders.
//
// At the time the user picks, if they are behind on protein or calories, they
// get a notification with a meal that closes the gap. Notifications are local
// (scheduled on the phone), so this works in Expo Go without a push server.
//
// How it stays accurate: every time the app opens, a meal is saved, or the
// settings change, we cancel the pending reminders and schedule them again:
// - today: only if the target is still missed, with a meal suggestion
// - the next few days: a plain "check your protein" nudge, which is replaced
//   with a real suggestion as soon as the app is opened that day.
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { suggestMeal } from './api';
import { startOfTodayIso, sumMeals } from './nutrition';
import { supabase } from './supabase';
import type { Profile } from './types';

const KIND = 'meal-reminder';
const CACHE_KEY = 'spotter.mealSuggestion';
const FALLBACK_DAYS = 3;

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/** Asks for notification permission. Returns true if allowed. */
export async function ensureNotificationPermission(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('meals', {
      name: 'Meal reminders',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  const asked = await Notifications.requestPermissionsAsync();
  return asked.granted;
}

async function cancelMealReminders() {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    scheduled
      .filter((n) => n.content.data?.kind === KIND)
      .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)),
  );
}

function atTime(hhmm: string, daysFromToday: number): Date {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date();
  d.setDate(d.getDate() + daysFromToday);
  d.setHours(h, m || 0, 0, 0);
  return d;
}

async function schedule(date: Date, title: string, body: string) {
  await Notifications.scheduleNotificationAsync({
    content: { title, body, data: { kind: KIND } },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date, channelId: 'meals' },
  });
}

type Cached = { key: string; title: string; body: string } | { key: string; met: true };

/**
 * Re-plans the meal reminders. Safe to call often: the meal suggestion is only
 * fetched again when today's numbers change noticeably.
 */
// Runs one re-plan at a time, so two screens refreshing together can't double-schedule.
let queue: Promise<void> = Promise.resolve();

export function refreshMealReminders(profile: Profile | null, totals?: { calories: number; protein_g: number }) {
  queue = queue.then(() => replan(profile, totals));
  return queue;
}

async function replan(profile: Profile | null, totals?: { calories: number; protein_g: number }) {
  if (Platform.OS === 'web' || !profile) return;
  try {
    await cancelMealReminders();
    const time = profile.meal_reminder_time?.slice(0, 5);
    if (!time || (!profile.protein_target_g && !profile.calorie_target)) return;
    const perm = await Notifications.getPermissionsAsync();
    if (!perm.granted) return;

    for (let day = 1; day <= FALLBACK_DAYS; day++) {
      await schedule(
        atTime(time, day),
        'How is your protein today?',
        'Log your meals in Spotter and get a meal idea if you are short of your target.',
      );
    }

    const today = atTime(time, 0);
    if (today.getTime() <= Date.now()) return;

    // Reuse the last suggestion while today's totals stay roughly the same.
    const dateKey = new Date().toDateString();
    const key = totals
      ? `${dateKey}|${Math.round(totals.calories / 100)}|${Math.round(totals.protein_g / 10)}|${profile.calorie_target}|${profile.protein_target_g}`
      : '';
    let plan: Cached | null = null;
    const cachedRaw = key ? await AsyncStorage.getItem(CACHE_KEY) : null;
    if (cachedRaw) {
      const cached = JSON.parse(cachedRaw) as Cached;
      if (cached.key === key) plan = cached;
    }
    if (!plan) {
      const result = await suggestMeal();
      if (result.met || !result.suggestion) {
        plan = { key, met: true };
      } else {
        const gap = result.remaining.protein_g
          ? `You still need ${result.remaining.protein_g} g protein today`
          : `You still have ${result.remaining.calories} kcal left today`;
        const s = result.suggestion;
        plan = {
          key,
          title: gap,
          body: `Try: ${s.title} (about ${s.protein_g} g protein, ${s.calories} kcal). ${s.description}`,
        };
      }
      if (key) await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(plan));
    }
    if ('met' in plan) return;
    await schedule(today, plan.title, plan.body);
  } catch (e) {
    console.warn('Could not schedule meal reminders', e);
  }
}

/** Loads today's meals, then re-plans the reminders. */
export async function refreshMealRemindersFromDb(profile: Profile | null) {
  if (Platform.OS === 'web') return;
  if (!profile?.meal_reminder_time) {
    queue = queue.then(() => cancelMealReminders().catch(() => {}));
    return queue;
  }
  const { data } = await supabase
    .from('meal_logs')
    .select('calories, protein_g, carbs_g, fat_g')
    .gte('eaten_at', startOfTodayIso());
  await refreshMealReminders(profile, sumMeals(data ?? []));
}
