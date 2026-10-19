'use strict';
// Health: shows daily activity pushed from a phone/watch (Apple Health via Shortcuts or
// Health Auto Export, Android/Fitbit via any automation). Setup: Admin > Health.
const health = require('../../server/health');

exports.meta = {
  type: 'health',
  name: 'Health',
  description: 'Steps, activity rings, heart rate, sleep and weight from your phone or watch.',
  refreshSec: 60,
  fields: [
    { key: 'person', label: 'Person', type: 'text', placeholder: 'me', help: 'Matches the "person" you send with the data. Add one widget per family member.' },
    { key: 'stepGoal', label: 'Daily step goal', type: 'number', placeholder: '10000' },
    { key: 'calorieGoal', label: 'Active calorie goal', type: 'number', placeholder: '500' },
    { key: 'exerciseGoal', label: 'Exercise minutes goal', type: 'number', placeholder: '30' },
    { key: 'sleepGoal', label: 'Sleep goal (hours)', type: 'number', placeholder: '8' },
    { key: 'highlight', label: 'Highlight what matters (goal-reached glow, step streaks, best day)', type: 'checkbox', default: true },
  ],
};

exports.data = async (options, ctx) => {
  const person = String(options.person || 'me').toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'me';
  const s = health.summary(person);
  if (!s) throw new Error(`No health data received yet${person === 'me' ? '' : ` for "${person}"`}. Open Admin > Health for setup.`);
  const imperial = ctx.display.units === 'imperial';
  const m = { ...s.metrics };
  const out = {
    person,
    date: s.date,
    isToday: s.isToday,
    updated: s.updated,
    week: s.week,
    goals: {
      steps: Number(options.stepGoal) || 10000,
      calories: Number(options.calorieGoal) || 500,
      exercise: Number(options.exerciseGoal) || 30,
      sleep: Number(options.sleepGoal) || 8,
    },
    m: {
      steps: m.steps, activeCalories: m.activeCalories, exerciseMinutes: m.exerciseMinutes, standHours: m.standHours,
      heartRate: m.heartRate, restingHeartRate: m.restingHeartRate, bloodOxygen: m.bloodOxygen, sleepHours: m.sleepHours,
      distance: m.distanceKm == null ? undefined : Math.round(m.distanceKm / (imperial ? health.KM_PER_MI : 1) * 10) / 10,
      weight: m.weightKg == null ? undefined : Math.round(m.weightKg / (imperial ? health.KG_PER_LB : 1) * 10) / 10,
    },
    units: { distance: imperial ? 'mi' : 'km', weight: imperial ? 'lb' : 'kg' },
  };
  return out;
};
