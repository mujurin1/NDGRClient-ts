import { createAbortError, promiser, sleep } from "../lib/utils";
import { connectWsAndAsyncIterable } from "../lib/websocket";
import { type NicoliveStream, type NicoliveWsReceiveMessage, NicoliveWsSendMessage, type NicoliveWsSendPostComment } from "./NicoliveWsType";
import type { NicolivePageData } from "./type";
import { NicoliveAccessDeniedError, NicoliveWebSocketDisconnectError, NicoliveWebSocketReconnectError } from "./utils";

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

export interface WebSocketReconnectData {
  /** 再接続時にはこのメッセージが来ないため必須 */
  readonly messageServerData: MessageServerData;
  /** ウェブソケットURL */
  readonly websocketUrl: string;
  /** 最新の放送の開始/終了時刻 */
  readonly latestSchedule: {
    /** 開始時刻 UNIX TIME (ミリ秒単位) */
    readonly begin: Date;
    /** 終了時刻 UNIX TIME (ミリ秒単位) */
    readonly end: Date;
  };
  /** 再接続する時刻を表すミリ秒 (この時刻までは再接続をしない) */
  readonly reconnectTime: number | undefined;
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
    reconnectData?: WebSocketReconnectData,
    nicolveStream?: NicoliveStream,
  ): Promise<NicoliveWsData> => {
    const reconnect = reconnectData != null;
    let websocketUrl = reconnectData?.websocketUrl ?? pageData.websocketUrl;
    if (websocketUrl === "")
      throw new NicoliveAccessDeniedError(pageData);

    if (reconnect && reconnectData.reconnectTime != null) {
      const waitTimeMs = reconnectData.reconnectTime - Date.now();
      await sleep(waitTimeMs, signal);
    }

    let latestSchedule: ReturnType<NicoliveWsData["getLatestSchedule"]> = reconnectData?.latestSchedule ?? {
      begin: new Date(pageData.beginTime * 1e3),
      end: new Date(pageData.endTime * 1e3),
    };

    signal.addEventListener("abort", aborted);
    const [ws, iteratorSet] = await connectWsAndAsyncIterable<string, NicoliveWsReceiveMessage>(
      websocketUrl,
      onMessage,
      onClose,
    );
    sendStartWatching(ws, reconnect, nicolveStream);

    const messageServerDataPromiser = reconnect ? undefined : promiser<MessageServerData>();
    const messageServerDataPromise = messageServerDataPromiser == null
      ? Promise.resolve(reconnectData!.messageServerData)
      : messageServerDataPromiser.promise;

    return {
      ws,
      iterator: iteratorSet.iterator,
      messageServerDataPromise,
      getWebsocketUrl: () => websocketUrl,
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
      } else if (message.type === "reconnect") {
        websocketUrl = replaceAudienceToken(websocketUrl, message.data.audienceToken);
        iteratorSet.throw(new NicoliveWebSocketReconnectError(message.data));
        ws.close();
      } else if (message.type === "disconnect") {
        iteratorSet.throw(new NicoliveWebSocketDisconnectError(message.data.reason));
      }

      iteratorSet.enqueue(message);
      return message;
    }

    function onClose() {
      signal.removeEventListener("abort", aborted);
      ws.close();
      iteratorSet.close();
    }

    function aborted() {
      messageServerDataPromiser?.reject(createAbortError());
      iteratorSet.throw(createAbortError());
      onClose();
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
   * ウェブソケットURLを取得します\
   * 再接続要求を受け取った時に新しいURLになるためこれが必要です
   */
  getWebsocketUrl(): string;
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

function replaceAudienceToken(websocketUrl: string, audieceToken: string): string {
  const parsedUrl = new URL(websocketUrl);
  const searchParams = parsedUrl.searchParams;
  searchParams.set("audience_token", audieceToken);
  return parsedUrl.toString();
}


// MEMO: バックグラウンドで止まるので使ってない
function _startKeapSeat(ws: WebSocket, sec: number) {
  const id = setInterval(() => send(ws, NicoliveWsSendMessage.keepSeat()), sec * 1e3);
  return () => clearInterval(id);
}
