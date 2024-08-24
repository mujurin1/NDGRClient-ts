
/**
 * 複数種類のイベントへのイベントハンドラーを管理する
 * @template Events イベントの名前とそのイベントハンドラの引数型を持つレコード
 */
export interface IEventEmitter<Events extends Record<string, unknown[]>> {
  /**
   * イベントリスナーを登録する
   * @param event イベント名
   * @param listener イベントリスナー
   */
  on<K extends keyof Events>(event: K, listener: Listener<Events, K>): this;

  /**
   * イベントリスナーを削除する
   * @param event イベント名
   * @param listener イベントリスナー
   */
  off<K extends keyof Events>(event: K, listener: Listener<Events, K>): this;

  /**
   * イベントリスナーを一度だけ実行するように登録する
   * @param event イベント名
   * @param listener イベントリスナー
   */
  once<K extends keyof Events>(event: K, listener: Listener<Events, K>): this;

  /**
   * イベントを実行する
   * @param event イベント名
   * @param args 引数
   * @returns １つでもイベントを実行したか
   */
  emit<K extends keyof Events>(event: K, ...args: Events[K]): boolean;
}

export class EventEmitter<Events extends Record<string, unknown[]>> implements IEventEmitter<Events> {
  private readonly callbacksMap = new Map();

  public static createEmptyEvents<Keys extends string>() {
    return new EventEmitter<Record<Keys, [void]>>();
  }

  public on<K extends keyof Events>(event: K, listener: Listener<Events, K>) {
    let callbacks = this.callbacksMap.get(event);
    if (callbacks === undefined) {
      callbacks = new Set();
      this.callbacksMap.set(event, callbacks);
    }
    callbacks.add(listener);
    return this;
  }

  public off<K extends keyof Events>(event: K, listener: Listener<Events, K>) {
    const callbacks = this.callbacksMap.get(event);
    if (callbacks === undefined)
      return this;
    callbacks.delete(listener);
    if (callbacks.size === 0) {
      this.callbacksMap.delete(event);
    }
    return this;
  }

  public once<K extends keyof Events>(event: K, listener: Listener<Events, K>) {
    const onceListener: typeof listener = (...args) => {
      this.off(event, onceListener);
      listener(...args);
    };

    return this.on(event, onceListener);
  }

  public emit<K extends keyof Events>(event: K, ...args: Events[K]) {
    this._debugCallFromEmit?.(event, args);

    const callbacks = this.callbacksMap.get(event);
    if (callbacks === undefined) {
      return false;
    }
    for (const callback of callbacks) {
      callback(...args);
    }
    return true;
  }

  private _debugCallFromEmit?: (event: keyof Events, data: Events[keyof Events]) => void;
  private _debugCallbacks?: Set<any>;

  /**
   * デバッグ用
   * 
   * 全てのメッセージを受信するイベントを登録する
   */
  public _debugAllOn(
    listener: DebugListener<Events>
  ) {
    if (this._debugCallFromEmit == null) {
      this._debugCallbacks = new Set();
      this._debugCallFromEmit = (event, data) => {
        for (const callbacks of this._debugCallbacks!)
          callbacks({ event, data });
      };
    }

    this._debugCallbacks!.add(listener);
  }
}

type Listener<
  Events extends Record<string, unknown[]>,
  K extends keyof Events,
> = (...args: Events[K]) => void;

type DebugListener<
  Events extends Record<string, unknown[]>,
> = (data: Pack<Events>) => void;

type Pack<Events extends Record<string, unknown[]>> = {
  [K in keyof Events]: { event: K; data: Events[K]; }
}[keyof Events];

