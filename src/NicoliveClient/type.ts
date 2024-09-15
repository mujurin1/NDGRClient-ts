import type { NicoliveWsReceiveMessage } from "./NicoliveWsClientType";
import type { NicoliveId } from "./utils";

export type NicoliveWsReceiveMessageType = {
  [k in NicoliveWsReceiveMessage["type"]]: [
    SafeProperty<Extract<NicoliveWsReceiveMessage, { type: k; }>, "data">
  ];
};

type SafeProperty<T, K extends keyof any> = K extends keyof T ? T[K] : void;


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

