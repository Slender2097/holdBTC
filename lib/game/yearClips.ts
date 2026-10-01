/** Years that have a file in public/years/. Canvas stays clear so the clip shows. */
const FIRST = 2008;
const LAST = 2026;

export function hasHtmlYearBg(year: number): boolean {
  return year >= FIRST && year <= LAST;
}
