/**
 * @module @anybill/sdk/EventStream
 *
 * Zero-dependency Server-Sent Events (SSE) client for real-time
 * event streaming from the AnyBill API.
 *
 * Uses native `fetch` with `ReadableStream` for Node.js 18+.
 * Automatically reconnects with exponential backoff on disconnect.
 *
 * @example
 * ```ts
 * const stream = sdk.events.subscribe(["payment.confirmed"]);
 *
 * stream.on("payment.confirmed", (data) => {
 *   console.log("Payment confirmed!", data.invoiceId);
 * });
 *
 * // Later:
 * stream.close();
 * ```
 */

import type { WebhookEventMap, WebhookEventType } from "./types";

/** Configuration for creating an EventStream. */
export interface EventStreamConfig {
    /** Base URL of the AnyBill backend. */
    baseUrl: string;
    /** API key for authentication. */
    apiKey: string;
    /** Event types to subscribe to. Empty = all events. */
    events?: WebhookEventType[];
}

/** Listener function type for typed events. */
type EventListener<T> = (data: T) => void;

/** Listener for the special 'error' event. */
type ErrorListener = (error: Error) => void;

/** Listener for the special 'connected' event. */
type ConnectedListener = () => void;

/**
 * Real-time event stream from AnyBill via SSE.
 *
 * Provides type-safe event listeners for all AnyBill webhook events.
 * Automatically reconnects with exponential backoff when disconnected.
 */
export class EventStream {
    private readonly baseUrl: string;
    private readonly apiKey: string;
    private readonly eventFilter: WebhookEventType[];

    private listeners = new Map<string, Set<Function>>();
    private lastEventId: string | null = null;
    private controller: AbortController | null = null;
    private closed = false;
    private reconnectAttempts = 0;
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    /** Max backoff delay in ms (30 seconds). */
    private static readonly MAX_BACKOFF_MS = 30_000;
    /** Base backoff delay in ms (1 second). */
    private static readonly BASE_BACKOFF_MS = 1_000;

    constructor(config: EventStreamConfig) {
        this.baseUrl = config.baseUrl.replace(/\/$/, "");
        this.apiKey = config.apiKey;
        this.eventFilter = config.events ?? [];
        this.connect();
    }

    /**
     * Register a typed event listener.
     *
     * @param event - Webhook event type to listen for.
     * @param handler - Callback invoked with the typed event payload.
     * @returns `this` for chaining.
     */
    on<E extends WebhookEventType>(event: E, handler: EventListener<WebhookEventMap[E]>): this;
    /**
     * Register an error listener.
     *
     * Called when the SSE connection encounters an error.
     * The stream will automatically attempt to reconnect.
     */
    on(event: "error", handler: ErrorListener): this;
    /** Register a listener for successful (re)connection. */
    on(event: "connected", handler: ConnectedListener): this;
    on(event: string, handler: Function): this {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
        }
        this.listeners.get(event)!.add(handler);
        return this;
    }

    /**
     * Remove a previously registered event listener.
     *
     * @param event - Event type.
     * @param handler - The exact function reference passed to `on()`.
     * @returns `this` for chaining.
     */
    off(event: string, handler: Function): this {
        this.listeners.get(event)?.delete(handler);
        return this;
    }

    /**
     * Register a one-time event listener.
     *
     * The handler is automatically removed after its first invocation.
     */
    once<E extends WebhookEventType>(event: E, handler: EventListener<WebhookEventMap[E]>): this;
    once(event: "error", handler: ErrorListener): this;
    once(event: "connected", handler: ConnectedListener): this;
    once(event: string, handler: Function): this {
        const wrapper = (...args: any[]) => {
            this.off(event, wrapper);
            handler(...args);
        };
        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
        }
        this.listeners.get(event)!.add(wrapper);
        return this;
    }

    /**
     * Close the event stream permanently.
     *
     * Cancels any active connection and pending reconnect timers.
     * The stream cannot be reused after calling `close()`.
     */
    close(): void {
        this.closed = true;
        this.controller?.abort();
        this.controller = null;
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        this.listeners.clear();
    }

    /** Whether the stream has been closed. */
    get isClosed(): boolean {
        return this.closed;
    }

    // ─── Internal ───────────────────────────────────────────────

    private emit(event: string, ...args: any[]): void {
        const handlers = this.listeners.get(event);
        if (!handlers) return;
        for (const h of handlers) {
            try {
                h(...args);
            } catch {
                // Swallow listener errors to prevent stream breakage.
            }
        }
    }

    private async connect(): Promise<void> {
        if (this.closed) return;

        this.controller = new AbortController();

        let url = `${this.baseUrl}/api/sdk/stream`;
        if (this.eventFilter.length > 0) {
            url += `?events=${this.eventFilter.join(",")}`;
        }

        const headers: Record<string, string> = {
            "X-Api-Key": this.apiKey,
            "Accept": "text/event-stream",
        };
        if (this.lastEventId) {
            headers["Last-Event-ID"] = this.lastEventId;
        }

        try {
            const res = await fetch(url, {
                headers,
                signal: this.controller.signal,
            });

            if (!res.ok) {
                const body = await res.text().catch(() => res.statusText);
                throw new Error(`SSE connection failed: ${res.status} ${body}`);
            }

            if (!res.body) {
                throw new Error("SSE response has no body (ReadableStream not available)");
            }

            this.reconnectAttempts = 0;
            this.emit("connected");

            await this.readStream(res.body);
        } catch (err: any) {
            if (this.closed) return;
            if (err.name === "AbortError") return;

            this.emit("error", err instanceof Error ? err : new Error(String(err)));
            this.scheduleReconnect();
        }
    }

    private async readStream(body: ReadableStream<Uint8Array>): Promise<void> {
        const decoder = new TextDecoder();
        const reader = body.getReader();

        let buffer = "";
        let currentId = "";
        let currentEvent = "";
        let currentData = "";

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });

                // Process complete lines
                const lines = buffer.split("\n");
                buffer = lines.pop()!; // Keep incomplete last line

                for (const line of lines) {
                    if (line === "") {
                        // Empty line = end of message
                        if (currentData) {
                            if (currentId) {
                                this.lastEventId = currentId;
                            }
                            const eventName = currentEvent || "message";
                            try {
                                const parsed = JSON.parse(currentData);
                                this.emit(eventName, parsed);
                            } catch {
                                // Non-JSON data, emit as-is
                                this.emit(eventName, currentData);
                            }
                        }
                        currentId = "";
                        currentEvent = "";
                        currentData = "";
                    } else if (line.startsWith("id:")) {
                        currentId = line.slice(3).trim();
                    } else if (line.startsWith("event:")) {
                        currentEvent = line.slice(6).trim();
                    } else if (line.startsWith("data:")) {
                        // Support multi-line data by concatenating
                        currentData += (currentData ? "\n" : "") + line.slice(5).trim();
                    }
                    // Lines starting with ':' are comments (heartbeat), ignore them
                }
            }
        } catch (err: any) {
            if (this.closed) return;
            if (err.name === "AbortError") return;
            throw err;
        } finally {
            reader.releaseLock();
        }

        // Stream ended without error — reconnect
        if (!this.closed) {
            this.scheduleReconnect();
        }
    }

    private scheduleReconnect(): void {
        if (this.closed) return;

        const delay = Math.min(
            EventStream.BASE_BACKOFF_MS * Math.pow(2, this.reconnectAttempts),
            EventStream.MAX_BACKOFF_MS,
        );
        this.reconnectAttempts++;

        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.connect();
        }, delay);
    }
}
