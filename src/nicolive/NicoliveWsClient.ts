import type { NicoliveStream, NicoliveWsReceiveMessage, NicoliveWsSendMessage, NicoliveWsSendStartWatching } from "./NicoliveWsClientType";
import type { INicoliveClient } from "./type";

export class NicoliveWsClient {
  private readonly _ws: WebSocket;

  /**
   * @param receiver メッセージを通知する相手
   * @param websocketUrl 接続するWebSocketURL
   * @param nicoliveStream 映像を受信する場合に指定する
   * @param reconnect 再接続する場合は`true` @default false
   */
  constructor(
    private readonly receiver: INicoliveClient,
    public readonly websocketUrl: string,
    public readonly nicoliveStream?: NicoliveStream,
    private readonly reconnect = false,
  ) {
    this._ws = new WebSocket(websocketUrl);

    this._ws.onopen = this.onOpen;
    this._ws.onmessage = this.onMessage;
    this._ws.onclose = this.onClose;
  }

  /**
   * メッセージを送信する
   * @param message 送信するメッセージ
   */
  public send(message: NicoliveWsSendMessage) {
    this._ws!.send(JSON.stringify(message));
  }

  /**
   * 接続を正常に終了する
   * @param reconnection 再接続するために終了する場合は`true`
   */
  public close(reconnection = false) {
    if (
      this._ws.readyState === WebSocket.CLOSING ||
      this._ws.readyState === WebSocket.CLOSED
    ) return;

    this.stopKeepInterval();
    this._ws.onclose = null;
    this._ws.close();

    if (reconnection) this.receiver.onWsState.emit("reconnecting");
    else this.receiver.onWsState.emit("disconnect");
  }

  private readonly onOpen = () => {
    if (this.reconnect) this.receiver.onWsState.emit("reconnnected");
    else this.receiver.onWsState.emit("open");

    const message: NicoliveWsSendStartWatching = { type: "startWatching", data: { reconnect: this.reconnect } };
    if (this.nicoliveStream != null) {
      message.data.stream = this.nicoliveStream;
    }

    this.send(message);
  };

  private readonly onMessage = (e: MessageEvent) => {
    const message = JSON.parse(e.data) as NicoliveWsReceiveMessage;
    this.receiver.onWsMessage.emit(message.type, (<any>message).data);

    if (message.type === "seat") {
      this.startKeepInterval(message.data.keepIntervalSec);
    } else if (message.type === "ping") {
      this.send({ type: "pong" });
    } else if (message.type === "disconnect") {
      this.close();
    }
  };

  private readonly onClose = () => {
    // 接続が正常に終了した場合はこの関数はウェブソケットから呼び出されない

    this.receiver.onWsState.emit("disconnect");
    this.stopKeepInterval();
  };

  private keepIntervalId?: number;

  /**
   * 接続を維持するために必要
   * @param keepIntervalSec インターバル秒
   */
  private startKeepInterval(keepIntervalSec: number) {
    const keepIntervalId = setInterval(() => {
      this.send({ type: "keepSeat" });
    }, keepIntervalSec * 1e3);

    this.keepIntervalId = keepIntervalId;
  }

  private stopKeepInterval() {
    if (this.keepIntervalId != null) {
      clearInterval(this.keepIntervalId);
      this.keepIntervalId = undefined;
    }
  }
}

