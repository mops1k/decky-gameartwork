import { describe, expect, it } from 'vitest';

import { isConfidentMatch, normalizeTitle, pickBestMatch, scoreMatch } from './matchGame';

describe('normalizeTitle', () => {
  it('keeps letters of any alphabet', () => {
    expect(normalizeTitle('Ведьмак 3: Дикая Охота')).toBe('ведьмак 3 дикая охота');
    expect(normalizeTitle('ゼルダの伝説')).toBe('ゼルダの伝説');
    expect(normalizeTitle('Pokémon™')).toBe('pokémon');
  });
});

describe('scoreMatch', () => {
  it('scores an identical title as 1', () => {
    expect(scoreMatch('Hollow Knight', 'Hollow Knight')).toBe(1);
  });

  it('ignores edition noise', () => {
    expect(isConfidentMatch('Hollow Knight: Voidheart Edition', 'Hollow Knight Voidheart')).toBe(true);
    expect(isConfidentMatch('Celeste', 'Celeste Deluxe Edition')).toBe(true);
  });

  it('does not confuse a game with its sequel', () => {
    expect(scoreMatch('Hades', 'Hades II')).toBeLessThanOrEqual(0.5);
    expect(scoreMatch('Portal', 'Portal 2')).toBeLessThanOrEqual(0.5);
    expect(isConfidentMatch('Hades', 'Hades II')).toBe(false);
  });

  it('keeps a sequel number that both titles share', () => {
    expect(isConfidentMatch('The Witcher 3', 'The Witcher 3: Wild Hunt')).toBe(true);
  });

  it('matches a localized title only when the letters agree', () => {
    expect(isConfidentMatch('Ведьмак 3', 'The Witcher 3')).toBe(false);
  });

  it('returns 0 for an empty title', () => {
    expect(scoreMatch('', 'Hades')).toBe(0);
    expect(scoreMatch('Hades', '***')).toBe(0);
  });
});

describe('pickBestMatch', () => {
  it('returns undefined for no candidates', () => {
    expect(pickBestMatch('Hades', [])).toBeUndefined();
  });

  it('trusts a single result only when the title agrees', () => {
    expect(pickBestMatch('Celeste', [{ name: 'Celeste' }])?.name).toBe('Celeste');
    expect(pickBestMatch('Celeste', [{ name: 'Celeste II' }])).toBeUndefined();
    expect(pickBestMatch('Celeste', [{ name: 'Some Other Game' }])).toBeUndefined();
  });

  it('prefers the exact title over a longer one', () => {
    const best = pickBestMatch('Hades', [
      { name: 'Hades II' },
      { name: 'Hades' },
      { name: 'Hades Original Soundtrack' },
    ]);
    expect(best?.name).toBe('Hades');
  });

  it('rejects every candidate when none is close enough', () => {
    expect(pickBestMatch('Celeste', [{ name: 'Hades' }, { name: 'Portal 2' }])).toBeUndefined();
  });
});
