
/**
 * 非同期イテレーターとそれに値を渡す関数
 */
export interface AsyncIteratorSet<T> {
  readonly iterator: AsyncIterableIterator<T>;
  /**
   * イテレーターの末尾に値を追加します\
   * イテレーターが終了している場合は何もしません
   */
  enqueue(value: T): void;
  /**
   * イテレーターにエラーを渡します
   */
  throw(reason?: any): void;
  /**
   * イテレーターを終了します
   */
  close(): void;
}

type Filter<T> = (value: T) => (boolean | readonly [boolean, Filter<T> | undefined]);
export interface AsyncIteratorSetOption<T> {
  /**
   * `enqueue`時に値を取り除くフィルター関数\
   * `true`の場合に値を保持します
   * @param value 追加される値
   * @returns `true`の場合に値を保持します\
   * タプルの場合は１つ目が保持するか、２つ目が次から使用される新しいフィルターになります
   */
  readonly filter?: Filter<T>;
  /**
   * イテレーターが`break;`したら実行する関数
   */
  readonly breaked?: () => void;
}

export const AsyncIteratorSet = {
  /**
   * 外部から値をキューに追加出来る非同期イテレーター\
   * abortした後に読み出すと`AbortError`が発生します
   * @param option AsyncIteratorSetOption
   */
  create: <T>(option?: AsyncIteratorSetOption<T>): AsyncIteratorSet<T> => {
    let resolveNext: ((value: IteratorResult<T>) => void) | undefined;
    let rejectNext: ((e: Error) => void) | undefined;
    let state: STATE = "iterating";
    let error: Error;
    const queue: T[] = [];
    let filter = option?.filter;

    const iterable = {
      next(): Promise<IteratorResult<T>> {
        if (queue.length > 0) return Promise.resolve({ value: queue.shift()!, done: false });
        if (state === "iterating") return nextPromise();
        if (state === "closed") return Promise.resolve({ value: undefined as any, done: true });
        throw error;
      },
      [Symbol.asyncIterator]() {
        return iterable;
      },
      return() {
        // MEMO: close/abort した後は呼び出す必要は無い (はず)
        if (state === "iterating") option?.breaked?.();
        return Promise.resolve({ value: undefined as any, done: true });
      },
    };

    return { iterator: iterable, enqueue, throw: throwError, close };

    function nextPromise() {
      return new Promise<IteratorResult<T>>((resolve, reject) => {
        resolveNext = resolve;
        rejectNext = reject;
      });
    }

    function enqueue(value: T): void {
      if (state !== "iterating") return;
      if (filter != null) {
        let res = filter(value);
        if (res === false) return;
        if (res === true) { }
        else {
          [res, filter] = res;
          if (!res) return;
        }
      }

      queue.push(value);
      if (resolveNext != null) {
        resolveNext({ value: queue.shift()!, done: false });
        resolveNext = undefined;
      }
    }
    function throwError(reason: Error) {
      if (state !== "iterating") return;
      finishIterating("error", reason);
    };
    function close() {
      finishIterating("closed");
    }

    function finishIterating(newStae: "closed"): void;
    function finishIterating(newStae: "error", e: Error): void;
    function finishIterating(newState: STATE, e?: Error): void {
      if (state !== "iterating") return;

      state = newState;
      if (newState === "closed") {
        if (resolveNext != null) resolveNext({ value: undefined, done: true });
      } else {
        error = e!;
        if (rejectNext != null) rejectNext(error);
      }
    }

    type STATE = "iterating" | "closed" | "error";
  },
} as const;
