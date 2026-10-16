/**
 * Validates the draft the opener returned. When the opener took a shortcut that never re-wrote the local copy (a clean
 * draft whose revision matched the cloud), a draft that no longer parses can still be healed from the cloud: `recover`
 * does one forced full load and rewrites the clean local draft. Without `recover`, or if it finds nothing, the original
 * validation error is thrown so nothing unreadable is ever opened for editing.
 */
export async function validateOrRecover<D>(draft: D, validate: (draft: D) => void, recover?: () => Promise<D | null>): Promise<D> {
  try {
    validate(draft);
    return draft;
  } catch (error) {
    if (!recover) throw error;
    const healed = await recover().catch(() => null);
    if (!healed) throw error;
    validate(healed);
    return healed;
  }
}
