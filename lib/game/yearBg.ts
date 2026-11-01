/** Years that have a still (public/years/stills) and a desktop clip (public/years/clips). Canvas stays clear so they show. */
const FIRST = 2008;
const LAST = 2026;

export function hasHtmlYearBg(year: number): boolean {
  return year >= FIRST && year <= LAST;
}
