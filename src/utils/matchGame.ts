/**
 * Helpers for matching a shortcut name to a game title.
 * SteamGridDB autocomplete is fuzzy, so the first result is often an
 * edition, a sequel or a soundtrack instead of the game itself.
 */

const NOISE_WORDS = new Set(['the', 'a', 'an', 'of', 'and', 'edition', 'definitive', 'remastered', 'remaster']);

export const normalizeTitle = (title: string): string =>
  (title || '')
    .toLowerCase()
    .replace(/[™®©]/g, ' ')
    .replace(/[’'`]/g, '')
    .replace(/[^a-z0-9а-яё]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const tokens = (title: string): string[] =>
  normalizeTitle(title).split(' ').filter((token) => token && !NOISE_WORDS.has(token));

/** 0..1, how much of the requested title is covered by the candidate. */
export const scoreMatch = (query: string, candidate: string): number => {
  const queryTokens = tokens(query);
  const candidateTokens = tokens(candidate);
  if (!queryTokens.length || !candidateTokens.length) return 0;

  let common = 0;
  for (const token of queryTokens) {
    if (candidateTokens.includes(token)) common++;
  }

  const coverage = common / queryTokens.length;
  const exact = normalizeTitle(query) === normalizeTitle(candidate);
  return exact ? 1 : coverage;
};

export const isConfidentMatch = (query: string, candidate: string): boolean => {
  const score = scoreMatch(query, candidate);
  return score >= 0.9;
};

/** Best candidate for the query, or undefined when the match is not confident. */
export const pickBestMatch = (query: string, candidates: Array<{ name: string }>): any | undefined => {
  if (!candidates?.length) return undefined;
  if (candidates.length === 1) return candidates[0];

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
