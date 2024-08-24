type Listener<A extends readonly unknown[] = []> = (...arg: A) => void;

/**
 * 1種類のイベントへのイベントハンドラーを管理する
 * @template Args イベントハンドラの引数型
 */
export interface IEventTrigger<Args extends readonly unknown[]> {
  /**
   * イベントリスナーを登録する
   * @param listener イベントリスナー
   */
  on(listener: Listener<Args>): this;

  /**
   * 関数を削除します
   * @param listener イベントリスナー
   */
  off(listener: Listener<Args>): this;

  /**
   * イベントリスナーを一度だけ実行するように登録する
   * @param listener イベントリスナー
   */
  once(listener: Listener<Args>): this;

  /**
   * イベントを実行する
   * @param args 引数
   * @returns １つでもイベントを実行したか
   */
  emit(...args: Args): boolean;
}

export class EventTrigger<Args extends readonly unknown[]> implements IEventTrigger<Args> {
  private readonly callbacksSet = new Set<Listener<Args>>();

  on(listener: Listener<Args>) {
    this.callbacksSet.add(listener);
    return this;
  }

  off(listener: Listener<Args>) {
    this.callbacksSet.delete(listener);
    return this;
  }

  once(listener: Listener<Args>) {
    const onceListener: typeof listener = (...args) => {
      this.off(onceListener);
      listener(...args);
    };

    return this.on(onceListener);
  }

  emit(...args: Args) {
    for (const callback of this.callbacksSet) {
      callback(...args);
    }
    return true;
  }
}
