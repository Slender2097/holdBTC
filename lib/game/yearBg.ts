/** Years that have a still in public/years/stills. Canvas stays clear so the still shows. */
const FIRST = 2008;
const LAST = 2026;

export function hasHtmlYearBg(year: number): boolean {
  return year >= FIRST && year <= LAST;
}
