type Entry = { expires: number; result: Promise<unknown> };
const reports = new Map<string, Entry>();
export function cachedReport<T>(key: string, load: () => Promise<T>, ttl = 10_000): Promise<T> {
  const current = reports.get(key);
  if (current && current.expires > Date.now()) return current.result as Promise<T>;
  if (reports.size >= 32) reports.delete(reports.keys().next().value!);
  const entry: Entry = { expires: Infinity, result: Promise.resolve().then(load) };
  reports.set(key, entry);
  entry.result.then(() => { entry.expires = Date.now() + ttl; }, () => {
    if (reports.get(key) === entry) reports.delete(key);
  });
  return entry.result as Promise<T>;
}
