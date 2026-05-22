/**
 * @module controllers/sdk/SdkEventsController
 *
 * Server-Sent Events (SSE) endpoint for real-time billing event streaming.
 *
 * SDK clients connect to `GET /api/sdk/stream` (API key required) and receive
 * a continuous stream of events (payments, subscriptions, squads, etc.).
 *
 * Supports optional event filtering via the `events` query parameter and
 * automatic reconnection replay via the `Last-Event-ID` header.
 */

import { Controller, Get, Req, Res, QueryParams, UseBefore } from "@tsed/common";
import { Inject } from "@tsed/di";
import { Tags, Summary, Description, Returns } from "@tsed/schema";
import { SdkGuard } from "../../core/SdkGuard";
import { EventBus } from "../../services/EventBus";

const HEARTBEAT_INTERVAL_MS = 30_000;

@Controller("/")
@UseBefore(SdkGuard)
@Tags("SDK")
export class SdkEventsController {
    @Inject()
    private readonly eventBus!: EventBus;

    /**
     * SSE event stream.
     *
     * Opens a persistent connection and streams billing events in real time.
     * Use the `events` query parameter to filter by event type (comma-separated).
     * Supports `Last-Event-ID` header for reconnection replay.
     */
    @Get("/stream")
    @Summary("SSE event stream")
    @Description(
        "Opens a Server-Sent Events stream for real-time billing events. " +
        "Optionally filter with ?events=payment.confirmed,subscription.renewed. " +
        "Supports Last-Event-ID header for reconnection replay.",
    )
    @(Returns(200).Description("SSE event stream"))
    stream(
        @Req() req: any,
        @Res() res: any,
        @QueryParams("events") eventsFilter?: string,
    ): void {
        // Parse the optional event type filter.
        const allowedEvents: Set<string> | null = eventsFilter
            ? new Set(eventsFilter.split(",").map((e) => e.trim()).filter(Boolean))
            : null;

        // Set SSE headers.
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("X-Accel-Buffering", "no"); // Disable nginx buffering.
        res.flushHeaders();

        // Replay missed events on reconnect.
        const lastEventId = req.headers["last-event-id"];
        if (lastEventId) {
            const lastId = Number(lastEventId);
            if (!isNaN(lastId)) {
                const missed = this.eventBus.getEventsSince(lastId);
                for (const evt of missed) {
                    if (allowedEvents && !allowedEvents.has(evt.event)) continue;
                    res.write(`id: ${evt.id}\nevent: ${evt.event}\ndata: ${JSON.stringify(evt.data)}\n\n`);
                }
            }
        }

        // Subscribe to live events.
        const unsubscribe = this.eventBus.subscribe((id, event, data) => {
            if (allowedEvents && !allowedEvents.has(event)) return;
            res.write(`id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        });

        // Heartbeat to keep the connection alive.
        const heartbeat = setInterval(() => {
            res.write(":heartbeat\n\n");
        }, HEARTBEAT_INTERVAL_MS);

        // Cleanup on client disconnect.
        req.on("close", () => {
            unsubscribe();
            clearInterval(heartbeat);
        });
    }
}
