/** Day 1 is Monday 16 January 1984. */

const DAY_ONE = Date.UTC(1984, 0, 16);
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const ORDINALS = [
  '', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth',
  'eleventh', 'twelfth', 'thirteenth', 'fourteenth', 'fifteenth', 'sixteenth', 'seventeenth',
  'eighteenth', 'nineteenth', 'twentieth', 'twenty-first', 'twenty-second', 'twenty-third',
  'twenty-fourth', 'twenty-fifth', 'twenty-sixth', 'twenty-seventh', 'twenty-eighth',
  'twenty-ninth', 'thirtieth', 'thirty-first',
];

export function dateOf(day: number): Date {
  return new Date(DAY_ONE + (day - 1) * 86_400_000);
}

/** `16 January 1984`, for headings. */
export function shortDate(day: number): string {
  const d = dateOf(day);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** `the ninth of February`, for prose and epitaphs. */
export function proseDate(day: number): string {
  const d = dateOf(day);
  return `the ${ORDINALS[d.getUTCDate()]} of ${MONTHS[d.getUTCMonth()]}`;
}

/**
 * Hours of usable light. 8 on Day 1, 11 by early March (Day 48), a
 * little more after. Difficulty will adjust this at Stage 5.
 */
export function daylight(day: number): number {
  const h = 8 + ((day - 1) * 3) / 47;
  return Math.round(Math.min(h, 12) * 2) / 2;
}
