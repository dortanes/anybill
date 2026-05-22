/**
 * @module services/EventBus
 *
 * In-memory pub/sub event bus with a ring buffer for SSE reconnection support.
 *
 * Every emitted event is assigned an auto-incrementing numeric ID and stored
 * in a fixed-size ring buffer (default: 1000 entries). SSE clients that
 * reconnect with a `Last-Event-ID` header can replay missed events via
 * {@link getEventsSince}.
 */

import { Injectable } from "@tsed/di";
import { EventEmitter } from "events";

const BUFFER_SIZE = 1000;

interface BufferedEvent {
    id: number;
    event: string;
    data: Record<string, any>;
}

@Injectable()
export class EventBus {
    private emitter = new EventEmitter();
    private buffer: BufferedEvent[] = [];
    private nextId = 1;

    constructor() {
        // Allow many SSE listeners without Node warning.
        this.emitter.setMaxListeners(0);
    }

    /**
     * Emit an event, storing it in the ring buffer and notifying all listeners.
     *
     * @param event - Event type name (e.g. `payment.confirmed`).
     * @param data  - Arbitrary JSON-serialisable payload.
     */
    emit(event: string, data: Record<string, any>): void {
        const entry: BufferedEvent = { id: this.nextId++, event, data };

        if (this.buffer.length >= BUFFER_SIZE) {
            this.buffer.shift();
        }
        this.buffer.push(entry);

        this.emitter.emit("event", entry.id, entry.event, entry.data);
    }

    /**
     * Subscribe to all events.
     *
     * @param listener - Called with `(id, event, data)` for every emitted event.
     * @returns An unsubscribe function — call it to remove the listener.
     */
    subscribe(listener: (id: number, event: string, data: Record<string, any>) => void): () => void {
        this.emitter.on("event", listener);
        return () => {
            this.emitter.off("event", listener);
        };
    }

    /**
     * Retrieve all buffered events after the given ID (exclusive).
     *
     * Used for SSE reconnect replay: the client sends `Last-Event-ID`
     * and receives every event it missed while disconnected.
     *
     * @param lastId - The last event ID the client received.
     * @returns Array of events with `id > lastId`, in chronological order.
     */
    getEventsSince(lastId: number): BufferedEvent[] {
        return this.buffer.filter((e) => e.id > lastId);
    }
}
