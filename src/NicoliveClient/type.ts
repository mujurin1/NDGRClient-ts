import type * as dwango from "../gen/dwango_pb";
import type { IEventEmitter } from "../lib/EventEmitter";
import type { IEventTrigger } from "../lib/EventTrigger";
import type { NicoliveMessageClient } from "./NicoliveMessageClient";
import type { NicoliveWsClient } from "./NicoliveWsClient";
import type { NicoliveWsReceiveMessage } from "./NicoliveWsClientType";

type SafeProperty<T, K extends keyof any> = K extends keyof T ? T[K] : void;

export type NicoliveWsReceiveMessageType = {
  [k in NicoliveWsReceiveMessage["type"]]: [
    SafeProperty<Extract<NicoliveWsReceiveMessage, { type: k; }>, "data">
  ];
};

export type NicoliveClientState = "connecting" | "opened" | "reconnecting" | "reconnect_failed" | "disconnected";

/**
 * ニコ生に接続するクライアント
 */
export interface INicoliveClient {
  readonly wsClient: NicoliveWsClient;
  readonly messageClient?: NicoliveMessageClient;

  /**
   * 接続状態
   */
  readonly onState: IEventTrigger<[NicoliveClientState]>;
  /**
   * エラーなど通知が必要なメッセージを通知する
   */
  readonly onLog: IEventEmitter<NicoliveClientLog>;

  //#region NicoliveWsClient 用
  /** ウェブソケットの状態を通知する */
  readonly onWsState: IEventTrigger<["opened" | "reconnecting" | "disconnected"]>;
  /** {@link NicoliveWsReceiveMessage} を通知する */
  readonly onWsMessage: IEventEmitter<NicoliveWsReceiveMessageType>;
  //#endregion NicoliveWsClient 用

  //#region NicoliveMessageClient 用
  /** メッセージサーバーとの接続の状態を通知する */
  readonly onMessageState: IEventTrigger<["opened" | "disconnected"]>;
  /** 受信した {@link dwango.ChunkedEntry} の種類を通知する */
  readonly onMessageEntry: IEventTrigger<[dwango.ChunkedEntry["entry"]["case"] & {}]>;
  /** {@link dwango.nicolive_chat_service_edge_payload_ChunkedMessage} を通知する */
  readonly onMessage: IEventTrigger<[dwango.ChunkedMessage]>;
  /** 過去コメントの: {@link dwango.nicolive_chat_service_edge_payload_ChunkedMessage} を通知する */
  readonly onMessageOld: IEventTrigger<[dwango.ChunkedMessage[]]>;
  //#endregion NicoliveMessageClient 用

  /**
   * 接続するWebSocketURL
   */
  readonly websocketUrl: string;
  /**
   * 放送に接続しているユーザーID
   */
  readonly userId?: string;

  /**
   * 放送開始時刻
   */
  readonly beginTime: Date;
  /**
   * 放送終了時刻
   */
  readonly endTime: Date;


  /**
   * 過去メッセージを取得可能か (全て取得しているか)
   */
  canFetchBackwardMessage(): boolean;

  /**
   * 過去メッセージを取得する
   * @param minBackwards 取得する過去コメントの最低数
   */
  fetchBackwardMessages(minBackwards: number): Promise<void>;

  /**
   * 接続を終了します
   */
  close(): void;
}

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
export type NicoliveClientLog = {
  info: [NicoliveClientInfo],
  error: [NicoliveClientError],
};

export type NicoliveClientInfo = NicoliveClientAnyInfo | NicoliveClientReconnectInfo;
export interface NicoliveClientAnyInfo {
  type: "any";
  message: string;
}
export interface NicoliveClientReconnectInfo {
  type: "reconnect";
  /** 再接続までの待機時間. 値が無い場合は再接続に成功した */
  sec?: number;
}

/**
 * ニコ生クライアントの`onInfo`で通知されるメッセージ\
 * throw されるエラーではない
 */
export type NicoliveClientError = NicoliveClientUnknownError | NicoliveClientNetworkError | NicoliveClientReconnectFailed;
export interface NicoliveClientUnknownError {
  type: "unknown_error";
  error: unknown;
}
export interface NicoliveClientNetworkError {
  type: "network_error";
  error: Error;
}
export interface NicoliveClientReconnectFailed {
  type: "reconnect_failed";
}
