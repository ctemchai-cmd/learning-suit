export interface ListSources<Local, Cloud> {
  readLocal: () => Promise<Local>;
  readCloud: () => Promise<Cloud>;
}

/**
 * Reads the IndexedDB side and the cloud list at the same time (the cloud request is the slow one, so it must not wait
 * for IndexedDB). A cloud failure never fails the list: it is reported so the caller can show local work with a warning.
 * A local failure still rejects (nothing sensible can be shown), after the cloud request has been settled.
 */
export async function readListSources<Local, Cloud>({ readLocal, readCloud }: ListSources<Local, Cloud>): Promise<{ local: Local; cloud: Cloud | null }> {
  const cloudRequest = readCloud().then((value) => ({ value }), () => ({ value: null }));
  const [local, cloud] = await Promise.all([readLocal(), cloudRequest]);
  return { local, cloud: cloud.value };
}
