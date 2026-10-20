// The share note template. The client builds notes with it and /api/share-note
// publishes only notes that match it exactly.

const SITE = "https://holdbtc.io";
const IMAGE = `${SITE}/hb.jpg`;

export function shareNoteContent(score: number): string {
  const year = 2008 + Math.floor(Math.max(0, score) / 1000);
  const pips = score.toLocaleString("en-US");
  return (
    `Still holding true BTC history!\n\n` +
    `Hold Bitcoin until ${year}\n` +
    `${pips} pips.\n\n` +
    `${SITE}\n\n` +
    IMAGE
  );
}

export function shareNoteTags(): string[][] {
  return [
    ["t", "holdbtc"],
    ["t", "bitcoin"],
    ["r", SITE],
    ["r", IMAGE],
    ["imeta", `url ${IMAGE}`, "m image/jpeg"],
    ["client", "holdbtc"],
  ];
}

/** The score in a note built from this template, or null if the content or tags differ in any way. */
export function shareNoteScore(content: unknown, tags: unknown): number | null {
  if (typeof content !== "string" || JSON.stringify(tags) !== JSON.stringify(shareNoteTags())) {
    return null;
  }
  const match = /\n(\d{1,3}(?:,\d{3}){0,4}) pips\.\n/.exec(content);
  if (!match) return null;
  const score = Number(match[1].replace(/,/g, ""));
  return shareNoteContent(score) === content ? score : null;
}
