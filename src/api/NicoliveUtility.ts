import type { dwango } from "../_protobuf";
import { AsyncIteratorSet } from "../lib/AsyncIteratorSet";
import { promiser } from "../lib/utils";
import { NicoliveMessageServer, type NicoliveEntryAt } from "./NicoliveMessageServer";
import { NicoliveWs, type MessageServerData, type NicoliveWsData } from "./NicoliveWs";
import type { NicoliveCommentColor_Fixed, NicoliveStream, NicoliveWsReceiveMessage } from "./NicoliveWsType";
import type { NicoliveId, NicolivePageData } from "./type";
import { checkCloseMessage, getNicoliveId, parseNicolivePageData } from "./utils";

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
  fetchNicolivePageData: async (liveIdOrUrl: string): Promise<NicolivePageData | undefined> => {
    const liveId = getNicoliveId(liveIdOrUrl);
    if (liveId == null) return;
    const res = await fetch(`https://live.nicovideo.jp/watch/${liveId}`);
    if (!res.ok) return undefined;
    return await parseNicolivePageData(res);
  },
  /**
   * ニコ生ウェブソケットサーバーと通信するオブジェクトを生成します\
   * `messageServer`メッセージを受信してから値を返します
   * @param pageData ニコ生視聴ページの情報
   * @param options メッセージを受信した時に呼び出される関数など
   * @returns ニコ生ウェブソケットサーバーと通信するオブジェクト
   */
  createWsServerConnector: async (
    pageData: NicolivePageData,
    options?: NicoliveWsConnectorOptions,
  ): Promise<NicoliveWsServerConnector> => {
    let connectSet = await createConnectSet(false, undefined);

    return {
      isClosed: () => connectSet.isClosed(),
      getAbortController: () => connectSet.abortController,
      reconnect: async () => {
        if (!connectSet.isClosed()) return;
        const reconnectData = await connectSet.wsData.messageServerDataPromise;
        connectSet = await createConnectSet(true, reconnectData);
      },
      getIterator: () => connectSet.wsData.iterator,
      getWsData: () => connectSet.wsData,
      connectMessageServer: async options => {
        const data = await connectSet.wsData.messageServerDataPromise;
        return connectMessageServer(
          data.viewUri,
          options,
        );
      },
    };

    async function createConnectSet(reconnect: boolean, reconnectData: MessageServerData | undefined) {
      const abortController = new AbortController();
      const wsData = await NicoliveWs.connectWaitOpened(pageData.websocketUrl, abortController.signal, reconnectData, options?.streamMessage);

      return { abortController, wsData, isClosed };

      function isClosed() {
        const readyState = wsData.ws.readyState;
        return (
          readyState === WebSocket.CLOSING ||
          readyState === WebSocket.CLOSED ||
          abortController.signal.aborted
        );
      }
    }
  }
} as const;

/**
 * ニコ生のサーバーと通信するコネクターの基底定義です\
 * 再接続(reconnect)するたびに内部状態が更新され新しい値を返すようにする必要があります
 */
export interface INicoliveServerConnector {
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
   */
  reconnect(options?: NicoliveMessageConnectorOptions): Promise<void>;
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
   * メッセージサーバーと接続します
   * @returns メッセージサーバーと通信しているオブジェクト
   */
  connectMessageServer(options?: NicoliveMessageConnectorOptions): Promise<NicoliveMessageServerConnector>;
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
  readonly getIterator: () => AsyncIterable<dwango.ChunkedMessage>;
  /**
   * 過去メッセージを取得します\
   * 取得できる過去メッセージが無い場合は`undefined`を返します
   * @param delayMs １セグメント取得する毎に待機するミリ秒
   * @param maxSegmentCount 最大で取得するセグメント数
   * @param isSnapshot スナップショットを取るか @default false
   * @returns 
   */
  readonly getBackwardMessages: (
    delayMs: number,
    maxSegmentCount: number,
    isSnapshot?: boolean,
  ) => (
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
}

async function connectMessageServer(
  entryUri: string,
  options?: NicoliveMessageConnectorOptions,
): Promise<NicoliveMessageServerConnector> {
  let connectSet = await createConnectSet(options);

  return {
    isClosed: () => connectSet.messageFetcher.isClosed(),
    getAbortController: () => connectSet.abortController,
    reconnect: async () => {
      if (!connectSet.messageFetcher.isClosed()) return;
      connectSet = await createConnectSet({
        at: connectSet.entryFetcher.getLastEntryAt(),
        skipToMetaId: connectSet.messageFetcher.getLastMeta()?.id,
      });
    },
    getIterator: () => connectSet.messageFetcher.iterator,
    getBackwardMessages: (delayMs, maxSegmentCount, isSnapshot) =>
      connectSet.entryFetcher.getBackwardMessages(delayMs, maxSegmentCount, isSnapshot),
  };

  async function createConnectSet(options: NicoliveMessageConnectorOptions | undefined) {
    const entryAt = options?.at ?? "now";
    const abortController = new AbortController();
    const entryFetcher = await createEntryFetcher(abortController, entryUri, entryAt);
    const messageFetcher = await createServerMessageFetcher(abortController, entryFetcher, options?.skipToMetaId);

    return {
      abortController,
      entryFetcher,
      messageFetcher,
    };
  }
}

interface IFetcher<T> {
  readonly promise: Promise<void>;
  readonly iterator: AsyncIterableIterator<T>;
  isClosed(): boolean;
  close(): void;
}
interface EntryFetcher extends IFetcher<dwango.MessageSegment> {
  getLastEntryAt(): NicoliveEntryAt;
  readonly getBackwardMessages: NicoliveMessageServerConnector["getBackwardMessages"];
}
interface ServerMessageFetcher extends IFetcher<dwango.ChunkedMessage> {
  /**
   * 最後に取得した`dwango.ChunkedMessage_Meta`を取得します
   */
  getLastMeta(): dwango.ChunkedMessage_Meta | undefined;
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
  signal.addEventListener("abort", innerAborter);

  let lastEntryAt: NicoliveEntryAt = entryAt;
  let curretnEntryAt: NicoliveEntryAt | undefined = lastEntryAt;
  let closed = false;
  let backwardSegmentUri: string | undefined;
  let backwardSnapshotUri: string | undefined;
  let fetchingBackwardSegment = false;

  const firstPromiser = promiser();
  const promise = (async () => {
    let receivedSegment = false;
    try {
      let fetchEntry = await NicoliveMessageServer.fetchEntry(entryUri, curretnEntryAt, innerSignal);
      firstPromiser.resolve();

      while (curretnEntryAt != null) {
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
              backwardSegmentUri ??= value.segment?.uri;
              backwardSnapshotUri ??= value.snapshot?.uri;
            } else if (_case === "previous") {
              iteratorSet.enqueue(value);
            }
          }
        }

        if (curretnEntryAt == null) break;
        fetchEntry = await NicoliveMessageServer.fetchEntry(entryUri, curretnEntryAt, innerSignal);
      }
    } catch (e) {
      firstPromiser.reject(e);
      iteratorSet.throw(e);
    } finally {
      closed = true;
      signal.removeEventListener("abort", innerAborter);
      iteratorSet.close();
    }
  })();

  await firstPromiser.promise;

  return {
    promise,
    iterator: iteratorSet.iterator,
    isClosed: () => closed,
    close: innerAborter,
    getLastEntryAt: () => lastEntryAt,
    getBackwardMessages,
  };

  function getBackwardMessages(
    delayMs: number,
    maxSegmentCount: number,
    isSnapshot = false,
  ): ReturnType<EntryFetcher["getBackwardMessages"]> {
    if (fetchingBackwardSegment) return undefined;
    const backwardUri = isSnapshot ? backwardSnapshotUri : backwardSegmentUri;
    if (backwardUri == null) return;
    fetchingBackwardSegment = true;

    const abortController = new AbortController();
    const messagePromise = (async () => {
      const backwards = await NicoliveMessageServer.fetchBackwardMessages(
        backwardUri,
        delayMs,
        maxSegmentCount,
        isSnapshot,
        abortController.signal,
      );

      backwardSegmentUri = backwards.segmentUri;
      backwardSnapshotUri = backwards.snapshotUri;
      return [backwards.messages, backwards.segmentUri != null] as const;
    })();

    fetchingBackwardSegment = false;

    return {
      abortController,
      messagePromise,
    };
  }

  function innerAborter() {
    innerAbort.abort();
  }
}

/**
 * `dwango.MessageSegment`を取得するイテレーターを含むオブジェクトを生成します\
 * `entryFetcher.iterator`が続く限りセグメントメッセージをフェッチし続けます
 * @param abortController AbortController
 * @param entryFetcher EntryFetcher
 * @param skipToMetaId 指定された場合はその次のメッセージからイテレーターで取得できます
 * @returns 最初のメッセージを取得したら値を返します
 */
async function createServerMessageFetcher(
  abortController: AbortController,
  entryFetcher: EntryFetcher,
  skipToMetaId: string | undefined,
): Promise<ServerMessageFetcher> {
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
  signal.addEventListener("abort", innerAborter);

  let closed = false;
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
      // ここまで firstPromiser.resolve を呼ぶためのコード分け

      for await (const segment of entryFetcher.iterator) {
        const { iterator } = await NicoliveMessageServer.fetchMessage(segment.uri, innerSignal);
        for await (const message of iterator) {
          iteratorSet.enqueue(message);
          if (checkCloseMessage(message)) return;
        }
      }
    } catch (e) {
      firstPromiser.reject(e);
      iteratorSet.throw(e);
    } finally {
      closed = true;
      entryFetcher.close();
      signal.removeEventListener("abort", innerAborter);
      iteratorSet.close();
    }
  })();

  await firstPromiser.promise;

  return {
    promise,
    iterator: iteratorSet.iterator,
    isClosed: () => closed,
    close: innerAborter,
    getLastMeta: () => lastMeta,
  };


  function metaFilter(message: dwango.ChunkedMessage) {
    if (message.meta != null) lastMeta = message.meta;
    return true;
  }

  function innerAborter() {
    innerAbort.abort();
  }
};
