// eslint-disable-next-line @typescript-eslint/no-unused-vars
import type { INicoliveClientSubscriber } from "./NicoliveClient";
import type { NicoliveDisconectReason, NicoliveStream, NicoliveWsReceiveMessage, NicoliveWsSendMessage, NicoliveWsSendStartWatching } from "./NicoliveWsClientType";

export class NicoliveWsClient {
  private readonly _ws: WebSocket;

  public isConnect() {
    return (this._ws.readyState === WebSocket.CONNECTING || this._ws.readyState === WebSocket.OPEN);
  }


  /**
   * @param subscriber メッセージを通知する相手
   * @param websocketUrl 接続するWebSocketURL
   * @param nicoliveStream 映像を受信する場合に指定する
   * @param reconnect 再接続の場合は`true`\
   * {@link NicoliveWsSendStartWatching} の`stream`に利用される
   * @default false
   */
  constructor(
    private readonly subscriber: INicoliveClientSubscriber,
    readonly websocketUrl: string,
    private readonly nicoliveStream?: NicoliveStream,
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
    this._ws.send(JSON.stringify(message));
  }

  /**
   * 接続を正常に終了する
   * @param reconnection 再接続するために終了する場合は`true`
   * @param reason 切断理由
   */
  public close(reconnection = false, reason?: NicoliveDisconectReason) {
    if (!this.isConnect()) return;

    this.stopKeepInterval();
    this._ws.onclose = null;
    this._ws.close();

    if (reconnection) this.subscriber.onWsState.emit("reconnecting", undefined);
    else this.subscriber.onWsState.emit("disconnected", reason);
  }

  private readonly onOpen = () => {
    this.subscriber.onWsState.emit("opened", undefined);

    this.send({
      type: "startWatching",
      data: { reconnect: this.reconnect, stream: this.nicoliveStream }
    });
  };

  private readonly onMessage = (e: MessageEvent) => {
    const message = JSON.parse(e.data) as NicoliveWsReceiveMessage;
    this.subscriber.onWsMessage.emit(message.type, (<any>message).data);

    if (message.type === "seat") {
      // setInterval はバックグラウンドで止まるので廃止. 代わりに pong と一緒に送る
      // this.startKeepInterval(message.data.keepIntervalSec);
    } else if (message.type === "ping") {
      this.send({ type: "pong" });
      this.send({ type: "keepSeat" });
    } else if (message.type === "disconnect") {
      this.close(false, message.data.reason);
    }
  };

  private readonly onClose = () => {
    // 接続が正常に終了した場合はこの関数はウェブソケットから呼び出されない
    this.subscriber.onWsState.emit("disconnected", undefined);
    this.stopKeepInterval();
  };

  private keepIntervalId?: number;

  /**
   * 接続を維持するために必要なインターバルを送信する
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
