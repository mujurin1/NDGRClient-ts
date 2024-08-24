import * as protobuf from "@bufbuild/protobuf";
import { BinaryReader } from "@bufbuild/protobuf/wire";

export async function* readProtobufStream<Desc extends protobuf.DescMessage>(uri: string, messageType: Desc) {
  const res = await fetch(uri);

  if (!res.ok || !res.body) throw new NicoliveFetchError(res.status, uri);
  const reader = res.body.getReader();
  const stream = readableStreamToAsyncIterable(reader);

  for await (const data of sizeDelimitedDecodeStream(messageType, stream)) {
    yield data;
  }
}


export function getNicoliveId(liveIdOrUrl: string): NicoliveId | undefined {
  const liveIdRegex = /.*((lv|ch|user\/)\d+).*/;
  return liveIdRegex.exec(liveIdOrUrl)?.[1] as NicoliveId;
}

export type NicoliveId = `${"lv" | "ch" | "user/"}${number}`;



// https://github.com/bufbuild/protobuf-es/blob/main/packages/protobuf/src/wire/size-delimited.ts#L51
// この関数を再実装する必要はない。デバッグに使っただけ
async function* sizeDelimitedDecodeStream<Desc extends protobuf.DescMessage>(
  messageDesc: Desc,
  iterable: AsyncIterable<Uint8Array>,
  options?: protobuf.BinaryReadOptions,
) {
  // append chunk to buffer, returning updated buffer
  function append(buffer: Uint8Array, chunk: Uint8Array): Uint8Array {
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

export async function* readableStreamToAsyncIterable<T>(reader: ReadableStreamDefaultReader<T>) {
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return;
      yield value!;
    }
  } catch {
    throw new NicoliveNetworkError();
  }
}

export class NicoliveFetchError extends Error {
  constructor(public status: number, public uri: string) {
    super(`Failed fetch. status:${status} ${uri}`);

    this.name = new.target.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * 放送を視聴できなかった (TS非公開/権限がない)
 */
export class NicoliveWatchError extends Error {
  constructor(liveId: string | undefined) {
    super(`放送が非公開または視聴権限がありません liveId:${liveId}`);

    this.name = new.target.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** ネットワークが断線したときなど */
export class NicoliveNetworkError extends Error {
  constructor() {
    super("network error");

    this.name = new.target.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

