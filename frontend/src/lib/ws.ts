/**
 * Shared real-time WebSocket client for `/api/ws`.
 * Handles auto-reconnect, keepalive ping, channel subscribe/unsubscribe,
 * typing indicators, project cursors, live chat & notifications.
 */
import { API_BASE } from "./api";

export type WsEvent = {
  type: string;
  [key: string]: unknown;
};

type Listener = (event: WsEvent) => void;

export class BloomWsClient {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private channels = new Set<string>();
  private pingTimer: number | null = null;
  private reconnectTimer: number | null = null;
  private closed = true;
  private attempt = 0;

  connect(): void {
    if (!this.closed && (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this.closed = false;
    this.openSocket();
  }

  disconnect(): void {
    this.closed = true;
    if (this.pingTimer) window.clearInterval(this.pingTimer);
    if (this.reconnectTimer) window.clearTimeout(this.reconnectTimer);
    this.pingTimer = null;
    this.reconnectTimer = null;
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }
  }

  subscribe(channel: string): void {
    this.channels.add(channel);
    this.send({ type: "subscribe", channel });
  }

  unsubscribe(channel: string): void {
    this.channels.delete(channel);
    this.send({ type: "unsubscribe", channel });
  }

  sendTyping(chatId: number, active: boolean): void {
    this.send({ type: "typing", chatId, active });
  }

  sendProjectCursor(projectId: number, slot: number | null): void {
    this.send({ type: "project:cursor", projectId, slot });
  }

  onEvent(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private send(payload: Record<string, unknown>): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  private openSocket(): void {
    if (this.closed || typeof window === "undefined") return;
    let url: string;
    if (API_BASE) {
      const base = new URL(API_BASE, window.location.href);
      base.protocol = base.protocol === "https:" ? "wss:" : "ws:";
      url = `${base.origin}/api/ws`;
    } else {
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      url = `${proto}//${window.location.host}/api/ws`;
    }

    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onopen = () => {
      this.attempt = 0;
      for (const ch of this.channels) {
        this.send({ type: "subscribe", channel: ch });
      }
      if (this.pingTimer) window.clearInterval(this.pingTimer);
      this.pingTimer = window.setInterval(() => this.send({ type: "ping" }), 25000);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(String(event.data)) as WsEvent;
        if (!msg || typeof msg !== "object" || !msg.type) return;
        for (const listener of this.listeners) listener(msg);
      } catch {
        // ignore malformed payload
      }
    };

    ws.onclose = () => {
      if (this.pingTimer) {
        window.clearInterval(this.pingTimer);
        this.pingTimer = null;
      }
      this.ws = null;
      if (!this.closed) {
        this.attempt += 1;
        const delay = Math.min(12000, 800 * Math.pow(1.5, Math.min(this.attempt, 6)));
        this.reconnectTimer = window.setTimeout(() => this.openSocket(), delay);
      }
    };

    ws.onerror = () => {
      // handled in onclose
    };
  }
}
