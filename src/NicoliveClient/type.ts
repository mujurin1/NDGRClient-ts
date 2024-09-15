import type * as dwango from "../gen/dwango_pb";
import type { IEventEmitter } from "../lib/EventEmitter";
import type { IEventTrigger } from "../lib/EventTrigger";
import type { NicoliveWsReceiveMessage } from "./NicoliveWsClientType";
import type { NicoliveId } from "./utils";

type SafeProperty<T, K extends keyof any> = K extends keyof T ? T[K] : void;

export type NicoliveWsReceiveMessageType = {
  [k in NicoliveWsReceiveMessage["type"]]: [
    SafeProperty<Extract<NicoliveWsReceiveMessage, { type: k; }>, "data">
  ];
};

export type NicoliveClientState = "connecting" | "opened" | "reconnecting" | "reconnect_failed" | "disconnected";

export interface NicoliveInfo {
  readonly liveId: NicoliveId;
  readonly title: string;

  /** 配信者の情報 */
  readonly owner: {
    readonly id: string | undefined;
    readonly name: string;
  };

  readonly loginUser: undefined | {
    readonly id: string;
    readonly name: string;
    readonly isPremium: boolean;
    readonly isBroadcaster: boolean;
    /** isBroadcaster:true の場合でも true ではない */
    readonly isOperator: boolean;
    /** 配信者のクリエイターサポーターになっているか */
    readonly isSupportable: boolean;
  };

  /** 放送者コメントを送るためのトークン */
  readonly postBroadcasterCommentToken: string | undefined;

}

/**
 * ニコ生に接続するクライアント
 */
export interface INicoliveClient {
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
  readonly onMessageEntry: IEventTrigger<[dwango.ChunkedEntry["entry"]["case"]]>;
  /** {@link dwango.nicolive_chat_service_edge_payload_ChunkedMessage} を通知する */
  readonly onMessage: IEventTrigger<[dwango.ChunkedMessage]>;
  /** 過去コメントの: {@link dwango.nicolive_chat_service_edge_payload_ChunkedMessage} を通知する */
  readonly onMessageOld: IEventTrigger<[dwango.ChunkedMessage[]]>;
  //#endregion NicoliveMessageClient 用

  /** 接続するWebSocketURL */
  readonly websocketUrl: string;
  /** 放送に接続しているユーザーID */
  readonly userId?: string;

  /** 放送開始時刻 */
  readonly beginTime: Date;
  /** 放送終了時刻 */
  readonly endTime: Date;
  /** 枠を建てた時刻 UNIX TIME (秒単位) */
  readonly vposBaseTimeMs: number;
  /** 放送やユーザーの情報 */
  readonly info: NicoliveInfo;
  /** 過去コメントを取得中か */
  readonly isFetchingBackwardMessage: boolean;


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
   * 過去メッセージを取得中だった場合に中断してその時点までで取得したメッセージを通知します
   */
  stopFetchBackwardMessages(): void;

  /**
   * 接続を終了します
   */
  close(): void;

  /**
   * 破棄します\
   * 過去コメントの取得ができなくなり、全てのメッセージを送信しなくなります
   */
  dispose(): void;
}

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
export type NicoliveClientLog = {
  info: [NicoliveClientInfo],
  error: [NicoliveClientError],
};

export type NicoliveClientInfo = NicoliveClientAnyInfo | NicoliveClientReconnectInfo;
export interface NicoliveClientAnyInfo {
  type: "any_info";
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
