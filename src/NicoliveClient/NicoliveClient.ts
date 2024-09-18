import type * as dwango from "../gen/dwango_pb";
import { EventEmitter, type IEventEmitter } from "../lib/EventEmitter";
import { EventTrigger, type IEventTrigger } from "../lib/EventTrigger";
import { promiser, sleep } from "../lib/utils";
import { NicoliveMessageClient } from "./NicoliveMessageClient";
import { NicoliveWsClient } from "./NicoliveWsClient";
import type { NicoliveCommentColor_Fixed, NicoliveWsReceiveMessageServer, NicoliveWsReceiveReconnect, NicoliveWsReceiveSchedule, NicoliveWsSendPostComment } from "./NicoliveWsClientType";
import type { NicoliveClientLog, NicoliveInfo, NicoliveWsReceiveMessageType } from "./type";
import { type NicoliveId, NicoliveWatchError, checkCloseMessage, getNicoliveId } from "./utils";


export type NicoliveClientState = "connecting" | "opened" | "reconnecting" | "reconnect_failed" | "disconnected";

/**
 * WsClient, MessageClient に通知してもらう
 */
export interface INicoliveClientSubscriber {
  //#region NicoliveWsClient 用
  /**
   * ウェブソケットの状態を通知する
   */
  readonly onWsState: IEventTrigger<["opened" | "reconnecting" | "disconnected"]>;

  /**
   * {@link NicoliveWsReceiveMessage} を通知する
   */
  readonly onWsMessage: IEventEmitter<NicoliveWsReceiveMessageType>;
  //#endregion NicoliveWsClient 用



  //#region NicoliveMessageClient 用
  /**
   * メッセージサーバーとの接続の状態を通知する
   */
  readonly onMessageState: IEventTrigger<["opened" | "disconnected"]>;

  /**
   * 受信した {@link dwango.ChunkedEntry} の種類を通知する 
   */
  readonly onMessageEntry: IEventTrigger<[dwango.ChunkedEntry["entry"]["case"]]>;

  /**
   * {@link dwango.nicolive_chat_service_edge_payload_ChunkedMessage} を通知する
   */
  readonly onMessage: IEventTrigger<[dwango.ChunkedMessage]>;

  /**
   * 過去コメントの: {@link dwango.nicolive_chat_service_edge_payload_ChunkedMessage} を通知する
   */
  readonly onMessageOld: IEventTrigger<[dwango.ChunkedMessage[]]>;
  //#endregion NicoliveMessageClient 用
}

export type DisconnectType = undefined | "user" | "ws_close" | "message_close" | "reconnect_failed" | "unknown";

export class NicoliveClient implements INicoliveClientSubscriber {
  /**
   * ネットワークエラーが発生した時に再接続するインターバル\
   * 再接続されるまでトライする`n`回目の待機時間`n:value`
   */
  private readonly _reconnectIntervalsSec = [5, 10, 15, 30, 30] as const;
  /** 再接続中か */
  private _reconnecting = false;

  /**
   * 最後に受信したメッセージの情報\
   * 再接続時に使うため
   */
  private _lastFetchMessage: dwango.ChunkedMessage | undefined;

  /** 過去メッセージの取得を中断するか */
  private _stopFetchBackwardMessages = false;


  public onState = new EventTrigger<[NicoliveClientState, DisconnectType]>();
  public readonly onLog = new EventEmitter<NicoliveClientLog>();

  public wsClient: NicoliveWsClient;
  public readonly onWsState = new EventTrigger<["opened" | "reconnecting" | "disconnected"]>();
  public readonly onWsMessage = new EventEmitter<NicoliveWsReceiveMessageType>();

  public messageClient?: NicoliveMessageClient;
  public readonly onMessageState = new EventTrigger<["opened" | "disconnected"]>();
  public readonly onMessageEntry = new EventTrigger<[dwango.ChunkedEntry["entry"]["case"]]>();
  public readonly onMessage = new EventTrigger<[dwango.ChunkedMessage]>();
  public readonly onMessageOld = new EventTrigger<[dwango.ChunkedMessage[]]>();

  public websocketUrl: string;
  public beginTime: Date;
  public endTime: Date;
  public vposBaseTimeMs: number = null!;
  public readonly info: NicoliveInfo;

  public get isFetchingBackwardMessage() {
    return this.messageClient?.isFetchingBackwardMessage ?? false;
  }

  public canFetchBackwardMessage(): boolean {
    return this.messageClient?.backwardUri != null;
  }


  /**
   * @param pageData ニコ生放送ページから取れる情報
   * @param fromSec コメントを取得したい時点の UNIX TIME (秒単位). リアルタイムなら`"now"`を指定
   * @param minBackwards 接続時に取得する過去コメントの最低数. コメント以外のメッセージも含む
   * @param isSnapshot 過去メッセージからは状態付きメッセージのみを受信するか
   */
  constructor(
    pageData: NicolivePageData,
    private readonly fromSec: number | "now",
    private readonly minBackwards: number,
    private readonly isSnapshot: boolean,
  ) {
    this.info = pageData.nicoliveInfo;
    if (!pageData.websocketUrl) {
      throw new NicoliveWatchError(this.info.liveId);
    }

    this.websocketUrl = pageData.websocketUrl;
    this.beginTime = new Date(pageData.beginTime * 1e3);
    this.endTime = new Date(pageData.endTime * 1e3);
    this._stopFetchBackwardMessages = false;

    this.wsClient = new NicoliveWsClient(this, this.websocketUrl);

    //#region Subscribe
    this.onWsMessage
      .on("schedule", this.onSchedule)
      .on("messageServer", this.onMessageServer)
      .on("reconnect", this.onReconnect);

    this.onWsState.on(event => {
      if (event === "disconnected") this.close("ws_close");
    });
    this.onMessageState.on(event => {
      if (event === "opened") this.onState.emit("opened", undefined);
      else this.close("message_close");
    });

    this.onMessage.on(this.onMessage_updateLast);
    this.onMessageOld.on(messages => {
      if (this._lastFetchMessage != null)
        this.onMessage_updateLast(messages.at(-1));
    });
    //#endregion Subscribe

    this.onState.emit("connecting", undefined);
  }
  /**
   * ニコニコ生放送と通信するクライアントを生成します
   * @param liveIdOrUrl 接続する放送ID. `lv*` `ch*` `user/*` を含む文字列
   * @param fromSec コメントを取得したい時点の UNIX TIME (秒単位). リアルタイムなら`"now"`を指定
   * @param minBackwards 接続時に取得する過去コメントの最低数. コメント以外のメッセージも含む
   * @param isSnapshot 過去メッセージからは状態付きメッセージのみを受信するか
   */
  public static async create(liveIdOrUrl: string, fromSec: number | "now", minBackwards: number, isSnapshot: boolean): Promise<NicoliveClient> {
    const liveId = getNicoliveId(liveIdOrUrl);
    if (!liveId) throw new NicoliveWatchError(liveIdOrUrl);
    const pageData = await fetchLivePageData(liveId);

    return new NicoliveClient(pageData, fromSec, minBackwards, isSnapshot);
  };

  /**
   * 視聴者コメントとして投稿する
   * @param text コメント本文
   * @param isAnonymous 匿名にするか. 未指定時は`false`
   * @param options コマンドオプション
   */
  public postComment(text: string, isAnonymous: boolean = false, options?: Omit<NicoliveWsSendPostComment["data"], "text" | "vpos" | "isAnonymous">): void {
    if (this.info.loginUser == null) {
      throw new Error("ログインしていないためコメントの投稿は出来ません");
    }

    this.wsClient.send({
      type: "postComment",
      data: {
        ...options,
        text,
        isAnonymous,
        vpos: Math.round((Date.now() - this.vposBaseTimeMs) / 10),
      }
    });
  }

  /**
   * 放送者コメントとして投稿する
   * @param text コメント本文
   * @param name コメント者名
   * @param isPermanent コメントを永続化 (固定) するか
   * @param command カラー
   */
  public async postBroadcasterComment(text: string, name?: string, isPermanent = false, command?: NicoliveCommentColor_Fixed): Promise<void> {
    if (this.info.owner.id == null || this.info.owner.id !== this.info.loginUser?.id) {
      throw new Error("放送者でないため放送者コメントの投稿は出来ません");
    }

    await fetch(`https://live2.nicovideo.jp/unama/api/v3/programs/${this.info.liveId}/broadcaster_comment`, {
      "headers": {
        "accept": "application/json",
        "content-type": "application/x-www-form-urlencoded",
        "x-public-api-token": this.info.postBroadcasterCommentToken!
      },
      "body": `text=${encodeURIComponent(text)}&name=${name == null ? "" : encodeURIComponent(name)}&isPermanent=${isPermanent}&command=${command}`,
      "method": "PUT",
      "credentials": "include"
    });
  }

  /**
   * 放送者の固定コメントを削除する
   */
  public async deletePermanentComment(): Promise<void> {
    if (this.info.loginUser?.isBroadcaster !== true) {
      throw new Error("放送者でないため放送者コメントの削除は出来ません");
    }

    await fetch(`https://live2.nicovideo.jp/unama/api/v3/programs/${this.info.liveId}/broadcaster_comment`, {
      "headers": {
        "x-public-api-token": this.info.postBroadcasterCommentToken!
      },
      "method": "DELETE",
      "credentials": "include"
    });
  }

  /**
   * 過去メッセージを取得する
   * @param minBackwards 取得する過去メッセージの最低数
   */
  public async fetchBackwardMessages(minBackwards: number): Promise<void> {
    if (this.messageClient == null) return;
    const currentClient = this.messageClient;

    await this.messageClient.fetchBackwardMessages(
      minBackwards,
      () => {
        if (currentClient !== this.messageClient)
          return "abort";
        return this._stopFetchBackwardMessages ? "stop" : "continue";
      },
    );

    this._stopFetchBackwardMessages = false;
  };

  /**
   * 過去メッセージを取得中だった場合に中断してその時点までのメッセージを通知します
   */
  public stopFetchBackwardMessages(): void {
    if (!this.messageClient?.isFetchingBackwardMessage) return;
    this._stopFetchBackwardMessages = true;
  };

  /**
   * 接続を終了します
   * @param description 終了理由
   */
  public close(description: DisconnectType = "user"): void {
    if (this._reconnecting) {
      this.onState.emit("reconnect_failed", description);
    } else {
      this.onState.emit("disconnected", description);
    }

    this.wsClient.close();
    this.messageClient?.close();
  }

  /**
   * 再接続可能(する必要がある)か調べる
   * @returns `true`なら再接続可能
   */
  public canReconnect(): boolean {
    return !this._reconnecting && !checkCloseMessage(this._lastFetchMessage);
  }

  /**
   * ウェブソケットに再接続する
   * @returns 再接続に成功したか
   */
  public async reconnect(): Promise<boolean> {
    if (this.wsClient.isConnect() && this.messageClient?.isConnect() === true) return true;
    if (!this.canReconnect()) return true;

    this._reconnecting = true;
    this.onState.emit("reconnecting", undefined);

    if (await this._reconnectWs()) {
      this.onLog.emit("info", { type: "reconnect" });
      return true;
    } else {
      this._reconnecting = false;
      this.onLog.emit("error", { type: "reconnect_failed" });
      this.close("reconnect_failed");
      return false;
    }
  }

  /**
   * ウェブソケットに再接続する\
   * フラグの変更やメッセージの送信は行わない
   * @returns 再接続に成功したか
   */
  private async _reconnectWs(): Promise<boolean> {
    this.wsClient.close(true);

    this.wsClient = new NicoliveWsClient(
      this,
      this.websocketUrl,
      undefined,
      true
    );

    const [promise, resolver] = promiser<boolean>();
    this.onState.onoff(message => {
      if (message === "opened") resolver(true);
      else if (message === "reconnect_failed") resolver(false);
      else return;

      return true;
    });

    if (await promise) {
      this._reconnecting = false;
      return true;
    } else return false;
  }

  private readonly onSchedule = (data: NicoliveWsReceiveSchedule["data"]): void => {
    // MEMO: 公式放送はスケジュールが来ない?
    this.beginTime = new Date(data.begin);
    this.endTime = new Date(data.end);
  };

  private readonly onMessageServer = (data: NicoliveWsReceiveMessageServer["data"]): void => {
    this.vposBaseTimeMs = new Date(data.vposBaseTime).getTime();

    let fromSec = this.fromSec;
    let minBackwards = this.minBackwards;
    let skipTo: string | undefined;

    // `this._reconnecting === true`なら必ず`this.messageClient != null`
    if (this._reconnecting && this.messageClient != null) {
      // 再接続時には取得する開始の時刻, それ以前は不要 で取得開始する
      fromSec = Number(this._lastFetchMessage!.meta!.at!.seconds);
      // minBackwards:0 だと最後のメッセージがチャンクの最後だった場合に恐らくメッセージを受信できない危惧があるが問題ないと信じている
      minBackwards = 0;
      skipTo = this._lastFetchMessage!.meta!.id;
    } else {
      this.messageClient = new NicoliveMessageClient(this, data.viewUri, this.isSnapshot);
    }

    void this.messageClient.connect(fromSec, minBackwards, skipTo)
      .catch(this.onConnectErrorCatch);
  };

  private readonly onReconnect = ({ audienceToken, waitTimeSec }: NicoliveWsReceiveReconnect["data"]): void => {
    // MEMO: この関数は全くテストをしていません
    this.onLog.emit(
      "info",
      { type: "any_info", message: `ウェブソケットの再接続要求を受け取りました\n${waitTimeSec}秒後にウェブソケットを切断して再接続します` }
    );
    this.websocketUrl = replaceToken(this.websocketUrl, audienceToken);

    setTimeout(() => {
      void this.reconnect();
    }, waitTimeSec * 1e3);
  };

  private readonly onMessage_updateLast = (message?: dwango.ChunkedMessage): void => {
    if (message?.meta?.at == null) return;

    this._lastFetchMessage = message;
  };


  private readonly onConnectErrorCatch = async (error: unknown): Promise<void> => {
    if (error instanceof Error && error.message === "Failed to fetch") {
      // ネットワーク障害時に再接続する
      this._reconnecting = true;

      this.onState.emit("reconnecting", undefined);
      this.wsClient.close(true);

      for (const intervalSec of this._reconnectIntervalsSec) {
        this.onLog.emit("info", { type: "reconnect", sec: intervalSec });
        await sleep(intervalSec * 1e3);

        const succsessed = await this._reconnectWs();

        if (succsessed) {
          this.onLog.emit("info", { type: "reconnect" });
          return;
        }
      }

      this._reconnecting = false;
      this.onLog.emit("error", { type: "reconnect_failed" });
      this.close("reconnect_failed");
    } else {
      this.onLog.emit("error", { type: "unknown_error", error: error });
      this.close("unknown");
      throw error;
    }
  };
}

/**
 * ニコ生視聴ページから取得するデータ
 */
export interface NicolivePageData {
  websocketUrl: string | undefined;
  /** 開始時刻 UNIX TIME (秒単位) */
  beginTime: number;
  /** 終了時刻 UNIX TIME (秒単位) */
  endTime: number;
  /** RELEASED: 予約中枠, BEFORE_RELEASE: 配信準備中 */
  status: "RELEASED" | "BEFORE_RELEASE" | "ON_AIR" | "ENDED";

  nicoliveInfo: NicoliveInfo;
}

async function fetchLivePageData(id: NicoliveId): Promise<NicolivePageData> {
  const res = await fetch(`https://live.nicovideo.jp/watch/${id}`);
  if (!res.ok) throw new NicoliveWatchError(id);

  let data: NicolivePageData;

  try {
    const dom = await res.text()
      .then(data => new DOMParser().parseFromString(data, "text/html"));

    const embeddedString = dom
      .getElementById("embedded-data")!
      .getAttribute("data-props")!;
    const embeddedData = JSON.parse(embeddedString);

    const ownerIdString = embeddedData.program.supplier.programProviderId;
    let ownerId: string | undefined;
    if (ownerIdString != null) ownerId = ownerIdString + "";

    data = {
      websocketUrl: throwIsNull(embeddedData.site.relive.webSocketUrl, "embeddedData.site.relive.webSocketUrl が存在しません"),
      beginTime: throwIsNull(embeddedData.program.beginTime, "embeddedData.program.beginTime が存在しません"),
      endTime: throwIsNull(embeddedData.program.endTime, "embeddedData.program.endTime が存在しません"),
      status: embeddedData.program.status,

      nicoliveInfo: {
        liveId: embeddedData.program.nicoliveProgramId,
        title: embeddedData.program.title,
        owner: {
          id: ownerId,
          name: embeddedData.program.supplier.name,
        },
        loginUser: embeddedData.user?.isLoggedIn !== true
          ? undefined
          : {
            id: embeddedData.user.id + "",
            name: embeddedData.user.nickname,
            isPremium: embeddedData.user.accountType === "premium",
            isBroadcaster: embeddedData.user.isBroadcaster,
            /** isBroadcaster:true の場合は false */
            isOperator: embeddedData.user.isOperator,
            isSupportable: embeddedData.creatorCreatorSupportSummary?.isSupportable === true,
          },
        postBroadcasterCommentToken: embeddedData.site.relive.csrfToken,
      }
    };
  } catch {
    throw new NicoliveWatchError(id);
  }

  return data;
}

/**
 * URLの`audience_token`を変更した新しいURLを返します
 * @param websocketUrl 書き換え元のURL
 * @param audienceToken 新しいトークン
 */
function replaceToken(websocketUrl: string, audienceToken: string) {
  // `wss://a.live2.nicovideo.jp/unama/wsapi/v2/watch/[0-9]+?audience_token=${audienceToken}`
  return websocketUrl.replace(/audience_token=.*$/, `audience_token=${audienceToken}`);
}

function throwIsNull<T>(value: T | undefined, error?: string): T {
  if (value == null) throw new Error(error);
  return value;
}
