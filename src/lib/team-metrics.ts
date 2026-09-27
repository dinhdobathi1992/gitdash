/** Team-level figures derived from per-contributor rows. */

/** Fewest reviewers who together give at least half of all reviews. */
export function reviewBusFactor(reviews: number[]): { people: number; share: number } | null {
  const total = reviews.reduce((a, b) => a + b, 0);
  if (!total) return null;
  const sorted = [...reviews].sort((a, b) => b - a);
  let acc = 0;
  for (let i = 0; i < sorted.length; i++) {
    acc += sorted[i];
    if (acc / total >= 0.5) return { people: i + 1, share: Math.round((acc / total) * 100) };
  }
  return { people: sorted.length, share: 100 };
}

/** Median of the positive values; null when there are none. */
export function medianPositive(v: number[]): number | null {
  const s = v.filter((x) => x > 0).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
