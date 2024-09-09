import type * as dwango from "../gen/dwango_pb";
import { EventEmitter } from "../lib/EventEmitter";
import { EventTrigger } from "../lib/EventTrigger";
import { promiser, sleep } from "../lib/utils";
import { NicoliveMessageClient } from "./NicoliveMessageClient";
import { NicoliveWsClient } from "./NicoliveWsClient";
import type { NicoliveCommentColor_Fixed, NicoliveWsSendPostComment } from "./NicoliveWsClientType";
import type { INicoliveClient, NicoliveClientLog, NicoliveClientState, NicoliveInfo, NicoliveWsReceiveMessageType } from "./type";
import { type NicoliveId, NicoliveWatchError, getNicoliveId } from "./utils";


export class NicoliveClient implements INicoliveClient {
  private _disposed = false;
  /**
   * ネットワークエラーが発生した時に再接続するインターバル\
   * 再接続されるまでトライする`n`回目の待機時間`n:value`
   */
  private readonly _reconnectIntervalsSec = [5, 10, 15, 30, 30] as const;
  /** 再接続中か */
  private _reconnecting = false;

  /**
   * 最後に受信したメッセージ\
   * 再接続時に使うため
   */
  private _lastFetchMessage: dwango.ChunkedMessage | undefined;

  /** 過去メッセージの取得を中断するか */
  private _stopFetchBackwardMessages = false;


  public onState = new EventTrigger<[NicoliveClientState]>();
  public wsClient: NicoliveWsClient;
  public messageClient?: NicoliveMessageClient;

  public readonly onWsState = new EventTrigger<["opened" | "reconnecting" | "disconnected"]>();
  public readonly onLog = new EventEmitter<NicoliveClientLog>();

  public readonly onWsMessage = new EventEmitter<NicoliveWsReceiveMessageType>();
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
    fromSec: number | "now",
    minBackwards: number,
    isSnapshot: boolean,
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

    /** 再接続時に取得するメッセージの時刻. UNIX TIME (秒単位) */
    let reconnectTime: bigint | "now" | undefined;

    this.onState.emit("connecting");

    this.onWsMessage
      .on("schedule", data => {
        // MEMO: 公式放送はスケジュールが来ない?
        this.beginTime = new Date(data.begin);
        this.endTime = new Date(data.end);
      })
      .on("messageServer", data => {
        let skipTo: string | undefined;
        this.vposBaseTimeMs = new Date(data.vposBaseTime).getTime();

        // `this._reconnecting === true`なら必ず`this.messageClient != null`
        if (!this._reconnecting || this.messageClient == null) {
          this.messageClient = new NicoliveMessageClient(this, data.viewUri, isSnapshot);
        } else {
          // 再接続時には取得する開始の時刻, それ以前は不要 で取得開始する
          if (typeof reconnectTime === "bigint") fromSec = Number(reconnectTime);
          minBackwards = 1; // 0 だと最後のメッセージがチャンクの最後だった場合に恐らくメッセージを受信できない
          skipTo = this._lastFetchMessage?.meta?.id;
        }

        this.messageClient.connect(fromSec, minBackwards, skipTo)
          .catch(async (e: unknown) => {
            if (!(e instanceof Error)) {
              this.onLog.emit("error", { type: "unknown_error", error: e });
              throw e;
            }

            if (e.message === "Failed to fetch") {
              // ネットワーク障害時に再接続する
              this._reconnecting = true;
              reconnectTime = this.messageClient!.currentNext;

              this.onState.emit("reconnecting");
              this.wsClient.close(true);

              for (const intervalSec of this._reconnectIntervalsSec) {
                this.onLog.emit("info", { type: "reconnect", sec: intervalSec });
                await sleep(intervalSec * 1e3);

                const succsessed = await this.reconnect();

                if (succsessed) {
                  this.onLog.emit("info", { type: "reconnect" });
                  return;
                }
              }

              this.onLog.emit("error", { type: "reconnect_failed" });
              this.close();
            } else throw e;
          });
      })
      .on("reconnect", ({ audienceToken, waitTimeSec }) => {
        // MEMO: この関数は全くテストをしていません
        this.onLog.emit(
          "info",
          { type: "any", message: `ウェブソケットの再接続要求を受け取りました\n${waitTimeSec * 1e3}秒後にウェブソケットを切断して再接続します` }
        );
        this.websocketUrl = replaceToken(this.websocketUrl, audienceToken);

        setTimeout(async () => {
          this._reconnecting = true;
          this.onState.emit("reconnecting");

          if (await this.reconnect()) {
            this.onLog.emit("info", { type: "reconnect" });
          } else {
            this.onLog.emit("error", { type: "reconnect_failed" });
            this.close();
          }
        }, waitTimeSec * 1e3);
      });

    this.onWsState.on(event => {
      if (event === "disconnected") this.close();
    });
    this.onMessageState.on(event => {
      if (event === "opened") this.onState.emit("opened");
      else this.close();
    });

    this.onMessage.on(message => this._lastFetchMessage = message);
    this.onMessageOld.on(messages => this._lastFetchMessage = messages.at(-1));
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
  }

  /**
   * 視聴者コメントとして投稿する
   * @param text コメント本文
   * @param isAnonymous 匿名にするか. 未指定時は`false`
   * @param options コマンドオプション
   */
  public postComment(text: string, isAnonymous: boolean = false, options?: Omit<NicoliveWsSendPostComment["data"], "text" | "vpos" | "isAnonymous">) {
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
  public async postBroadcasterComment(text: string, name?: string, isPermanent = false, command?: NicoliveCommentColor_Fixed) {
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
  public async deletePermanentComment() {
    if (this.info.owner.id == null || this.info.owner.id !== this.info.loginUser?.id) {
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

  public async fetchBackwardMessages(minBackwards: number) {
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
  }

  public stopFetchBackwardMessages() {
    if (!this.messageClient?.isFetchingBackwardMessage) return;
    this._stopFetchBackwardMessages = true;
  }

  public close() {
    if (this._reconnecting) {
      this.onState.emit("reconnect_failed");
    } else {
      this._reconnecting = false;
      this.onState.emit("disconnected");
    }

    this.wsClient.close();
    this.messageClient?.close();
  }

  public dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this.close();
    this.messageClient = undefined;
  }

  /**
   * ウェブソケットに再接続する
   * @returns 再接続に成功したか
   */
  private async reconnect() {
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
    let ownerId: number | undefined;
    if (ownerIdString != null) ownerId = +ownerIdString;

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
            id: +embeddedData.user.id,
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
