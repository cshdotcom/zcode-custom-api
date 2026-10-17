/**
 * HTTP 长轮询 RPC 传输 —— 预览网关（ALB）丢弃 WebSocket 数据帧时的降级通道。
 *
 * 背景：外网预览域名经阿里云 ALB 回源到沙箱。实测 WS 握手(101)可透传，
 * 但升级后的数据帧被静默丢弃（浏览器/node 双端复现：发帧零回包、
 * readyState 恒为 OPEN），普通 HTTP 请求完全正常。
 *
 * 因此用三条普通 HTTP 请求承载消息级 RPC：
 *   - POST /api/channel          创建通道（服务端建 ChannelServer 立即回 Initialize）
 *   - POST /api/channel/:id/up   上行一条完整消息（body = VSBuffer 字节）
 *   - GET  /api/channel/:id/down 长轮询下行帧（204 = 等待超时无帧）
 *
 * 下行多帧拼接格式与服务端 encodeDownlinkFrames 一致：
 *   [u32 BE payload 长度][payload]...
 */
import {
  ChannelClient,
  Emitter,
  VSBuffer,
  type IMessagePassingProtocol,
} from "@zcode/rpc";
import { RemoteServiceAccess } from "./remoteServiceAccess.js";
import type { IServiceAccessor } from "@zcode/services";

const LONG_POLL_TIMEOUT_MS = 30_000; // 略大于服务端 25s 挂起超时，覆盖网络开销
const POLL_ERROR_BACKOFF_MS = 500;
const READY_TIMEOUT_MS = 10_000;

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

class HttpPollingProtocol implements IMessagePassingProtocol {
  private readonly messageEmitter = new Emitter<VSBuffer>();
  readonly onMessage = this.messageEmitter.event;
  private stopped = false;
  private inFlight = 0;

  constructor(private readonly channelId: string) {}

  send(buffer: VSBuffer): void {
    if (this.stopped) {
      return;
    }
    // 上行失败不 throw（RPC 层无法处理同步错误）；down 轮询持续进行，
    // 若通道被服务端回收会以 404 通知上层关闭。
    void fetch(`/api/channel/${this.channelId}/up`, {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: buffer.buffer as Uint8Array<ArrayBuffer>,
      keepalive: false,
    }).catch(() => {
      // 网络抖动：down 侧长时间无 Initialize/响应时由调用方超时兜底
    });
  }

  start(): void {
    void this.pollLoop();
  }

  stop(): void {
    this.stopped = true;
  }

  private async pollLoop(): Promise<void> {
    while (!this.stopped) {
      if (this.inFlight > 2) {
        // 上行 POST 偶发慢于 down 轮询时避免无界并发
        await delay(50);
        continue;
      }
      try {
        this.inFlight += 1;
        const response = await fetch(`/api/channel/${this.channelId}/down`, {
          cache: "no-store",
        });
        this.inFlight -= 1;
        if (this.stopped) {
          return;
        }
        if (response.status === 204) {
          continue; // 服务端等待超时，无帧，立即开始下一轮
        }
        if (response.status === 404) {
          // 通道已被服务端 GC，协议层停止即可；上层 RPC 会以 dispose 收尾
          this.stopped = true;
          this.messageEmitter.dispose();
          return;
        }
        if (!response.ok) {
          await delay(POLL_ERROR_BACKOFF_MS);
          continue;
        }
        const payload = new Uint8Array(await response.arrayBuffer());
        for (const frame of parseFrames(payload)) {
          this.messageEmitter.fire(VSBuffer.wrap(frame));
        }
      } catch {
        this.inFlight -= 1;
        if (this.stopped) {
          return;
        }
        await delay(POLL_ERROR_BACKOFF_MS);
      }
    }
  }
}

function* parseFrames(payload: Uint8Array): Generator<Uint8Array> {
  let offset = 0;
  while (offset + 4 <= payload.byteLength) {
    const view = new DataView(payload.buffer, payload.byteOffset + offset, 4);
    const length = view.getUint32(0, false);
    offset += 4;
    if (offset + length > payload.byteLength) {
      return; // 不完整帧（正常不会发生：服务端一次请求内拼完整帧）
    }
    yield payload.subarray(offset, offset + length);
    offset += length;
  }
}

/**
 * 通过 HTTP 长轮询通道建立 RPC 服务访问器。
 * 通道创建后等待服务端 Initialize 帧确认双向数据面可用，超时抛错。
 */
export async function connectViaHttpChannel(
  channelEndpoint = "/api/channel",
): Promise<IServiceAccessor> {
  const created = await fetch(channelEndpoint, { method: "POST" });
  if (!created.ok) {
    throw new Error(`HTTP channel create failed: ${created.status}`);
  }
  const { channelId } = (await created.json()) as { channelId: string };
  if (!channelId) {
    throw new Error("HTTP channel create response missing channelId");
  }

  const protocol = new HttpPollingProtocol(channelId);
  const client = new ChannelClient(protocol);

  // 服务端建 ChannelServer 时立即 sendResponse(Initialize)；down 轮询拿到它
  // 即证明 HTTP 数据面双向可用。
  await new Promise<void>((resolveReady, rejectReady) => {
    const timer = setTimeout(() => {
      offInitialized.dispose();
      protocol.stop();
      rejectReady(new Error(`HTTP channel not ready within ${READY_TIMEOUT_MS}ms`));
    }, READY_TIMEOUT_MS);
    const offInitialized = client.onDidInitialize(() => {
      clearTimeout(timer);
      offInitialized.dispose();
      resolveReady();
    });
    protocol.start();
  });

  return new RemoteServiceAccess(client);
}
