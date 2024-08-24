import type * as dwango from "../gen/dwango_pb";
import { EventEmitter } from "../lib/EventEmitter";
import { EventTrigger } from "../lib/EventTrigger";
import { NicoliveMessageClient } from "./NicoliveMessageClient";
import { NicoliveWsClient } from "./NicoliveWsClient";
import type { INicoliveClient, NicoliveWsReceiveMessageType } from "./type";
import { type NicoliveId, NicoliveWatchError, getNicoliveId } from "./utils";

export class NicoliveClient implements INicoliveClient {
  public wsClient: NicoliveWsClient;
  public messageClient?: NicoliveMessageClient;

  public readonly onWsState = new EventTrigger<["open" | "reconnecting" | "reconnnected" | "disconnect"]>();
  public readonly onWsMessage = new EventEmitter<NicoliveWsReceiveMessageType>();
  public readonly onMessageState = new EventTrigger<["open" | "disconnect"]>();
  public readonly onMessageEntry = new EventTrigger<[dwango.ChunkedEntry["entry"]["case"] & {}]>();
  public readonly onMessage = new EventTrigger<[dwango.ChunkedMessage]>();
  public readonly onMessageOld = new EventTrigger<[dwango.ChunkedMessage[]]>();

  public readonly liveId: NicoliveId;
  public readonly title: string;
  public readonly userId?: string;
  public readonly ownerId?: number;
  public readonly ownerName: string;

  public websocketUrl: string;
  public beginTime: Date;
  public endTime: Date;

  /**
   * 全ての過去メッセージを受信しているか
   */
  public getAllReceivedBackward(): boolean {
    return this.messageClient?.getAllReceivedBackward() ?? false;
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
    if (!pageData.websocketUrl) {
      throw new NicoliveWatchError(pageData.liveId);
    }

    this.liveId = pageData.liveId;
    this.title = pageData.title;
    this.userId = pageData.userId;
    this.ownerId = pageData.ownerId;
    this.ownerName = pageData.ownerName;
    this.websocketUrl = pageData.websocketUrl;
    this.beginTime = new Date(pageData.beginTime * 1e3);
    this.endTime = new Date(pageData.endTime * 1e3);

    // TODO: fromSec を変える必要があるか調べる
    if (pageData.status === "ENDED") {
      fromSec = Math.floor(this.endTime.getTime() / 1e3);
    }

    this.wsClient = new NicoliveWsClient(this, this.websocketUrl);

    this.onWsMessage
      .on("schedule", data => {
        // MEMO: 公式放送はスケジュールが来ない?
        this.beginTime = new Date(data.begin);
        this.endTime = new Date(data.end);
      })
      .on("messageServer", data => {
        this.messageClient = new NicoliveMessageClient(this, data.viewUri, isSnapshot);

        void this.messageClient.connect(fromSec, minBackwards);
      })
      .on("reconnect", ({ audienceToken, waitTimeSec }) => {
        // MEMO: この関数は全くテストをしていません
        this.websocketUrl = replaceToken(this.websocketUrl, audienceToken);

        setTimeout(() => {
          // this.onWsState.once(message => {
          //   if (message === "reconnnected") { }
          // });

          this.wsClient.close(true);
          this.wsClient = new NicoliveWsClient(
            this,
            this.websocketUrl,
            undefined,
            true,
          );
        }, waitTimeSec * 1e3);
      });

    this.onMessageState
      .on(event => {
        if (event === "disconnect") this.wsClient.close();
      });
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
   * 過去メッセージを取得する
   * @param minBackwards 取得する過去コメントの最低数
   */
  public async fetchBackwardMessages(minBackwards: number) {
    if (this.messageClient == null) return;

    await this.messageClient.fetchBackwardMessages(minBackwards);
  }

  public close() {
    this.wsClient.close();
    this.messageClient?.close();
  }
}

export type NicoliveFetchData = UnwrapPromise<ReturnType<typeof fetchLivePageData>>;




export interface NicolivePageData {
  liveId: NicoliveId;
  title: string;
  ownerId: number | undefined;
  ownerName: string;
  websocketUrl: string | undefined;
  /** 開始時刻 UNIX TIME (秒単位) */
  beginTime: number;
  /** 終了時刻 UNIX TIME (秒単位) */
  endTime: number;
  userId: string | undefined;
  /** RELEASED: 予約中枠, BEFORE_RELEASE: 配信準備中 */
  status: "RELEASED" | "BEFORE_RELEASE" | "ON_AIR" | "ENDED";
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
      liveId: id,
      title: embeddedData.program.title,
      ownerId,
      ownerName: embeddedData.program.supplier.name,
      websocketUrl: throwIsNull(embeddedData.site.relive.webSocketUrl),
      beginTime: throwIsNull(embeddedData.program.beginTime),
      endTime: throwIsNull(embeddedData.program.endTime),
      userId: (embeddedData.user.id ?? undefined) as string | undefined,
      status: embeddedData.program.status,
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

type UnwrapPromise<T> = T extends Promise<infer U> ? U : T;
