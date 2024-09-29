import type { NicoliveCommentColor_Fixed, NicoliveWsReceiveMessage } from "./NicoliveWsType";

type NicoliveWsReceiveMessageType = {
  [k in NicoliveWsReceiveMessage["type"]]: [
    SafeProperty<Extract<NicoliveWsReceiveMessage, { type: k; }>, "data">
  ];
};

type SafeProperty<T, K extends keyof any> = K extends keyof T ? T[K] : void;


export type NicoliveId = `${"lv" | "ch" | "user/"}${number}`;

/**
 * ニコ生のユーザー情報
 */
export interface NicoliveUserData {
  readonly id: string;
  readonly name: string;
  /** プレミアムか */
  readonly isPremium: boolean;
  /** 配信者かどうか */
  readonly isBroadcaster: boolean;
  /** isBroadcaster:true の場合は`false`になります */
  readonly isOperator: boolean;
  /** 配信者のクリエイターサポーターになっているか */
  readonly isSupportable: boolean;
};
/** ニコ生のユーザー情報 (生主) */
export type NicoliveUserData_Owner = NicoliveUserData & { isBroadcaster: true; };
/** ニコ生のユーザー情報 (リスナー) */
export type NicoliveUserData_Listener = NicoliveUserData & { isBroadcaster: false; };

/**
 * ニコ生視聴ページの情報\
 * 放送ページフェッチ時の値なことに注意
 */
export interface NicolivePageData {
  /** ウェブソケットの接続先URL */
  readonly websocketUrl: string;
  /** 開始時刻 UNIX TIME (秒単位) */
  readonly beginTime: number;
  /** 終了時刻 UNIX TIME (秒単位) */
  readonly endTime: number;
  /** `RELEASED`: 予約中, `BEFORE_RELEASE`: 配信準備中 */
  readonly status: "RELEASED" | "BEFORE_RELEASE" | "ON_AIR" | "ENDED";
  /** 生放送の情報 */
  readonly nicoliveInfo: NicoliveInfo;

  /**
   * 放送者コメントを投稿します
   * @param text コメント本文
   * @param name コメント者名
   * @param isPermanent コメントを永続化 (固定) するか @default false
   * @param color コメント色 @default "black"
   */
  postBroadcasterComment(
    text: string,
    name?: string,
    isPermanent?: boolean,
    color?: NicoliveCommentColor_Fixed
  ): Promise<void>;
  /**
   * 放送者コメントを削除します
   */
  deleteBroadcasterComment(): Promise<void>;
}

/**
 * 生放送の情報
 */
export interface NicoliveInfo {
  /** 放送ID (lv) */
  readonly liveId: NicoliveId;
  /** 放送タイトル */
  readonly title: string;
  /** 放送の情報 */
  readonly provider: NicoliveProvider;
  /** ログインしてるユーザーの情報 */
  readonly loginUser: undefined | NicoliveUserData;

  /** 放送者コメントを送るためのトークン */
  readonly broadcasterCommentToken: string | undefined;
}

/**
 * 放送の情報
 */
export type NicoliveProvider = NicoliveProviderUser | NicoliveProviderOfficial | NicoliveProviderChannel;
export type NicoliveInfoProviderType = NicoliveProvider["type"];

/**
 * ユーザー放送
 */
export interface NicoliveProviderUser {
  readonly type: "user";
  /** 放送者ID */
  readonly id: string;
  /** 放送者名 */
  readonly name: string;
};
/**
 * 公式放送
 */
export interface NicoliveProviderOfficial {
  readonly type: "official";
  /** チャンネルID */
  readonly id: `ch${string}`;
  /** チャンネル名 */
  readonly name: string;
  /** 会社名 */
  readonly companyName: "株式会社ドワンゴ";
};
/**
 * チャンネル放送
 */
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

