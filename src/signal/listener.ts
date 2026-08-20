import type { AppConfig } from "../config";
import { logger } from "../logger";
import { authorizeSender } from "./auth";
import { parseSignalEvent } from "./parse";
import type { IncomingDirectMessage } from "./types";

type MessageHandler = (message: IncomingDirectMessage) => Promise<void>;

const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;

function wsBase(httpUrl: string): string {
  if (httpUrl.startsWith("https://")) return `wss://${httpUrl.slice(8)}`;
  if (httpUrl.startsWith("http://")) return `ws://${httpUrl.slice(7)}`;
  throw new Error(`Unsupported SIGNAL_API_URL: ${httpUrl}`);
}

export class SignalListener {
  private stopping = false;
  private socket?: WebSocket;

  constructor(
    private readonly config: AppConfig,
    private readonly onMessage: MessageHandler,
  ) {}

  stop(): void {
    this.stopping = true;
    this.socket?.close(1000, "shutdown");
  }

  async run(): Promise<void> {
    let backoffMs = INITIAL_BACKOFF_MS;

    while (!this.stopping) {
      try {
        await this.connectOnce();
        backoffMs = INITIAL_BACKOFF_MS;
      } catch (error) {
        if (this.stopping) return;
        logger.warn("Signal receive connection failed", {
          error: error instanceof Error ? error.message : String(error),
          retryInMs: backoffMs,
        });
        await Bun.sleep(backoffMs);
        backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
      }
    }
  }

  private connectOnce(): Promise<void> {
    const url = `${wsBase(this.config.signalApiUrl)}/v1/receive/${encodeURIComponent(this.config.signalBotNumber)}`;
    logger.info("Connecting to Signal receive WebSocket");

    return new Promise<void>((resolve, reject) => {
      let opened = false;
      let settled = false;
      const finishReject = (error: Error) => {
        if (settled) return;
        settled = true;
        reject(error);
      };
      const finishResolve = () => {
        if (settled) return;
        settled = true;
        resolve();
      };

      const ws = new WebSocket(url);
      this.socket = ws;

      ws.addEventListener("open", () => {
        opened = true;
        logger.info("Signal receive WebSocket connected");
      });

      ws.addEventListener("message", (event) => {
        const raw = typeof event.data === "string" ? event.data : "";
        if (raw) void this.handleRaw(raw);
      });

      ws.addEventListener("error", () => {
        if (!opened) {
          finishReject(new Error("WebSocket connection error; use native only for pairing, then json-rpc-native/json-rpc for runtime"));
        }
      });

      ws.addEventListener("close", (event) => {
        this.socket = undefined;
        logger.warn("Signal receive WebSocket closed", { code: event.code, clean: event.wasClean });
        if (this.stopping) return finishResolve();
        finishReject(new Error(opened ? `WebSocket closed with code ${event.code}` : "WebSocket closed before opening"));
      });
    });
  }

  private async handleRaw(raw: string): Promise<void> {
    const parsed = parseSignalEvent(raw);

    if (parsed.kind === "invalid") {
      logger.warn("Ignoring invalid Signal payload");
      return;
    }
    if (parsed.kind === "group") {
      logger.info("Ignoring Signal group message");
      return;
    }
    if (parsed.kind === "non-message") return;

    const auth = authorizeSender(parsed.message, this.config);
    if (!auth.allowed) {
      logger.warn("Ignoring unauthorized Signal sender", {
        reason: auth.reason,
        senderNumber: parsed.message.senderNumber ?? null,
        senderUuid: parsed.message.senderUuid ?? null,
      });
      return;
    }

    logger.info("Authorized Signal sender", {
      via: auth.via,
      senderUuid: parsed.message.senderUuid ?? null,
      hasSenderNumber: Boolean(parsed.message.senderNumber),
    });

    try {
      await this.onMessage(parsed.message);
    } catch (error) {
      logger.error("Authorized message handler failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
