// Energy check-in: a few quick questions turned into an energy percentage.
// Later stages will prefer readings from Apple Health / Health Connect when available.

export type EnergyQuestion = {
  id: string;
  question: string;
  options: { label: string; score: number }[];
  weight: number;
};

export const ENERGY_QUESTIONS: EnergyQuestion[] = [
  {
    id: 'sleep',
    question: 'How many hours did you sleep last night?',
    weight: 0.25,
    options: [
      { label: 'Under 5h', score: 10 },
      { label: '5-6h', score: 40 },
      { label: '6-7h', score: 70 },
      { label: '7h or more', score: 100 },
    ],
  },
  {
    id: 'sleep_quality',
    question: 'How do you feel after that sleep?',
    weight: 0.15,
    options: [
      { label: 'Exhausted', score: 10 },
      { label: 'Groggy', score: 45 },
      { label: 'Fine', score: 75 },
      { label: 'Refreshed', score: 100 },
    ],
  },
  {
    id: 'soreness',
    question: 'How sore are your muscles?',
    weight: 0.2,
    options: [
      { label: 'Very sore', score: 15 },
      { label: 'Quite sore', score: 45 },
      { label: 'A little', score: 75 },
      { label: 'Not at all', score: 100 },
    ],
  },
  {
    id: 'stress',
    question: 'How stressed do you feel today?',
    weight: 0.15,
    options: [
      { label: 'Very stressed', score: 15 },
      { label: 'Somewhat', score: 50 },
      { label: 'A little', score: 75 },
      { label: 'Relaxed', score: 100 },
    ],
  },
  {
    id: 'fuel',
    question: 'Have you eaten and had enough water?',
    weight: 0.15,
    options: [
      { label: 'Barely anything', score: 20 },
      { label: 'Could be better', score: 55 },
      { label: 'Yes, well fuelled', score: 100 },
    ],
  },
  {
    id: 'motivation',
    question: 'How much do you feel like training?',
    weight: 0.2,
    options: [
      { label: 'Not at all', score: 10 },
      { label: 'Meh', score: 45 },
      { label: 'Ready', score: 80 },
      { label: "Let's go!", score: 100 },
    ],
  },
];

/** Weighted average of the chosen answers, 0-100. */
export function energyScore(answers: Record<string, number>): number {
  let total = 0;
  let weights = 0;
  for (const q of ENERGY_QUESTIONS) {
    const idx = answers[q.id];
    if (idx === undefined) continue;
    total += q.options[idx].score * q.weight;
    weights += q.weight;
  }
  return weights ? Math.round(total / weights) : 0;
}

export function energyAdvice(score: number, restThreshold: number): string {
  if (score < restThreshold) return 'Your energy is low. A rest or light recovery day is the smart call today.';
  if (score < 50) return "Lower energy today. Your coach will lighten today's session.";
  if (score < 70) return 'Moderate energy. Train as planned, but keep a rep or two in the tank.';
  return "You're good to go. Train as planned.";
}
