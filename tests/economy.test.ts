import { describe, expect, test } from 'vitest';
import { DAILY_REWARDS, claimDaily, dailyStatus, dayKey, levelReward } from '../src/meta/economy';
import { SKINS } from '../src/meta/skins';

describe('daily reward', () => {
  test('first claim gives day 1', () => {
    const s = { last: null, streak: 0 };
    expect(dailyStatus(s, '2026-10-06')).toMatchObject({ available: true, index: 0, reward: DAILY_REWARDS[0] });
    const r = claimDaily(s, '2026-10-06');
    expect(r.reward).toBe(DAILY_REWARDS[0]);
    expect(r.state).toEqual({ last: '2026-10-06', streak: 1 });
  });
  test('cannot claim twice a day', () => {
    const s = { last: '2026-10-06', streak: 1 };
    expect(dailyStatus(s, '2026-10-06').available).toBe(false);
    expect(claimDaily(s, '2026-10-06').reward).toBe(0);
  });
  test('consecutive days advance the calendar, across month ends, and loop after 7', () => {
    let s = { last: null as string | null, streak: 0 };
    const days = ['2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05'];
    const got = days.map((d) => {
      const r = claimDaily(s, d);
      s = r.state;
      return r.reward;
    });
    expect(got).toEqual([...DAILY_REWARDS, DAILY_REWARDS[0]]);
  });
  test('missing a day resets the streak', () => {
    const s = { last: '2026-10-03', streak: 4 };
    expect(dailyStatus(s, '2026-10-06')).toMatchObject({ available: true, index: 0, reset: true });
    expect(claimDaily(s, '2026-10-06').state.streak).toBe(1);
  });
  test('dayKey is local YYYY-MM-DD', () => {
    expect(dayKey(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});

describe('level rewards and skins', () => {
  test('rewards first clears and only new stars', () => {
    expect(levelReward(0, 3, true)).toBe(50);
    expect(levelReward(1, 3, false)).toBe(20);
    expect(levelReward(3, 2, false)).toBe(0);
  });
  test('skin catalogue is sane', () => {
    expect(new Set(SKINS.map((s) => s.id)).size).toBe(SKINS.length);
    expect(SKINS[0].price).toBe(0);
  });
});
