/** Normalised for matching: Unicode NFC, lower case, single spaces (Thai has no case; Latin does). */
const normalize = (value: string) => value.normalize("NFC").toLocaleLowerCase("th").replace(/\s+/gu, " ").trim();

/** A project title matches when it contains every word of the query (any order). An empty query matches all. */
export function matchesQuery(title: string, query: string): boolean {
  const words = normalize(query).split(" ").filter(Boolean);
  const haystack = normalize(title);
  return words.every((word) => haystack.includes(word));
}
