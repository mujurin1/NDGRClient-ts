import { createAbortError, promiser } from "../lib/utils";
import { connectWsAndAsyncIterable } from "../lib/websocket";
import { type NicoliveStream, type NicoliveWsReceiveMessage, NicoliveWsSendMessage, type NicoliveWsSendPostComment } from "./NicoliveWsType";
import type { NicolivePageData } from "./type";
import { NicoliveAccessDeniedError } from "./utils";

/**
 * `NicoliveWsReceiveMessageServer`をパースした情報
 */
export interface MessageServerData {
  /**
   * メッセージサーバ接続先
   */
  readonly viewUri: string;
  /**
   * vpos を計算する基準 (vpos = 0) となる時刻
   */
  readonly vposBaseTime: number;
  /**
   * 匿名コメント投稿時に用いられる自身のユーザ ID (ログインユーザのみ取得可能) \
   * 自身が投稿したコメントかどうかを判別する上で使用可能です
   */
  readonly hashedUserId?: string;
}

/**
 * ニコ生のウェブソケットと通信するための関数郡
 */
export const NicoliveWs = {
  /**
   * ニコ生ウェブソケットと通信するデータを返します\
   * 接続開始メッセージの送信や`pong`/`keepSeat`応答はこの関数が行います
   * @param url WebSocketURL
   * @param signal AbortSignal
   * @param reconnectData 再接続時に必要な情報を渡します
   * @param nicolveStream 映像を受信する場合に指定します
   * @returns ウェブソケット本体やメッセージを取得するストリームを含むオブジェクト
   */
  connectWaitOpened: async (
    pageData: NicolivePageData,
    signal: AbortSignal,
    reconnectData?: MessageServerData,
    nicolveStream?: NicoliveStream,
  ): Promise<NicoliveWsData> => {
    const websocketUrl = pageData.websocketUrl;
    const reconnect = reconnectData != null;
    if (websocketUrl === "")
      throw new NicoliveAccessDeniedError(pageData);

    let latestSchedule: ReturnType<NicoliveWsData["getLatestSchedule"]> = {
      begin: new Date(pageData.beginTime * 1e3),
      end: new Date(pageData.endTime * 1e3),
    };

    signal.addEventListener("abort", aborted);
    const [ws, iteratorSet] = await connectWsAndAsyncIterable<string, NicoliveWsReceiveMessage>(
      websocketUrl,
      onMessage,
      () => signal.removeEventListener("abort", aborted),
    );
    sendStartWatching(ws, reconnect, nicolveStream);

    const messageServerDataPromiser = reconnect ? undefined : promiser<MessageServerData>();
    const messageServerDataPromise = messageServerDataPromiser == null
      ? Promise.resolve<MessageServerData>(reconnectData!)
      : messageServerDataPromiser.promise;

    return {
      ws,
      iterator: iteratorSet.iterator,
      messageServerDataPromise,
      getLatestSchedule: () => latestSchedule,
      send: (message: NicoliveWsSendMessage) => send(ws, message),
      postComment: async (text, isAnonymous, options) => {
        const data = await messageServerDataPromise;
        NicoliveWs.postComment(
          ws,
          Math.round((Date.now() - data.vposBaseTime) / 10),
          text,
          isAnonymous,
          options,
        );
      },
    };

    function onMessage({ data }: MessageEvent<string>): NicoliveWsReceiveMessage {
      const message = parseMessage(data);
      if (message.type === "ping") {
        sendKeepSeatAndPong(ws);
      } else if (message.type === "schedule") {
        latestSchedule = {
          begin: new Date(message.data.begin),
          end: new Date(message.data.end),
        };
      } else if (message.type === "messageServer") {
        const { viewUri, vposBaseTime, hashedUserId } = message.data;
        messageServerDataPromiser?.resolve({
          viewUri,
          vposBaseTime: new Date(vposBaseTime).getTime(),
          hashedUserId,
        });
      }
      return message;
    }

    function aborted() {
      messageServerDataPromiser?.reject(createAbortError());
      iteratorSet.throw(createAbortError());
      ws?.close();
    }
  },
  postComment: (
    ws: WebSocket,
    vpos: number,
    text: string,
    isAnonymous?: boolean,
    options?: Omit<NicoliveWsSendPostComment["data"], "text" | "isAnonymous">,
  ): void => {
    send(ws, NicoliveWsSendMessage.postComment({
      text,
      isAnonymous,
      vpos,
      ...options,
    }));
  },
} as const;

/**
 * ニコ生のウェブソケットと通信するデータ
 */
export interface NicoliveWsData {
  /**
   * 接続しているウェブソケット
   */
  readonly ws: WebSocket;
  /**
   * メッセージを取り出すイテレーター
   */
  readonly iterator: AsyncIterableIterator<NicoliveWsReceiveMessage>;
  /**
   * {@link NicoliveWsReceiveMessageServer} を返すプロミス
   */
  readonly messageServerDataPromise: Promise<MessageServerData>;
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
   */
  send(message: NicoliveWsSendMessage): void;
  /**
   * コメントを投稿します
   */
  postComment(
    text: string,
    isAnonymous?: boolean,
    options?: Omit<NicoliveWsSendPostComment["data"], "text" | "isAnonymous">,
  ): Promise<void>;
}

function parseMessage(data: string): NicoliveWsReceiveMessage {
  return JSON.parse(data) as NicoliveWsReceiveMessage;
}

function send(ws: WebSocket, message: NicoliveWsSendMessage) {
  ws.send(JSON.stringify(message));
}

function sendStartWatching(ws: WebSocket, reconnect?: boolean | undefined, stream?: NicoliveStream) {
  send(ws, NicoliveWsSendMessage.startWatching({ reconnect, stream }));
}

function sendKeepSeatAndPong(ws: WebSocket) {
  send(ws, NicoliveWsSendMessage.pong());
  send(ws, NicoliveWsSendMessage.keepSeat());
}


// MEMO: バックグラウンドで止まるので使ってない
function _startKeapSeat(ws: WebSocket, sec: number) {
  const id = setInterval(() => send(ws, NicoliveWsSendMessage.keepSeat()), sec * 1e3);
  return () => clearInterval(id);
}
