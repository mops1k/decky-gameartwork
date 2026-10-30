/**
 * Helpers for matching a shortcut name to a game title.
 * SteamGridDB autocomplete is fuzzy, so the first result is often an
 * edition, a sequel or a soundtrack instead of the game itself.
 */

const NOISE_WORDS = new Set([
  'the', 'a', 'an', 'of', 'and',
  'edition', 'definitive', 'remastered', 'remaster',
  'goty', 'ultimate', 'deluxe', 'complete', 'enhanced',
  'collector', 'collectors', 'hd',
]);
// Sequel numbers and roman numerals: "Hades" and "Hades II" are two games.
const NUMERAL = /^(?:\d{1,3}|[ivx]{1,5})$/i;

/** Keep letters of every alphabet: CJK, Cyrillic and accented titles too. */
export const normalizeTitle = (title: string): string =>
  (title || '')
    .toLowerCase()
    .replace(/[™®©]/g, ' ')
    .replace(/[’'`]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const tokens = (title: string): string[] =>
  normalizeTitle(title).split(' ').filter((token) => token && !NOISE_WORDS.has(token));

/** 0..1, how much of the requested title is covered by the candidate. */
export const scoreMatch = (query: string, candidate: string): number => {
  const queryTokens = tokens(query);
  const candidateTokens = tokens(candidate);
  if (!queryTokens.length || !candidateTokens.length) return 0;
  if (normalizeTitle(query) === normalizeTitle(candidate)) return 1;

  const querySet = new Set(queryTokens);
  const candidateSet = new Set(candidateTokens);
  let common = 0;
  for (const token of querySet) {
    if (candidateSet.has(token)) common++;
  }

  const coverage = common / querySet.size;
  // A numbering the query does not have ("Hades" vs "Hades II", "Portal" vs
  // "Portal 2") points at a different game, however much of the title matches.
  const extraNumeral = candidateTokens.some((token) => NUMERAL.test(token) && !querySet.has(token));
  return extraNumeral ? Math.min(coverage, 0.5) : coverage;
};

export const isConfidentMatch = (query: string, candidate: string): boolean => {
  const score = scoreMatch(query, candidate);
  return score >= 0.9;
};

/** Best candidate for the query, or undefined when the match is not confident. */
export const pickBestMatch = (query: string, candidates: Array<{ name: string }>): any | undefined => {
  if (!candidates?.length) return undefined;
  // One result is not automatically the right game: only trust it when the
  // title agrees, otherwise the caller would apply another game's artwork.
  if (candidates.length === 1) {
    return isConfidentMatch(query, candidates[0].name) ? candidates[0] : undefined;
  }

  let best: any;
  let bestScore = -1;
  for (const candidate of candidates) {
    const score = scoreMatch(query, candidate.name);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  const exact = candidates.find((candidate) => normalizeTitle(candidate.name) === normalizeTitle(query));
  if (exact) return exact;
  return bestScore >= 0.9 ? best : undefined;
};
