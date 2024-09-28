import type { Timestamp } from "@bufbuild/protobuf/wkt";

export function timestampToMs(timestamp: Timestamp) {
  return Number(timestamp.seconds) * 1e3 + timestamp.nanos / 1e6;
}

export function throwIsNull<T>(value: T | undefined, errorMessage?: string): T {
  if (value == null) throw new Error(errorMessage);
  return value;
}

export function isAbortError(error: unknown, signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true && error instanceof Error && error.name === "AbortError";
}

export function createAbortError() {
  return new DOMException("操作が中止されました", "AbortError");
}

/**
 * 指定時間後に履行するプロミスを返す\
 * 渡された`signal`がabortすると`AbortError`が発生します
 * @param ms 待機するミリ秒
 * @param signal AbortSignal
 * @returns 
 */
export async function sleep(ms: number, signal?: AbortSignal) {
  const { promise, resolve, reject } = promiser<void>();
  const id = setTimeout(timeouted, ms);
  signal?.addEventListener("abort", aborted);
  return promise;

  function timeouted() {
    signal?.removeEventListener("abort", aborted);
    resolve();
  }

  function aborted() {
    clearInterval(id);
    signal!.removeEventListener("abort", aborted);
    reject(createAbortError());
  }
}

type ResolveType<T> = [T] extends [void] ? () => void : (value: T) => void;
export function promiser<T = void>() {
  let resolve: ResolveType<T> = null!;
  let reject: (reason?: any) => void = null!;
  const promise = new Promise<T>(((res, rej) => [resolve, reject] = [res as ResolveType<T>, rej]));
  return { promise, resolve, reject };
}

/**
 * オブジェクトの階層を辿って値を取得します\
 * プロパティの途中や最終的な値が`undefined`/`null`の場合に例外を投げます
 * @param object 取り出すオブジェクト
 * @param props 辿る階層の名前
 * @returns 
 * @throws 値が`undefined`/`null`だった場合
 */
export function getProps(object: any, ...props: string[]): any {
  for (const prop of props) {
    if (object == null) break;
    object = object[prop];
  }
  return throwIsNull(object, `値が存在しません: ${props.join(".")}`);
}
