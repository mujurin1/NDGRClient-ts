import { dwango } from "../_protobuf";
import { getProps } from "../lib/utils";
import { NicoliveUtility } from "./NicoliveUtility";
import type { NicoliveCommentColor_Fixed } from "./NicoliveWsType";
import type { NicoliveId, NicoliveInfo, NicolivePageData, NicoliveUserData } from "./type";

export function getNicoliveId(liveIdOrUrl: string): NicoliveId | undefined {
  const liveIdRegex = /.*((lv|ch|user\/)\d+).*/;
  return liveIdRegex.exec(liveIdOrUrl)?.[1] as NicoliveId;
}

export function checkCloseMessage(message?: dwango.ChunkedMessage) {
  return (
    message != null &&
    message.payload.case === "state" &&
    message.payload.value.programStatus?.state === dwango.ProgramStatus_State.Ended
  );
}

// MEMO: 本当は AsyncIterable<AsyncIterable<T>> にしたいけど何故か推論出来ないのでしょうがなく‥
export async function* flattenAsycnIterable<T>(iters: AsyncGenerator<AsyncIterable<T>>): AsyncIterable<T> {
  for await (const iter of iters) {
    for await (const value of iter) {
      yield value;
    }
  }
}

/**
 * 放送ページのデータの解析に失敗した
 */
export class NicolivePageParseError extends Error {
  constructor(
    public readonly url: string,
    public readonly innerError: unknown,
  ) {
    super(`放送ページの解析に失敗しました. url:${url}\n内部エラー:${innerError}`);
    this.name = new.target.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * ニコ生の視聴ページの情報を取得する
 * @param res ニコ生視聴ページをフェッチしたレスポンス
 * @returns ニコ生視聴ページの情報
 */
export async function parseNicolivePageData(res: Response): Promise<NicolivePageData> {
  try {
    const dom = await res.text()
      .then(data => new DOMParser().parseFromString(data, "text/html"));

    const embeddedString = dom
      .getElementById("embedded-data")!
      .getAttribute("data-props")!;
    const embedded = JSON.parse(embeddedString);

    const site = getProps(embedded, "site");
    const program = getProps(embedded, "program");

    const liveId = getProps(program, "nicoliveProgramId");
    const broadcasterCommentToken = getProps(site, "relive", "csrfToken");
    return {
      websocketUrl: getProps(site, "relive", "webSocketUrl"),
      beginTime: getProps(program, "beginTime"),
      endTime: getProps(program, "endTime"),
      status: getProps(program, "status"),

      nicoliveInfo: {
        liveId,
        title: getProps(program, "title"),
        provider: parseProvider(embedded),
        loginUser: parseLoginUser(embedded),
        broadcasterCommentToken: getProps(site, "relive", "csrfToken"),
      },
      postBroadcasterComment,
      deleteBroadcasterComment,
    };

    function postBroadcasterComment(
      text: string,
      name?: string,
      isPermanent?: boolean,
      color?: NicoliveCommentColor_Fixed
    ): Promise<void> {
      return NicoliveUtility.postBroadcasterComment(
        liveId, broadcasterCommentToken,
        text, name, isPermanent, color,
      );
    }
    function deleteBroadcasterComment(): Promise<void> {
      return NicoliveUtility.deleteBroadcasterComment(
        liveId, broadcasterCommentToken,
      );
    }
  } catch (e) {
    throw new NicolivePageParseError(res.url, e);
  }
}

function parseProvider(embedded: any): NicoliveInfo["provider"] {
  const program = getProps(embedded, "program");
  const socialGroup = getProps(embedded, "socialGroup");
  const supplier = getProps(program, "supplier");

  // program.providerType の "community" は "user" として扱う
  const providerType: "community" | "official" | "channel" =
    getProps(program, "providerType");

  if (providerType === "community") {
    return {
      type: "user",
      id: getProps(supplier, "programProviderId") + "",
      name: getProps(supplier, "name"),
    };
  } else if (providerType === "official") {
    return {
      type: "official",
      id: getProps(socialGroup, "id"),
      name: getProps(socialGroup, "name"),
      companyName: getProps(socialGroup, "companyName"),
    };
  } else {
    return {
      type: "channel",
      id: getProps(socialGroup, "id"),
      name: getProps(socialGroup, "name"),
      companyName: getProps(socialGroup, "companyName"),
    };
  }
}

function parseLoginUser(embedded: any): NicoliveUserData | undefined {
  const user = embedded.user; // undefined の可能性有り

  if (user?.isLoggedIn !== true) return undefined;
  const creatorCreatorSupportSummary = getProps(embedded, "creatorCreatorSupportSummary");

  return {
    id: getProps(user, "id") + "",
    name: getProps(user, "nickname"),
    isPremium: getProps(user, "accountType") === "premium",
    isBroadcaster: getProps(user, "isBroadcaster"),
    /** isBroadcaster:true の場合は false */
    isOperator: getProps(user, "isOperator"),
    isSupportable: creatorCreatorSupportSummary?.isSupportable === true,
  };
}
