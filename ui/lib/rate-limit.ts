const hits = new Map<string, number[]>();

// 이 앱에서 쓰는 모든 windowMs(60s)보다 넉넉히 큰 값 — 이보다 오래된 키는
// 다시 호출될 일이 없다고 보고 정리 대상으로 삼는다(호출자가 매번 새 값을
// 쓰는 ownerPubkey 등을 키로 삼는 경우 맵이 무한정 누적되는 것을 방지).
const STALE_MS = 10 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
let lastCleanup = Date.now();

function cleanupStaleKeys(now: number) {
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;
  for (const [key, timestamps] of hits) {
    const newest = timestamps[timestamps.length - 1] ?? 0;
    if (now - newest >= STALE_MS) hits.delete(key);
  }
}

export function checkRateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  cleanupStaleKeys(now);
  const timestamps = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (timestamps.length >= limit) {
    hits.set(key, timestamps);
    return false;
  }
  timestamps.push(now);
  hits.set(key, timestamps);
  return true;
}
