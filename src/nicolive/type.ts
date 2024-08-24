import type * as dwango from "../gen/dwango_pb";
import type { EventEmitter } from "../lib/EventEmitter";
import type { EventTrigger } from "../lib/EventTrigger";
import type { NicoliveMessageClient } from "./NicoliveMessageClient";
import type { NicoliveWsClient } from "./NicoliveWsClient";
import type { NicoliveWsReceiveMessage } from "./NicoliveWsClientType";

type SafeProperty<T, K extends keyof any> = K extends keyof T ? T[K] : void;

export type NicoliveWsReceiveMessageType = {
  [k in NicoliveWsReceiveMessage["type"]]: [
    SafeProperty<Extract<NicoliveWsReceiveMessage, { type: k; }>, "data">
  ];
};

/**
 * ニコ生に接続するクライアント
 */
export interface INicoliveClient {
  readonly wsClient: NicoliveWsClient;
  readonly messageClient?: NicoliveMessageClient;

  //#region NicoliveWsClient 用
  /** ウェブソケットの状態を通知する */
  readonly onWsState: EventTrigger<["open" | "reconnecting" | "reconnnected" | "disconnect"]>;
  /** {@link NicoliveWsReceiveMessage} を通知する */
  readonly onWsMessage: EventEmitter<NicoliveWsReceiveMessageType>;
  //#endregion NicoliveWsClient 用

  //#region NicoliveMessageClient 用
  /** メッセージサーバーとの接続の状態を通知する */
  readonly onMessageState: EventTrigger<["open" | "disconnect"]>;
  /** 受信した {@link dwango.ChunkedEntry} の種類を通知する */
  readonly onMessageEntry: EventTrigger<[dwango.ChunkedEntry["entry"]["case"] & {}]>;
  /** {@link dwango.nicolive_chat_service_edge_payload_ChunkedMessage} を通知する */
  readonly onMessage: EventTrigger<[dwango.ChunkedMessage]>;
  /** 過去コメントの: {@link dwango.nicolive_chat_service_edge_payload_ChunkedMessage} を通知する */
  readonly onMessageOld: EventTrigger<[dwango.ChunkedMessage[]]>;
  //#endregion NicoliveMessageClient 用

  /** 接続するWebSocketURL */
  readonly websocketUrl: string;
  /** 放送に接続しているユーザーID */
  readonly userId?: string;

  /** 放送開始時刻 */
  readonly beginTime: Date;
  /** 放送終了時刻 */
  readonly endTime: Date;

  /**
   * 接続を終了します
   */
  close(): void;
}
