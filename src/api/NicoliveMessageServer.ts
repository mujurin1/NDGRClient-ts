import type { GenMessage } from "@bufbuild/protobuf/codegenv1";
import { dwango, protobuf } from "../_protobuf";
import { isAbortError, sleep } from "../lib/utils";
import { ResponseIteratorSet } from "../lib/websocket";

export type NicoliveEntryAt = number | "now";

/**
 * ニコ生のメッセージサーバーと通信するための関数郡
 */
export const NicoliveMessageServer = {
  /**
   * エントリーチャンクを取得するイテレーターを返します
   * @param entryUri 接続先
   * @param at 取得するコメントの時刻
   * @param signal AbortSignal
   */
  fetchEntry: (
    entryUri: string,
    at: NicoliveEntryAt,
    signal?: AbortSignal,
  ): Promise<ResponseIteratorSet<GenMessage<dwango.ChunkedEntry>>> => {
    return ResponseIteratorSet.fetch(`${entryUri}?at=${at}`, dwango.ChunkedEntrySchema, signal);
  },
  /**
   * メッセージチャンクを取得するイテレーターを返します
   * @param messageUri 接続先
   * @param signal AbortSignal
   */
  fetchMessage: (
    messageUri: string,
    signal?: AbortSignal,
  ): Promise<ResponseIteratorSet<GenMessage<dwango.ChunkedMessage>>> => {
    return ResponseIteratorSet.fetch(messageUri, dwango.ChunkedMessageSchema, signal);
  },
  /**
   * 過去コメントを取得します\
   * abrotで中断した場合はそこまでのメッセージを返します
   * @param backwardUri 接続先
   * @param delayMs １セグメント取得する毎に待機するミリ秒
   * @param maxSegmentCount 取得するセグメントの最大数
   * @param isSnapshot スナップショットを取るか
   * @param signal AbortSignal
   */
  fetchBackwardMessages: async (
    backwardUri: string,
    delayMs: number,
    maxSegmentCount: number,
    isSnapshot: boolean,
    signal?: AbortSignal,
  ): Promise<NicoliveBackwardResponse> => {
    if (maxSegmentCount <= 0) maxSegmentCount = Number.MAX_SAFE_INTEGER;

    const buf: dwango.ChunkedMessage[][] = [];
    let nextUri: string | undefined = backwardUri;
    let segmentUri: string | undefined;
    let snapshotUri: string | undefined;

    try {
      while (true) {
        const res = await fetch(nextUri, { signal });

        const body = new Uint8Array(await res.arrayBuffer());
        const packed = protobuf.fromBinary(dwango.PackedSegmentSchema, body);
        segmentUri = packed.next?.uri;
        snapshotUri = packed.snapshot?.uri;
        nextUri = isSnapshot ? snapshotUri : segmentUri;
        buf.push(packed.messages);

        if (nextUri == null || buf.length >= maxSegmentCount) break;
        await sleep(delayMs, signal);
      }
    } catch (e) {
      if (!isAbortError(e, signal)) throw e;
    }

    const messages = buf.reverse().flat();
    return { messages, segmentUri, snapshotUri };
  },
} as const;

/**
 * ニコ生の過去メッセージ
 */
export interface NicoliveBackwardResponse {
  /**
   * 取得したメッセージ
   */
  readonly messages: dwango.ChunkedMessage[];
  /**
   * 次の過去メッセージを取得するURI
   */
  readonly segmentUri: string | undefined;
  /**
   * 次の過去メッセージを取得するURI (スナップショット)
   */
  readonly snapshotUri: string | undefined;
}
