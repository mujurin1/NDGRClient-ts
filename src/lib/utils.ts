import type { Timestamp } from "@bufbuild/protobuf/wkt";

export function timestampToMs(timestamp: Timestamp) {
  return Number(timestamp.seconds) * 1e3 + timestamp.nanos / 1e6;
}

/**
 * `until - preSec`まで待機する
 */
export async function sleepUntil(until: Timestamp, preSec: number = 0) {
  const time = timestampToMs(until) - preSec * 1e3;
  const now = Date.now();
  const ms = time - now;

  await sleep(ms);
}

export async function sleep(ms: number) {
  if (ms <= 0) return;
  return new Promise(res => setTimeout(res, ms));
}

export function promiser<T>(): [Promise<T>, (value: T) => void] {
  let resolver: (value: T) => void = null!;
  const promise = new Promise<T>((resolve => resolver = resolve));
  return [promise, resolver] as const;
}
