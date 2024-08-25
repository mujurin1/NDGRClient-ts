import * as protobuf from "@bufbuild/protobuf";
import * as dwango from "../gen/dwango_pb";
import { sleep } from "../lib/utils";
import type { INicoliveClient } from "./type";
import { readProtobufStream } from "./utils";

/**
 * ニコ生メッセージサーバーと接続するクライアント
 */
export class NicoliveMessageClient {
  private _connecting = false;

  /** このIDのメッセージまで通知しない */
  private _skipTo: string | undefined;

  private _nextAt: bigint | "now" | undefined;
  /** backward, previous を無視するかどうか */
  private _skippingBackwards = false;
  /** 接続を外部から終了する場合に`true`になる */
  private _closeReservation = false;
  /** 過去コメントを取得中か */
  private _fetchingBackwardMessage = false;
  /** 過去メッセージを受信するためのURI */
  private _backwardUri: string | undefined = "--not-connect";


  /**
   * 過去メッセージを受信するためのURI\
   * `undefined`の場合は取得していない過去メッセージがない
   */
  public get backwardUri() { return this._backwardUri; }
  /**
   * コメントを受信する時刻の最終時刻
   */
  public currentNext: bigint | "now" | undefined;

  /**
   * @param receiver メッセージを通知する相手
   * @param uri 接続するURI. `messageServer.data.viewUri`
   * @param isSnapshot 過去メッセージからは状態付きメッセージのみを受信するか
   */
  public constructor(
    private readonly receiver: INicoliveClient,
    private readonly uri: string,
    private readonly isSnapshot: boolean,
  ) { }

  /**
   * ニコ生メッセージ(コメント)サーバーに接続する
   * @param fromSec コメントを取得したい時点の UNIX TIME (秒単位). リアルタイムなら`"now"`を指定
   * @param minBackwards 接続時に取得する過去コメントの最低数
   * @param skipTo 指定したIDのメッセージの次までスキップする (このIDの次のメッセージから通知される)
   */
  public async connect(fromSec: number | "now", minBackwards: number, skipTo?: string) {
    if (this._connecting) throw new Error("すでに接続しています");

    this._closeReservation = false;
    this._skipTo = skipTo;
    this._connecting = true;

    if (typeof fromSec === "string") {
      this._nextAt = fromSec;
    } else {
      const at = Math.floor(fromSec);
      this._nextAt = BigInt(at);
    }

    this.receiver.onMessageState.emit("opened");

    try {
      main: while (this._nextAt != null) {
        this.currentNext = this._nextAt;
        this._nextAt = undefined;

        for await (const entry of readProtobufStream(`${this.uri}?at=${this.currentNext}`, dwango.ChunkedEntrySchema)) {
          if (this._closeReservation) break main;
          await this.receiveEntry(entry, minBackwards);
        }
      }
    } finally {
      this._connecting = false;
      this.receiver.onMessageState.emit("disconnected");
    }
  }

  /**
   * 接続を終了する\
   * 現在取得中のストリームを取り終えるまでは終了しない
   */
  public close() {
    this._closeReservation = true;
  }

  private async receiveEntry({ entry: { case: case_, value } }: dwango.ChunkedEntry, minBackwards: number) {
    this.receiver.onMessageEntry.emit(case_!);

    // entry の配信順序: backward > previous* > segment+ > next?
    if (case_ === "next") {
      // MEMO: 放送終了後の時刻でもnextは来る (24/08/24 現在)
      //       そのため終了しないと永遠と次のチャンクを取得し続けることになる
      this._nextAt = value.at;
    } else if (case_ === "segment") {
      this._skippingBackwards = true;
      // ?at=time 以降のメッセージ (from ~ until 間)
      await this.fetchMessages(value.uri);
    } else if (!this._skippingBackwards) {
      // ?at=time 以前のメッセージ (~ from)
      if (case_ === "backward") {
        this._backwardUri = (this.isSnapshot ? value.snapshot : value.segment)?.uri;

        if (value.segment != null) {
          // 全てのメッセージを取得
          await this.fetchBackwardMessages(minBackwards);
        }
        // こっちは state のみが含まれるメッセージを取得する
        // if(value.snapshot != null) {
        //   await this.fetchMessages(value.snapshot!.uri);
        // }
      } else if (case_ === "previous") {
        // 指定時間のちょっとだけ昔のコメントを取得するためのもの
        await this.fetchMessages(value.uri);
      }
    }
  }

  private receiveMessage(message: dwango.ChunkedMessage) {
    if (this._skipTo != null && message.meta != null) {
      if (this._skipTo === message.meta.id) this._skipTo = undefined;
      return;
    }

    if (this.checkCloseMessage(message)) this.close();

    this.receiver.onMessage.emit(message);
  }

  private receiveMessageOld(messages: dwango.ChunkedMessage[]) {
    for (const message of messages) {
      if (this._skipTo != null && message.meta != null) {
        if (this._skipTo !== message.meta.id) return;
        this._skipTo = undefined;
      }
    }

    const last = messages.at(-1);
    if (this.checkCloseMessage(last)) this.close();

    this.receiver.onMessageOld.emit(messages);
  }

  private checkCloseMessage(message?: dwango.ChunkedMessage) {
    return (
      message != null &&
      message.payload.case === "state" &&
      message.payload.value.programStatus?.state === dwango.ProgramStatus_State.Ended
    );
  }

  private async fetchMessages(uri: string) {
    for await (const msg of readProtobufStream(uri, dwango.ChunkedMessageSchema)) {
      if (this._closeReservation) return;
      this.receiveMessage(msg);
    }
  }

  /**
   * 過去のメッセージを取得する
   * @param minBackwards 取得する過去コメントの最低数
   */
  public async fetchBackwardMessages(minBackwards: number) {
    if (this._fetchingBackwardMessage) return;
    if (this._backwardUri == null) return;
    if (minBackwards === 0) return;

    this._fetchingBackwardMessage = true;

    const buf: dwango.ChunkedMessage[][] = [];
    let length = 0;

    while (true) {
      const resp = await fetch(this._backwardUri);
      const body = new Uint8Array(await resp.arrayBuffer());
      const packed = protobuf.fromBinary(dwango.PackedSegmentSchema, body);

      buf.push(packed.messages);
      length += packed.messages.length;

      // MEMO: こっちは segment ではなく next になっている
      //       途中から snapshot に変えた場合はそれ以降 next の値が snapshot と同じURIになったりする‥？
      this._backwardUri = (this.isSnapshot ? packed.snapshot : packed.next)?.uri;

      if (length >= minBackwards) break;
      if (this._backwardUri == null) break;

      await sleep(7);
    }

    this._fetchingBackwardMessage = false;

    this.receiveMessageOld(buf.reverse().flat());
  }
}
