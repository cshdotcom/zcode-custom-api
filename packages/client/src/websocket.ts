import {
  Emitter,
  VSBuffer,
  SocketProtocol,
  ChannelClient,
  type IMessagePassingProtocol,
  type ISocket,
} from "@zcode/rpc";
import type { IServiceAccessor } from "@zcode/services";
import { RemoteServiceAccess } from "./remoteServiceAccess.js";

export interface WebSocketConnectionCloseEvent {
  code: number;
  reason: string;
  wasClean: boolean;
}

interface WebSocketConnectionOptions {
  onClose?: (event: WebSocketConnectionCloseEvent) => void;
  onOpenSocket?: (socket: WebSocket) => void;
}

function wrapBrowserWebSocket(ws: WebSocket): ISocket {
  const onData = new Emitter<VSBuffer>();
  const onClose = new Emitter<void>();
  const onEnd = new Emitter<void>();

  ws.binaryType = "arraybuffer";
  ws.addEventListener("message", (e) => {
    onData.fire(VSBuffer.wrap(new Uint8Array(e.data as ArrayBuffer)));
  });
  ws.addEventListener("close", () => {
    onClose.fire();
    onEnd.fire();
  });
  ws.addEventListener("error", () => {
    onClose.fire();
    onEnd.fire();
  });

  return {
    onData: onData.event,
    onClose: onClose.event,
    onEnd: onEnd.event,
    write(buffer: VSBuffer) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(buffer.buffer as Uint8Array<ArrayBuffer>);
      }
    },
    end() {
      ws.close();
    },
    drain() {
      return Promise.resolve();
    },
    dispose() {
      ws.close();
    },
  };
}

export function connectViaWebSocket(
  wsUrl: string,
  options?: WebSocketConnectionOptions & {
    /**
     * 等待服务端 ChannelServer Initialize 帧的超时（毫秒）。
     * 服务端在 WS 升级成功后立即发送 Initialize；若超时未收到，说明 WS
     * 数据帧通道被中间层（如预览网关 ALB）静默丢弃，应视为连接失败并降级。
     */
    readyTimeoutMs?: number;
  },
): Promise<IServiceAccessor> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let settled = false;

    const settleFailure = (error: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      try {
        ws.close();
      } catch {
        // ignore
      }
      reject(error);
    };

    ws.addEventListener("error", () => {
      settleFailure(new Error(`WebSocket connection failed: ${wsUrl}`));
    });
    ws.addEventListener("close", (event) => {
      options?.onClose?.({
        code: event.code,
        reason: event.reason,
        wasClean: event.wasClean,
      });

      settleFailure(
        event.reason
          ? new Error(`WebSocket closed before ready: ${event.reason}`)
          : new Error(`WebSocket closed before ready (${event.code})`),
      );
    });

    ws.addEventListener("open", () => {
      const socket = wrapBrowserWebSocket(ws);
      const client = new ChannelClient(new SocketProtocol(socket));

      // 收到服务端 Initialize 帧才确认数据通道双向可用（握手成功 ≠ 数据可达）。
      if (options?.readyTimeoutMs) {
        const readyTimer = setTimeout(() => {
          settleFailure(
            new Error(
              `WebSocket data channel not ready within ${options.readyTimeoutMs}ms (frames likely dropped by gateway)`,
            ),
          );
        }, options.readyTimeoutMs);
        const offInitialized = client.onDidInitialize(() => {
          clearTimeout(readyTimer);
          offInitialized.dispose();
          if (!settled) {
            settled = true;
            options?.onOpenSocket?.(ws);
            resolve(new RemoteServiceAccess(client));
          }
        });
      } else {
        options?.onOpenSocket?.(ws);
        resolve(new RemoteServiceAccess(client));
      }
    });
  });
}

export function connectViaProtocol(protocol: IMessagePassingProtocol): IServiceAccessor {
  const client = new ChannelClient(protocol);
  return new RemoteServiceAccess(client);
}
