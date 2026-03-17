type CacheEntry<T> = {
  data: T;
  timestamp: number;
  revalidating: boolean;
};

const cache = new Map<string, CacheEntry<any>>();

if (typeof window !== 'undefined') {
  (window as any).cache = cache;
}

// const keyAliases = new Map<string, string>(); // alias → canonical
// const keyDependents = new Map<string, Set<string>>(); // dependency → set of keys that depend on it
const FRESH_TIME = 30_000; // 30 seconds - data is fresh, no background check
const STALE_TIME = 10 * 60_000; // 10 minutes - serve stale + background fetch, after this refetch blocking

type CacheState = 'fresh' | 'stale' | 'expired';

function getCacheState(entry: CacheEntry<any>): CacheState {
  const age = Date.now() - entry.timestamp;
  if (age <= FRESH_TIME) return 'fresh';
  if (age <= STALE_TIME) return 'stale';
  return 'expired';
}

// function resolveKey(key: string): string {
//   return keyAliases.get(key) ?? key;
// }

// export function addKeyAlias(canonicalKey: string, aliasKey: string) {
//   keyAliases.set(aliasKey, canonicalKey);
// }

// // Register that `key` depends on `dependencyKey` - when dependencyKey is invalidated, key is too
// export function addCacheDependency(key: string, dependencyKey: string) {
//   const canonicalKey = resolveKey(key);
//   const canonicalDep = resolveKey(dependencyKey);
//   if (!keyDependents.has(canonicalDep)) {
//     keyDependents.set(canonicalDep, new Set());
//   }
//   keyDependents.get(canonicalDep)!.add(canonicalKey);
// }

// let revalidateCallback: (() => void) | null = null;

function triggerBackgroundFetch<T>(
  key: string,
  fetcher: () => Promise<T>,
  existingEntry: CacheEntry<T> | undefined
): void {
  if (existingEntry) {
    existingEntry.revalidating = true;
  }

  fetcher().then(newData => {
    const oldData = existingEntry?.data;
    const changed = !existingEntry || JSON.stringify(newData) !== JSON.stringify(oldData);
    cache.set(key, { data: newData, timestamp: Date.now(), revalidating: false });
    if (changed) {
      revalidate();
    }
  }).catch(() => {
    if (existingEntry) {
      existingEntry.revalidating = false;
    }
  });
}

// export function setRevalidateCallback(cb: (() => void) | null) {
//   revalidateCallback = cb;
// }

export function revalidate() {
  const router = (window as any).agentview.router;
  if (!router) {
    console.error("Router not found, can't revalidate");
    return;
  }
  router.revalidate();
}

export function invalidateByPrefix(prefix: string) {
  // Collect keys first to avoid mutating while iterating
  const keysToInvalidate = [...cache.keys()].filter(key => key.startsWith(prefix));
  for (const key of keysToInvalidate) {
    invalidateCache(key);
  }
}

export async function swr<T>(
  key: string,
  fetcher: () => Promise<T>
): Promise<T> {
  const entry = cache.get(key);

  if (entry) {
    const state = getCacheState(entry);

    if (state === 'fresh') {
      return entry.data;
    }

    if (state === 'stale') {
      if (!entry.revalidating) {
        triggerBackgroundFetch(key, fetcher, entry);
      }
      return entry.data;
    }

    // Expired: fall through to blocking fetch
  }

  console.log('[cache] cache miss: ' + key);
  const data = await fetcher();
  cache.set(key, { data, timestamp: Date.now(), revalidating: false });
  return data;
}

export function swrSync<T>(
  key: string,
  fetcher: () => Promise<T>
): T | null {
  const entry = cache.get(key);

  if (!entry) {
    triggerBackgroundFetch(key, fetcher, undefined);
    return null;
  }

  const state = getCacheState(entry);

  if (state !== 'fresh' && !entry.revalidating) {
    triggerBackgroundFetch(key, fetcher, entry);
  }

  return entry.data;
}

export function invalidateCache(key?: string) {
  if (key) {
    // console.log('[cache] invalidating key: ' + key);
    cache.delete(key);
  } else {
    cache.clear();
  }
}

export function getCachedValue<T>(key: string): T | undefined {
  const entry = cache.get(key);
  return entry?.data;
}

// export function updateCache(key: string, data: any) {)
//   const canonicalKey = resolveKey(key);
//   cache.set(canonicalKey, { data, timestamp: Date.now(), revalidating: false });
// }