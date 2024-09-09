
//#region 送信
/**
 * `NicoliveWsClient`が送信するメッセージ定義
 */
export type NicoliveWsSendMessage =
  | NicoliveWsSendStartWatching
  | NicoliveWsSendKeepSeat
  | NicoliveWsSendGetAkashic
  | NicoliveWsSendChangeStream
  | NicoliveWsSendAnswerEnquete
  | NicoliveWsSendPong
  | NicoliveWsSendPostComment
  | NicoliveWsSendGetTaxonomy
  | NicoliveWsSendGetStreamQualities;

/**
 * 視聴開始時に必要な情報を求めるメッセージ\
 * 成功の場合はストリームやメッセージサーバー情報など複数メッセージが順番で返されます\
 * 失敗の場合はエラーメッセージが返されます
 */
export interface NicoliveWsSendStartWatching {
  type: "startWatching";
  data: {
    /** 映像が必要な時のみ指定する必要がある */
    stream?: NicoliveStream;
    /**
     * 座席再利用するか
     * * 未指定時は `false`
     * * `true`の場合は前回取得したストリームを再利用する
     */
    reconnect?: boolean;
  };
}

/**
 * 座席を維持するためのハートビートメッセージ\
 * WebSocketを維持するためには定期的に送る必要がある
 */
export interface NicoliveWsSendKeepSeat {
  type: "keepSeat";
}

/**
 * 新市場機能. 生放送ゲームを起動するための情報を取得するためのメッセージ\
 * 送信するとサーバからクライアントへ akashic メッセージが返されます
 */
export interface NicoliveWsSendGetAkashic {
  type: "getAkashic";
  data: {
    /** 追っかけ再生かどうか. 未指定時は `false` */
    chasePlay?: boolean;
  };
}

/**
 * 視聴ストリームの送信をサーバーに求めるメッセージ\
 * 有効な視聴セッションが既に存在する場合には再作成してサーバからクライアントへ返します
 */
export interface NicoliveWsSendChangeStream {
  type: "changeStream";
  data: NicoliveWsSendStartWatching["data"]["stream"];
}

/**
 * アンケートの回答を送信するメッセージ
 */
export interface NicoliveWsSendAnswerEnquete {
  type: "answerEnquete";
  data: {
    /** 回答番号  (0から8までのインデックス) */
    answer: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  };
}

/**
 * サーバーから定期的に送られる WebSocket コネクションへの応答メッセージ\
 * コネクション維持のため送信が必要です
 */
export interface NicoliveWsSendPong {
  type: "pong";
}

/**
 * コメント投稿用メッセージ
 */
export interface NicoliveWsSendPostComment {
  type: "postComment";
  data: {
    /**
     * コメントの本文\
     * 通常75文字まで. `isAnonymous:false`のときは1024文字まで
     */
    text: string;
    /**
     * 枠が建ってからのコメントの投稿位置 (0.01 秒単位)\
     * 放送開始ではなく、枠が建ってからの時刻
     */
    vpos: number;
    /**
     * 184で投稿する(`true`)か. 未指定時は`true`
     */
    isAnonymous?: boolean;
    /**
     * コメント色. 未指定時は`"white"`
     */
    color?: NicoliveCommentColor;
    /** コメントサイズ. 未指定時は`medium` */
    size?: NicoliveCommentSize;
    /** コメント位置. 未指定時は`naka` */
    position?: NicoliveCommentPosition;
    /** コメントのフォント. 未指定時は`defont` */
    font?: NicoliveCommentFont;
  };
}

/**
 * 番組のカテゴリ/タグを取得するためのメッセージ\
 * 送信すると {@link NicoliveWsReceiveTaxonomy} メッセージが返されます
 * 
 * 視聴開始時に1回だけ送信し以降は tagUpdated で更新を検知して利用する想定
 */
export interface NicoliveWsSendGetTaxonomy {
  type: "getTaxonomy";
}

/**
 * 視聴可能画質一覧を取得するためのメッセージ\
 * 送信すると {@link NicoliveWsReceiveStreamQualities} メッセージが返されます
 */
export interface NicoliveWsSendGetStreamQualities {
  type: "getStreamQualities";
}
//#endregion 送信



//#region 受信
/**
 * `NicoliveWsClient`が受信するメッセージ定義
 */
export type NicoliveWsReceiveMessage =
  | NicoliveWsReceiveMessageServer
  | NicoliveWsReceiveSeat
  | NicoliveWsReceiveAkashic
  | NicoliveWsReceiveStream
  | NicoliveWsReceiveServerTime
  | NicoliveWsReceiveStatistics_Deprecated
  | NicoliveWsReceiveSchedule
  | NicoliveWsReceivePing
  | NicoliveWsReceiveDisconect
  | NicoliveWsReceiveReconnect
  | NicoliveWsReceivePostCommentResult
  | NicoliveWsReceiveTagUpdated_Deprecated
  | NicoliveWsReceiveTaxonomy
  | NicoliveWsReceiveStreamQualities
  | NicoliveWsReceiveEnquete
  | NicoliveWsReceiveEnqueteresult
  | NicoliveWsReceiveModerator
  | NicoliveWsReceiveRemoveModerator;


/**
 * コメントを取得するためのメッセージサーバの接続先情報を通知するメッセージ
 */
export interface NicoliveWsReceiveMessageServer {
  type: "messageServer";
  data: {
    /** メッセージサーバの接続先 URI */
    viewUri: string;
    /** vpos を計算する基準 (vpos = 0) となる ISO8601 形式の時刻 */
    vposBaseTime: string;
    /**
     * 匿名コメント投稿時に用いられる自身のユーザ ID (ログインユーザのみ取得可能) \
     * 自身が投稿したコメントかどうかを判別する上で使用可能です
     */
    hashedUserId?: string;
  };
}

/**
 * 座席の取得成功を通知するメッセージ\
 * startWatching メッセージへのレスポンスに相当
 */
export interface NicoliveWsReceiveSeat {
  type: "seat";
  data: {
    /**
     * 座席を維持するために送信する keepSeat メッセージの送信間隔時間 (秒)
     */
    keepIntervalSec: number;
  };
}

/**
 * 新市場機能. 生放送ゲームを起動するための情報を通知するメッセージ
 */
export interface NicoliveWsReceiveAkashic {
  type: "akashic";
  /**
   * `status`以外の値は`status:"ready"`の場合のみ存在する\
   * それ以外の場合には`null`
   */
  data: {
    /** Akashicのプレーの状態 */
    status: NicoliveAkashicStatus;
    /** AkashicプレーのID. `status:"ready"`のとき値がある */
    playId?: number;
    /** プレートークン. `status:"ready"`のとき値がある */
    token?: string;
    /** AGV に渡すプレーヤー ID. `status:"ready"`のとき値がある */
    playerId?: number;
    /** AGV に渡す contentUrl (エンジン設定ファイルを取得できる). `status:"ready"`のとき値がある */
    contentUrl?: string;
    /** 接続先となるプレーログサーバー. `status:"ready"`のとき値がある */
    logServerUrl?: string;
  };
}

/**
 * 視聴できるストリームの情報を通知するメッセージ
 */
export interface NicoliveWsReceiveStream {
  type: "stream";
  data: {
    /** ストリーム URI */
    uri: string;
    /**
     * コメントと視聴ストリームの同期のための API の URL (HLS)\
     * uri から取得できるプレイリストの先頭セグメントが 放送サーバに到着した時刻を取得する API\
     * モバイル端末は動画の表示までに時間がかかるためにコメントの描画とずれる問題の対策のためにあります
     */
    syncUri: string;
    /**
     * ストリームの画質タイプ\
     * 再生するストリームがないときに null が返される
     */
    quality?: NicoliveStreamQuality;
    /** 視聴可能なストリームの画質タイプの一覧を表す配列 */
    availableQualities: NicoliveStreamQuality[];
    /** 視聴ストリームのプロトコル. `"hls"`が返される */
    protocol: "hls";
  };
}

/**
 * サーバーの時刻を通知するメッセージ
 */
export interface NicoliveWsReceiveServerTime {
  type: "serverTime";
  data: {
    /** ISO8601 形式のサーバ時刻 (ミリ秒を含む)  */
    currentMs: string;
  };
}

/**
 * 視聴の統計情報を通知するメッセージ\
 * 番組の設定によってはフィールドの値が存在しない場合があります
 *
 * * 将来的には新メッセージサーバから取得できるようになります
 * * 新メッセージサーバから取得できるように変更後このメッセージはアナウンスの上で削除する予定です
 */
export interface NicoliveWsReceiveStatistics_Deprecated {
  type: "statistics";
  data: {
    /** 来場者数 */
    viewers: number;
    /** コメント数 */
    comments: number;
    /** ニコニ広告ポイント数 */
    adPoints: number;
    /** ギフトポイント数 */
    giftPoints: number;
  };

}

/**
 * 放送スケジュールを通知するメッセージ\
 * 放送開始時刻・放送終了時刻が変更された際にも通知されます
 */
export interface NicoliveWsReceiveSchedule {
  type: "schedule";
  data: {
    /** 放送開始時刻 (ISO8601 形式)*/
    begin: string;
    /** 放送終了時刻 (ISO8601 形式)*/
    end: string;
  };
}

/**
 * サーバーから定期的に送られる WebSocket コネクションを維持するための確認メッセージ\
 * コネクション維持のためクライアントからの pong メッセージを必要とします
 */
export interface NicoliveWsReceivePing {
  type: "ping";
}

/**
 * コネクションの切断を通知するメッセージ
 */
export interface NicoliveWsReceiveDisconect {
  type: "disconnect";
  data: {
    /** 切断の理由 */
    reason: NicoliveDisconectReason;
  };
}

/**
 * WebSocket の再接続要求を通知するメッセージ\
 * 受信後再接続処理を必要とします
 */
export interface NicoliveWsReceiveReconnect {
  type: "reconnect";
  data: {
    /**
     * 再接続用トークン\
     * 再接続時に WebSocket の URL のパラメータ audience_token の値をこの値に書き換えてください
     */
    audienceToken: string;
    /**
     * 再接続するまでの待機時間 (秒)\
     * 再接続するまでこの秒数分待機してください
     */
    waitTimeSec: 10;
  };
}

/**
 * コメント送信 ({@link NicoliveWsSendPostComment}) の結果を通知するメッセージ
 */
export interface NicoliveWsReceivePostCommentResult {
  type: "postCommentResult";
  data: {
    chat: {
      /**
       * コマンド\
       * `184` `white` `naka` `medium` など
       */
      mail: string;
      /** 匿名コメントかどうか. 匿名のとき `1` */
      anonymity: 1;
      /** コメント本文 */
      content: string;
      /** コメントを薄く表示するかどうか */
      restricted: boolean;
    };
  };
}

/**
 * タグに更新があったとき新しいリストを通知するメッセージ\
 * 編集されてから通知まで最大 1 分程度かかります
 *
 * * 将来的には新メッセージサーバから取得できるようになります
 * * 新メッセージサーバから取得できるように変更後このメッセージはアナウンスの上で削除する予定です
 */
export interface NicoliveWsReceiveTagUpdated_Deprecated {
  type: "tagUpdated";
  data: {
    tags: {
      /** 更新後の通常タグ */
      items: NicoliveTag[];
      /** タグ編集が可能か */
      ownerLocked: bigint;
    };
  };
}

/**
 * 現在のカテゴリとタグのリストを通知するメッセージ\
 * {@link NicoliveWsSendGetTaxonomy} に対応する応答
 */
export interface NicoliveWsReceiveTaxonomy {
  type: "taxonomy";
  data: {
    categories: {
      /** 番組のカテゴリタグ */
      main: NicoliveCategory[];
      /** 番組のサブカテゴリタグ */
      sub: NicoliveCategory[];
    };
    tags: {
      /** 通常のタグの情報 */
      items: NicoliveTag[];
      /** タグ編集が可能か */
      ownerLocked: boolean;
    };

  };
}

/**
 * 番組で使用できる画質のリストを通知するメッセージ\
 * {@link NicoliveWsSendGetStreamQualities} に対応する応答
 */
export interface NicoliveWsReceiveStreamQualities {
  type: "streamQualities";
  data: {
    /** 番組で視聴可能な最高画質 */
    max: NicoliveStreamQuality[];
    /** 視聴者が選択可能な画質 */
    visible: NicoliveStreamQuality[];
  };
}

export interface NicoliveWsReceiveEnquete {
  type: "enquete";
  data: any;
}

export interface NicoliveWsReceiveEnqueteresult {
  type: "enqueteresult";
  data: any;
}

export interface NicoliveWsReceiveModerator {
  type: "moderator";
  data: any;
}

export interface NicoliveWsReceiveRemoveModerator {
  type: "removeModerator";
  data: any;
}
//#endregion 受信



//
// types
//

export interface NicoliveStream {
  /** 画質 */
  quality: NicoliveStreamQuality;
  /** 画質の制限 (主にabr用. 省略時に無制限)  */
  limit?: NicoliveStreamLimit;
  /** 視聴の遅延 */
  latency: NicoliveStreamLatency;
  /**
   * 追っかけ再生用のストリームを取得するかどうか
   * * 未指定時は `false`
   * * タイムシフトの場合は無視される
   * * 追っかけ再生が無効な番組で true だとエラーになる
   */
  chasePlay?: boolean;
}

export const NicoliveStreamQuality = {
  // 公式チャンネルで利用可能なもの
  // Stream8Mbps1080p60fps: "8Mbps1080p60fps",
  // Stream6Mbps1080p30fps: "6Mbps1080p30fps",
  // Stream4Mbps720p60fps: "4Mbps720p60fps",

  /** アダプティブビットレート */
  abr: "abr",
  /** 3Mbps/720p */
  superHigh: "super_high",
  /** 2Mbps/450p */
  high: "high",
  /** 1Mbps/450p */
  normal: "normal",
  /** 384kbps/288p */
  low: "low",
  /** 192kbps/288p */
  superLow: "super_low",
  /** 音声のみ */
  audioOnly: "audio_only",
  /** 音声のみ (high 相当) */
  audioHigh: "audio_high",
  /**
   * 2Mbps/450p (high 相当) \
   * 放送者専用の画質. 引用時に引用番組の音声を含む. 放送者の音声を含まない
   */
  broadcasterHigh: "broadcaster_high",
  /**
   * 384kbps/288p (low 相当)\
   * 放送者専用の画質. 引用時に引用番組の音声を含む. 放送者の音声を含まない
   */
  broadcasterLow: "broadcaster_low",
} as const;
export type NicoliveStreamQuality = typeof NicoliveStreamQuality[keyof typeof NicoliveStreamQuality];

export const NicoliveStreamLimit = {
  /** 3Mbps/720p */
  super_high: "super_high",
  /** 2Mbps/450p */
  high: "high",
  /** 1Mbps/450p */
  normal: "normal",
  /** 384kbps/288p */
  low: "low",
  /** 192kbps/288p */
  super_low: "super_low",
} as const;
export type NicoliveStreamLimit = typeof NicoliveStreamLimit[keyof typeof NicoliveStreamLimit];

export const NicoliveStreamLatency = {
  /** 低遅延 */
  low: "low",
  /** 高遅延 */
  high: "high",
} as const;
export type NicoliveStreamLatency = typeof NicoliveStreamLatency[keyof typeof NicoliveStreamLatency];

export const NicoliveAkashicStatus = {
  /** Akashic 起動対象の番組かつプレー可能 */
  ready: "ready",
  /** Akashic 起動対象の番組だがプレーがまだ利用できない */
  prepare: "prepare",
  /** Akashic 起動対象の番組ではないまたはプレーができない */
  none: "none",
} as const;
export type NicoliveAkashicStatus = typeof NicoliveAkashicStatus[keyof typeof NicoliveAkashicStatus];

export const NicoliveCommentColor_Fixed = {
  white: "white",
  red: "red",
  pink: "pink",
  orange: "orange",
  yellow: "yellow",
  green: "green",
  cyan: "cyan",
  blue: "blue",
  purple: "purple",
  black: "black",
  // ここから下はプレミアム専用
  white2: "white2",
  red2: "red2",
  pink2: "pink2",
  orange2: "orange2",
  yellow2: "yellow2",
  green2: "green2",
  cyan2: "cyan2",
  blue2: "blue2",
  purple2: "purple2",
  black2: "black2",
} as const;
export type NicoliveCommentColor_Fixed = typeof NicoliveCommentColor_Fixed[keyof typeof NicoliveCommentColor_Fixed];
export type NicoliveCommentColor =
  NicoliveCommentColor_Fixed | `#${string}`;

export const NicoliveCommentSize = {
  /** プレミアム専用 */
  big: "big",
  medium: "medium",
  small: "small",
} as const;
export type NicoliveCommentSize = typeof NicoliveCommentSize[keyof typeof NicoliveCommentSize];
export const NicoliveCommentPosition = {
  /** プレミアム専用 */
  ue: "ue",
  naka: "naka",
  /** プレミアム専用 */
  shita: "shita",
} as const;
export type NicoliveCommentPosition = typeof NicoliveCommentPosition[keyof typeof NicoliveCommentPosition];
export const NicoliveCommentFont = {
  defont: "defont",
  mincho: "mincho",
  gothic: "gothic",
} as const;
export type NicoliveCommentFont = typeof NicoliveCommentFont[keyof typeof NicoliveCommentFont];

export const NicoliveDisconectReason = {
  /** 追い出された */
  takeover: "TAKEOVER",
  /** 座席を取れなかった */
  noPermission: "NO_PERMISSION",
  /** 番組が終了した */
  endProgram: "END_PROGRAM",
  /** 接続生存確認に失敗した */
  pingTimeout: "PING_TIMEOUT",
  /** 同一ユーザからの接続数上限を越えている */
  tooManyConnections: "TOO_MANY_CONNECTIONS",
  /** 同一ユーザの視聴番組数上限を越えている */
  tooManyWatchings: "TOO_MANY_WATCHINGS",
  /** 満席 */
  crowded: "CROWDED",
  /** メンテナンス中 */
  maintenanceIn: "MAINTENANCE_IN",
  /** 上記以外の一時的なサーバエラー */
  serviceTemporarilyUnavailable: "SERVICE_TEMPORARILY_UNAVAILABLE",
} as const;
export type NicoliveDisconectReason = typeof NicoliveDisconectReason[keyof typeof NicoliveDisconectReason];

export interface NicoliveTag {
  /** タグ内容 */
  text: string;
  /** ロックされているか (`true`ならカテゴリ?) */
  locked: false;
  /** 大百科リンク. 記事がない場合は省略される */
  nicopediaArticleUrl?: string;
}

export interface NicoliveCategory {
  /** カテゴリの文字列 */
  text: string;
  /** 大百科リンク. 記事がない場合は省略される */
  nicopediaArticleUrl?: string;
}
