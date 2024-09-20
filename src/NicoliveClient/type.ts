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

  readonly provider: NicoliveProvider;

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

export type NicoliveProvider = NicoliveProviderUser | NicoliveProviderOfficial | NicoliveProviderChannel;

export type NicoliveInfoProviderType = NicoliveProvider["type"];

/** ユーザー放送 */
export interface NicoliveProviderUser {
  readonly type: "user";
  /** 放送者ID */
  readonly id: string;
  /** 放送者名 */
  readonly name: string;
};
/** 公式放送 */
export interface NicoliveProviderOfficial {
  readonly type: "official";
  /** チャンネルID */
  readonly id: `ch${string}`;
  /** チャンネル名 */
  readonly name: string;
  /** 会社名 */
  readonly companyName: "株式会社ドワンゴ";
};
/** チャンネル放送 */
export interface NicoliveProviderChannel {
  readonly type: "channel";
  /** チャンネルID */
  readonly id: `ch${string}`;
  /** チャンネル名 */
  readonly name: string;
  /** 会社名 */
  readonly companyName: string;
};

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

