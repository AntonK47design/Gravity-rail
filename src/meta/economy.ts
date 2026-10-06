/**
 * Gears — the in-game currency. Earned by playing (first clears, new stars)
 * and by the daily reward; spent in the shop on cosmetic skins. Pure
 * functions only, so the rules are easy to test and tune.
 */

export const CURRENCY = 'Gears';

export const REWARD = {
  /** First time a level is completed. */
  firstClear: 20,
  /** Every star earned for the first time on a level. */
  perStar: 10,
};

/** Seven-day login calendar; the last day is the big one, then it loops. */
export const DAILY_REWARDS = [30, 40, 50, 60, 80, 100, 200];

export interface DailyState {
  /** Local date (YYYY-MM-DD) of the last claim. */
  last: string | null;
  /** Consecutive days claimed in the current streak. */
  streak: number;
}

export interface DailyStatus {
  available: boolean;
  /** Index (0–6) of the calendar day that is claimable now, or claimed today. */
  index: number;
  reward: number;
  /** A previous streak was lost by missing a day. */
  reset: boolean;
}

export function dayKey(d: Date = new Date()): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function dayNumber(key: string): number {
  const [y, m, d] = key.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
}

export function dailyStatus(state: DailyState, today: string): DailyStatus {
  if (state.last === today) {
    const index = (Math.max(1, state.streak) - 1) % DAILY_REWARDS.length;
    return { available: false, index, reward: DAILY_REWARDS[index], reset: false };
  }
  const gap = state.last ? dayNumber(today) - dayNumber(state.last) : Infinity;
  const continues = gap === 1;
  const index = continues ? state.streak % DAILY_REWARDS.length : 0;
  return { available: true, index, reward: DAILY_REWARDS[index], reset: !continues && state.streak > 0 };
}

export function claimDaily(state: DailyState, today: string): { state: DailyState; reward: number } {
  const st = dailyStatus(state, today);
  if (!st.available) return { state, reward: 0 };
  const continues = !!state.last && dayNumber(today) - dayNumber(state.last) === 1;
  return { state: { last: today, streak: continues ? state.streak + 1 : 1 }, reward: st.reward };
}

/** Gears for a finished run: first clear bonus plus any newly earned stars. */
export function levelReward(prevStars: number, newStars: number, firstClear: boolean): number {
  return (firstClear ? REWARD.firstClear : 0) + Math.max(0, newStars - prevStars) * REWARD.perStar;
}
