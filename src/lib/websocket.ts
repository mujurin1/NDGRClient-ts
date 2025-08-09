import { BinaryReader } from "@bufbuild/protobuf/wire";
import { protobuf } from "../_protobuf";
import { AsyncIteratorSet } from "./AsyncIteratorSet";
import { promiser } from "./utils";

/**
 * ウェブソケットのメッセージを取得するイテレーターを生成します\
 * websocketがopenしたら値を返します
 * 
 * ws.oncloseするとイテレーターが終了します
 * abortするとWebSocketを終了します
 * @param url ws.url
 * @param signal AbortSignal
 * @param receiver 受信したデータを加工してストリームに追加します
 * @param onOpen 接続開始時に呼び出されます
 * @returns `AsyncIterableIterator<Data>`
 */
export async function connectWsAndAsyncIterable<
  WsMessage,
  Data = MessageEvent<WsMessage>,
>(
  url: string,
  receiver?: (e: MessageEvent<WsMessage>) => Data,
  closed?: () => void,
): Promise<readonly [WebSocket, AsyncIteratorSet<Data>]> {
  const ws = new WebSocket(url);
  const iteratorSet = AsyncIteratorSet.create<Data>({ breaked: () => iteratorSet.close() });
  const onMessage: (e: MessageEvent<WsMessage>) => void
    = receiver == null
      ? e => iteratorSet.enqueue(e as Data)
      : e => iteratorSet.enqueue(receiver(e));

  const openPromiser = promiser();
  ws.addEventListener("open", openPromiser.resolve);
  ws.addEventListener("message", onMessage);
  ws.addEventListener("close", cleanupAndCloseIter);
  await openPromiser.promise;

  ws.removeEventListener("open", openPromiser.resolve);

  return [ws, iteratorSet];

  function cleanupAndCloseIter(event: CloseEvent) {
    ws.removeEventListener("message", onMessage);
    ws.removeEventListener("close", cleanupAndCloseIter);
    openPromiser.reject(`code:${event.code}  reason:${event.reason}`);
    closed?.();
    iteratorSet.close();
  }
}

/**
 * ストリームの非同期イテレーター
 * @extends
 * ```typescript
 * const res = await fetchStreaming("URI", dwango.ChunkedEntrySchema)
 * for await (const data of res.iterator) {
 *   // data is dwango.ChunkedEntry
 * }
 * // STOPED
 * res.controller.signal.aborted // check aborted
 * ```
 */
export interface ResponseIteratorSet<Desc extends protobuf.DescMessage> {
  /**
   * フェッチのレスポンス
   */
  readonly response: Response;
  /**
   * 内容を取得するイテレーター
   */
  readonly iterator: AsyncIterableIterator<protobuf.MessageShape<Desc>>;
  /**
   * 終了したら履行してエラーが発生したら拒否されるプロミス
   */
  readonly closed: Promise<void>;
}

export const ResponseIteratorSet = {
  /**
   * フェッチしたストリームを非同期イテレーターにして返します
   * @param uri 接続先
   * @param desc 受信するメッセージのprotobuf宣言
   * @param signal AbortSignal
   * @returns `AbortableStreamingData<protobuf.DescMessage>`
   * @extends
   * ```typescript
   * const res = await fetchStreaming("URI", dwango.ChunkedEntrySchema)
   * for await (const data of res.iterator) {
   *   // data is dwango.ChunkedEntry
   * }
   * // STOPED
   * res.controller.signal.aborted // check aborted
   * ```
   */
  fetch: async<Desc extends protobuf.DescMessage>(
    uri: string,
    desc: Desc,
    signal?: AbortSignal,
  ): Promise<ResponseIteratorSet<Desc>> => {
    const res = await fetch(uri, { signal });
    if (res.body == null) throw new Error(`fetchで問題が発生しました\nuri:${uri} status:${res.status}`);
    const reader = res.body.getReader();

    return {
      response: res,
      iterator: readStream(reader, desc),
      closed: reader.closed,
    };
  }
} as const;

export async function* readableStreamToAsyncIterable<T>(
  reader: ReadableStreamDefaultReader<T>
) {
  while (true) {
    const { done, value } = await reader.read();
    if (done) return;
    yield value;
  }
}


export function readStream<Desc extends protobuf.DescMessage>(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  desc: Desc,
): AsyncGenerator<protobuf.MessageShape<Desc>> {
  const iterable = readableStreamToAsyncIterable(reader);
  return sizeDelimitedDecodeStream(desc, iterable);
}

// https://github.com/bufbuild/protobuf-es/blob/main/packages/protobuf/src/wire/size-delimited.ts#L51
// この関数を再実装する必要はない。デバッグに使っただけ
async function* sizeDelimitedDecodeStream<Desc extends protobuf.DescMessage>(
  messageDesc: Desc,
  iterable: AsyncIterable<Uint8Array>,
  options?: protobuf.BinaryReadOptions,
) {
  // append chunk to buffer, returning updated buffer
  function append(buffer: Uint8Array, chunk: Uint8Array): Uint8Array<ArrayBuffer> {
    const n = new Uint8Array(buffer.byteLength + chunk.byteLength);
    n.set(buffer);
    n.set(chunk, buffer.length);
    return n;
  }

  let buffer = new Uint8Array(0);
  for await (const chunk of iterable) {
    buffer = append(buffer, chunk);

    while (buffer.length > 0) {
      // https://github.com/bufbuild/protobuf-es/blob/main/packages/protobuf/src/wire/size-delimited.ts#L107
      const reader = new BinaryReader(buffer);
      const size = reader.uint32();
      const offset = reader.pos;

      if (offset + size > buffer.byteLength) {
        // message is incomplete, buffer more data
        break;
      }

      yield protobuf.fromBinary(
        messageDesc,
        buffer.subarray(offset, offset + size),
        options,
      );

      buffer = buffer.subarray(offset + size);
    }
  }
}
