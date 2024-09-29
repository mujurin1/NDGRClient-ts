import type { dwango } from "../_protobuf";
import { AsyncIteratorSet } from "../lib/AsyncIteratorSet";
import { isAbortError, promiser } from "../lib/utils";
import { NicoliveMessageServer, type NicoliveEntryAt } from "./NicoliveMessageServer";
import { NicoliveWs, type MessageServerData, type NicoliveWsData } from "./NicoliveWs";
import type { NicoliveCommentColor_Fixed, NicoliveStream, NicoliveWsReceiveMessage, NicoliveWsSendMessage, NicoliveWsSendPostComment } from "./NicoliveWsType";
import type { NicoliveId, NicolivePageData } from "./type";
import { checkCloseMessage, NicoliveLiveIdError, NicolivePageNotFoundError, getNicoliveId as parseNicoliveId, parseNicolivePageData } from "./utils";

/**
 * ニコ生と通信する適当な関数郡
 */
export const NicoliveUtility = {
  /**
   * 放送者コメントを投稿します
   * @param liveId 放送ID
   * @param broadcasterCommentToken 放送者コメント投稿トークン
   * @param text コメント本文
   * @param name コメント者名
   * @param isPermanent コメントを永続化 (固定) するか @default false
   * @param color コメント色 @default "black"
   */
  postBroadcasterComment: async (
    liveId: NicoliveId,
    broadcasterCommentToken: string,
    text: string,
    name: string = "",
    isPermanent = false,
    color?: NicoliveCommentColor_Fixed,
  ): Promise<void> => {
    text = encodeURIComponent(text);
    name = encodeURIComponent(name);
    await fetch(`https://live2.nicovideo.jp/unama/api/v3/programs/${liveId}/broadcaster_comment`, {
      "headers": {
        "accept": "application/json",
        "content-type": "application/x-www-form-urlencoded",
        "x-public-api-token": broadcasterCommentToken
      },
      "body": `text=${text}&name=${name}&isPermanent=${isPermanent}&command=${color}`,
      "method": "PUT",
      "credentials": "include"
    });
  },
  /**
   * 放送者の固定コメントを削除します
   * @param liveId 放送ID
   * @param broadcasterCommentToken 放送者コメント投稿トークン
   */
  deleteBroadcasterComment: async (
    liveId: NicoliveId,
    broadcasterCommentToken: string,
  ): Promise<void> => {
    await fetch(`https://live2.nicovideo.jp/unama/api/v3/programs/${liveId}/broadcaster_comment`, {
      "headers": {
        "x-public-api-token": broadcasterCommentToken
      },
      "method": "DELETE",
      "credentials": "include"
    });
  },
  /**
   * ニコ生視聴ページから情報を取得します\
   * 取得に失敗した場合は`undefined`を返します
   * @param liveIdOrUrl 接続する放送ID. `lv*` `ch*` `user/*` を含む文字列
   * @returns ニコ生視聴ページのデータ
   */
  fetchNicolivePageData: (liveIdOrUrl: string): AbortAndPromise<NicolivePageData> => {
    return AbortAndPromise.new(async abortController => {
      const liveId = parseNicoliveId(liveIdOrUrl);
      if (liveId == null) throw new NicoliveLiveIdError(liveIdOrUrl);
      const res = await fetch(`https://live.nicovideo.jp/watch/${liveId}`, { signal: abortController.signal });
      if (!res.ok) throw new NicolivePageNotFoundError(res, liveId);
      return await parseNicolivePageData(res);
    });
  },
  /**
   * ニコ生ウェブソケットサーバーと通信するオブジェクトを生成します\
   * プロミスはウェブソケットが接続してから値を返します
   * @param pageData ニコ生視聴ページの情報
   * @param options NicoliveWsConnectorOptions
   * @returns ニコ生ウェブソケットサーバーと通信するオブジェクトを返すプロミス
   */
  createWsServerConnector: (
    pageData: NicolivePageData,
    options?: NicoliveWsConnectorOptions,
  ): AbortAndPromise<NicoliveWsServerConnector> => {
    return AbortAndPromise.new(async abortController => {
      let connectSet = await createConnectSet(abortController, undefined);

      return {
        getPromise: () => connectSet.promise,
        isClosed: () => connectSet.isClosed(),
        getAbortController: () => connectSet.abortController,
        reconnect: abortController => AbortAndPromise.newA(abortController, async abortController => {
          if (!connectSet.isClosed()) return;
          const reconnectData = await connectSet.wsData.messageServerDataPromise;
          connectSet = await createConnectSet(abortController, reconnectData);
        }),
        getIterator: () => connectSet.wsData.iterator,
        getWsData: () => connectSet.wsData,
        getMessageServerData: () => connectSet.wsData.messageServerDataPromise,
        getLatestSchedule: () => connectSet.wsData.getLatestSchedule(),
        send: message => connectSet.wsData.send(message),
        postComment: (text, isAnonymous, options) => connectSet.wsData.postComment(text, isAnonymous, options),
      };
    });

    async function createConnectSet(abortController: AbortController, reconnectData: MessageServerData | undefined) {
      const wsData = await NicoliveWs.connectWaitOpened(pageData, abortController.signal, reconnectData, options?.streamMessage);
      const { promise, resolve } = promiser();
      wsData.ws.addEventListener("close", onClose);

      return { promise, abortController, wsData, isClosed };

      function isClosed() {
        const readyState = wsData.ws.readyState;
        return (
          readyState === WebSocket.CLOSING ||
          readyState === WebSocket.CLOSED ||
          abortController.signal.aborted
        );
      }

      function onClose() {
        wsData.ws.removeEventListener("close", onClose);
        resolve();
      }
    }
  },
  /**
   * ニコ生メッセージサーバーと通信するオブジェクトを生成します\
   * プロミスはメッセージ受信用のフェッチが成功してから値を返します
   * @param messageServerData `NicoliveWsReceiveMessageServer`
   * @param options NicoliveMessageConnectorOptions
   * @returns ニコ生メッセージサーバーと通信するオブジェクトを返すプロミス
   */
  createMessageServerConnector: (
    messageServerData: MessageServerData,
    options?: NicoliveMessageConnectorOptions,
  ): AbortAndPromise<NicoliveMessageServerConnector> => {
    const entryUri = messageServerData.viewUri;

    return AbortAndPromise.new(async abortController => {
      let connectSet = await createConnectSet(abortController, options);

      return {
        getPromise: () => connectSet.promise,
        isClosed: () => connectSet.entryFetcher.isClosed() && connectSet.messageFetcher.isClosed(),
        getAbortController: () => connectSet.abortController,
        reconnect: abortController => AbortAndPromise.newA(abortController, async abortController => {
          if (!connectSet.entryFetcher.isClosed() || !connectSet.messageFetcher.isClosed()) return;
          connectSet = await createConnectSet(
            abortController,
            {
              at: connectSet.entryFetcher.getLastEntryAt(),
              skipToMetaId: connectSet.messageFetcher.getLastMeta()?.id,
              backwardUri: connectSet.messageFetcher.getBackwardUri(),
            });
        }),
        getIterator: () => connectSet.messageFetcher.iterator,
        getBackwardMessages: (delayMs, maxSegmentCount, isSnapshot) => {
          const res = connectSet.messageFetcher.getBackwardMessages(delayMs, maxSegmentCount, isSnapshot);
          return res;
        },
      };
    });

    async function createConnectSet(abortController: AbortController, options: NicoliveMessageConnectorOptions | undefined) {
      const entryAt = options?.at ?? "now";
      const entryFetcher = await createEntryFetcher(abortController, entryUri, entryAt);
      const backwardUri = options?.backwardUri ?? {
        segment: entryFetcher.backwardSegment.segment?.uri,
        snapshot: entryFetcher.backwardSegment.snapshot?.uri,
      };
      const messageFetcher = await createMessageFetcher(abortController, entryFetcher, options?.skipToMetaId, backwardUri);

      return {
        promise: (async () => { await entryFetcher.promise; await messageFetcher.promise; })(),
        abortController,
        entryFetcher,
        messageFetcher,
      };
    }
  }
} as const;

export interface AbortAndPromise<T> {
  readonly abortController: AbortController;
  readonly promise: Promise<T>;
};
export const AbortAndPromise = {
  new<T>(func: (abortController: AbortController) => Promise<T>): AbortAndPromise<T> {
    const abortController = new AbortController();
    return {
      abortController,
      promise: func(abortController),
    };
  },
  newA<T>(abortController: AbortController | undefined, func: (abortController: AbortController) => Promise<T>): AbortAndPromise<T> {
    abortController ??= new AbortController();
    return {
      abortController,
      promise: func(abortController),
    };
  }
} as const;

/**
 * ニコ生のサーバーと通信するコネクターの基底定義です\
 * 再接続(reconnect)するたびに内部状態が更新され新しい値を返すようにする必要があります
 */
export interface INicoliveServerConnector {
  /**
   * 接続が終了したら履行されます\
   * このプロミスは例外は発生させません
   */
  getPromise(): Promise<void>;
  /**
   * 接続が終了しているか
   */
  isClosed(): boolean;
  /**
   * 接続を終了するためのオブジェクトを取得します
   */
  getAbortController(): AbortController;
  /**
   * 再接続します
   * @param abortController 生成されるコネクターのAbortControllerとして利用されます
   */
  reconnect(abortController?: AbortController): AbortAndPromise<void>;
}
/**
 * ニコ生ウェブソケットサーバーと通信するオブジェクト\
 * 再接続(reconnect)するたびに内部状態が更新され新しい値を返すようになります
 */
export interface NicoliveWsServerConnector extends INicoliveServerConnector {
  /**
   * ニコ生メッセージサーバーからのメッセージを取り出すイテレーターを取得します\
   * 取り出された全てのイテレーターは状態を共有しています
   */
  getIterator(): AsyncIterable<NicoliveWsReceiveMessage>;
  /**
   * ニコ生のウェブソケットと通信するデータを取得します
   */
  getWsData(): NicoliveWsData;
  /**
   * {@link NicoliveWsReceiveMessageServer} を取得します
   */
  getMessageServerData(): Promise<MessageServerData>;
  /**
   * 最新の放送の開始/終了時刻を取得します
   */
  getLatestSchedule(): {
    /** 開始時刻 UNIX TIME (ミリ秒単位) */
    readonly begin: Date;
    /** 終了時刻 UNIX TIME (ミリ秒単位) */
    readonly end: Date;
  };
  /**
   * メッセージを送信します
   * @param message 送信するメッセージ
   */
  send(message: NicoliveWsSendMessage): void;
  /**
   * コメントを投稿します
   * @param text コメント本文
   * @param isAnonymous 匿名か. 未指定時は`true`\
   * ({@link NicoliveWsSendPostComment.data} の`isAnonymous`相当)
   * @param options オプション
   */
  postComment(
    text: string,
    isAnonymous?: boolean,
    options?: Omit<NicoliveWsSendPostComment["data"], "text" | "isAnonymous">,
  ): Promise<void>;
}
/**
 * ニコ生メッセージサーバーと通信するオブジェクト\
 * 再接続(reconnect)するたびに内部状態が更新され新しい値を返すようになります
 */
export interface NicoliveMessageServerConnector extends INicoliveServerConnector {
  /**
   * ニコ生メッセージサーバーからのメッセージを取り出すイテレーターを取得します\
   * 取り出された全てのイテレーターは状態を共有しています
   */
  getIterator(): AsyncIterable<dwango.ChunkedMessage>;
  /**
   * 過去メッセージを取得します\
   * 取得できる過去メッセージが無い場合は`undefined`を返します
   * @param delayMs １セグメント取得する毎に待機するミリ秒
   * @param maxSegmentCount 最大で取得するセグメント数
   * @param isSnapshot スナップショットを取るか @default false
   * @returns 
   */
  getBackwardMessages(
    delayMs: number,
    maxSegmentCount: number,
    isSnapshot?: boolean,
  ): (
      | {
        /**
         * 過去メッセージの取得を中断する\
         * 中断した場合取れたところまで返す
         */
        readonly abortController: AbortController;
        /**
         * [取得した過去メッセージ, まだ過去メッセージが残っているか]
         */
        readonly messagePromise: Promise<readonly [dwango.ChunkedMessage[], boolean]>;
      }
      | undefined
    );
}

export interface NicoliveWsConnectorOptions {
  /**
   * 映像を受信する場合に指定します
   */
  readonly streamMessage?: NicoliveStream;
}
export interface NicoliveMessageConnectorOptions {
  /**
   * 接続開始する時刻
   * @default "now"
   */
  readonly at: NicoliveEntryAt;
  /**
   * 指定された場合はこのメタIDを持つメッセージまでスキップされます
   */
  readonly skipToMetaId?: string;
  /**
   * 指定された場合は次に取得する過去メッセージがこのURIからになります
   */
  readonly backwardUri?: {
    readonly segment: string | undefined;
    readonly snapshot: string | undefined;
  };
}

interface IFetcher<T> {
  /**
   * フェッチが終了したら履行されます\
   * このプロミスは例外は発生させません
   */
  readonly promise: Promise<void>;
  readonly iterator: AsyncIterableIterator<T>;
  isClosed(): boolean;
  /** AbortError を出さずに終了する */
  safeClose(): void;
}
interface EntryFetcher extends IFetcher<dwango.MessageSegment> {
  readonly backwardSegment: dwango.BackwardSegment;
  getLastEntryAt(): NicoliveEntryAt;
}
interface MessageFetcher extends IFetcher<dwango.ChunkedMessage> {
  /**
   * 最後に取得した`dwango.ChunkedMessage_Meta`を取得します
   */
  getLastMeta(): dwango.ChunkedMessage_Meta | undefined;
  readonly getBackwardMessages: NicoliveMessageServerConnector["getBackwardMessages"];
  /**
   * 次に取得する過去メッセージのURIを取得します
   */
  getBackwardUri(): { segment: string | undefined; snapshot: string | undefined; };
}

/**
 * `dwango.MessageSegment`を取得するイテレーターを含むオブジェクトを生成します\
 * next メッセージが続く限りエントリーメッセージをフェッチし続けます
 * @param abortController AbortController
 * @param entryUri メッセージサーバ接続先
 * @param entryAt 取得開始する時刻
 * @returns 最初のメッセージを取得したら値を返します
 */
async function createEntryFetcher(
  abortController: AbortController,
  entryUri: string,
  entryAt: NicoliveEntryAt,
): Promise<EntryFetcher> {
  const signal = abortController.signal;
  const iteratorSet = AsyncIteratorSet.create<dwango.MessageSegment>({
    breaked: () => iteratorSet.close(),
  });

  const innerAbort = new AbortController();
  const innerSignal = innerAbort.signal;
  signal.addEventListener("abort", safeClose);

  let lastEntryAt: NicoliveEntryAt = entryAt;
  let curretnEntryAt: NicoliveEntryAt | undefined = lastEntryAt;
  let closed = false;
  const backwardPromiser = promiser<dwango.BackwardSegment>();

  const promise = (async () => {
    let receivedSegment = false;
    try {
      let fetchEntry = await NicoliveMessageServer.fetchEntry(entryUri, curretnEntryAt, innerSignal);

      while (true) {
        curretnEntryAt = undefined;

        for await (const { entry: { value, case: _case } } of fetchEntry.iterator) {
          if (_case === "next") {
            curretnEntryAt = Number(value.at);
            lastEntryAt = curretnEntryAt;
          } else if (_case === "segment") {
            receivedSegment = true;
            iteratorSet.enqueue(value);
          } else if (!receivedSegment) {
            if (_case === "backward") {
              backwardPromiser.resolve(value);
            } else if (_case === "previous") {
              iteratorSet.enqueue(value);
            }
          }
        }

        if (curretnEntryAt == null) break;
        fetchEntry = await NicoliveMessageServer.fetchEntry(entryUri, curretnEntryAt, innerSignal);
      }
    } catch (e) {
      backwardPromiser.reject(e);
      if (!signal.aborted && !isAbortError(e, innerSignal)) iteratorSet.throw(e);
    } finally {
      closed = true;
      signal.removeEventListener("abort", safeClose);
      iteratorSet.close();
    }
  })();

  return {
    promise,
    iterator: iteratorSet.iterator,
    isClosed: () => closed,
    safeClose,
    getLastEntryAt: () => lastEntryAt,
    backwardSegment: await backwardPromiser.promise,
  };

  function safeClose() {
    closed = true;
    innerAbort.abort();
  }
}

/**
 * `dwango.MessageSegment`を取得するイテレーターを含むオブジェクトを生成します\
 * `entryFetcher.iterator`が続く限りセグメントメッセージをフェッチし続けます
 * @param abortController AbortController
 * @param entryFetcher EntryFetcher
 * @param backwardSegment 次に取得する過去メッセージのURI
 * @param skipToMetaId 指定された場合はその次のメッセージからイテレーターで取得できます
 * @returns 最初のメッセージを取得したら値を返します
 */
async function createMessageFetcher(
  abortController: AbortController,
  entryFetcher: EntryFetcher,
  skipToMetaId: string | undefined,
  backwardUri: { segment: string | undefined, snapshot: string | undefined; },
): Promise<MessageFetcher> {
  const signal = abortController.signal;
  const iteratorSet = AsyncIteratorSet.create<dwango.ChunkedMessage>({
    breaked: () => iteratorSet.close(),
    filter: skipToMetaId == null
      ? metaFilter
      : value => {
        metaFilter(value);
        return value.meta?.id === skipToMetaId ? [false, metaFilter] : false;
      },
  });

  const innerAbort = new AbortController();
  const innerSignal = innerAbort.signal;
  signal.addEventListener("abort", safeClose);

  let closed = false;
  let currentBackwardUri = backwardUri;
  let fetchingBackwardSegment = false;
  let lastMeta: dwango.ChunkedMessage_Meta | undefined;

  const firstPromiser = promiser();
  const promise = (async () => {
    try {
      const { value, done } = await entryFetcher.iterator.next();
      if (done) { firstPromiser.resolve(); return; }
      const { iterator } = await NicoliveMessageServer.fetchMessage(value.uri, innerSignal);
      firstPromiser.resolve();
      for await (const message of iterator) {
        iteratorSet.enqueue(message);
        if (checkCloseMessage(message)) return;
      }
      // ここまで firstPromiser.resolve を呼ぶためのコードわけ

      for await (const segment of entryFetcher.iterator) {
        const { iterator } = await NicoliveMessageServer.fetchMessage(segment.uri, innerSignal);
        for await (const message of iterator) {
          iteratorSet.enqueue(message);
          if (checkCloseMessage(message)) return;
        }
      }
    } catch (e) {
      firstPromiser.reject(e);
      if (!signal.aborted && !isAbortError(e, innerSignal)) iteratorSet.throw(e);
    } finally {
      closed = true;
      entryFetcher.safeClose();
      signal.removeEventListener("abort", safeClose);
      iteratorSet.close();
    }
  })();

  await firstPromiser.promise;

  return {
    promise,
    iterator: iteratorSet.iterator,
    isClosed: () => closed,
    safeClose,
    getLastMeta: () => lastMeta,
    getBackwardMessages,
    getBackwardUri: () => currentBackwardUri,
  };

  function metaFilter(message: dwango.ChunkedMessage) {
    if (message.meta != null) lastMeta = message.meta;
    return true;
  }

  function safeClose() {
    closed = true;
    innerAbort.abort();
  }

  function getBackwardMessages(
    delayMs: number,
    maxSegmentCount: number,
    isSnapshot = false,
  ): ReturnType<MessageFetcher["getBackwardMessages"]> {
    if (fetchingBackwardSegment) return undefined;
    const backwardUri = isSnapshot ? currentBackwardUri.snapshot : currentBackwardUri.segment;
    if (backwardUri == null) return;
    fetchingBackwardSegment = true;

    const abortController = new AbortController();
    const messagePromise = (async () => {
      const backward = await NicoliveMessageServer.fetchBackwardMessages(
        backwardUri,
        delayMs,
        maxSegmentCount,
        isSnapshot,
        abortController.signal,
      );
      currentBackwardUri = { segment: backward.segmentUri, snapshot: backward.snapshotUri };

      if (checkCloseMessage(backward.messages.at(-1))) {
        safeClose();
      }

      const hasNext = currentBackwardUri.segment != null;
      return [backward.messages, hasNext] as const;
    })();

    fetchingBackwardSegment = false;

    return {
      abortController,
      messagePromise,
    };
  }
};
