/**
 * @module models/InviteModels
 *
 * Request body models for squad invite endpoints.
 */

import { Required, Optional, Min, Property, Description, Integer } from "@tsed/schema";

/** Body for `POST /api/sdk/squads/:id/invites` — create a squad invite. */
export class CreateInviteBody {
    @Required()
    @Property(String)
    @Description("External user ID of the user to invite.")
    uid!: string;

    @Optional()
    @Integer()
    @Min(0)
    @Property(Number)
    @Description("TTL in days. 0 = no expiration. Overrides the global invite TTL setting.")
    ttlDays?: number;
}

/** Body for `POST /api/sdk/squads/:id/invites/:inviteId/accept|decline` — respond to an invite. */
export class InviteActionBody {
    @Required()
    @Property(String)
    @Description("External user ID of the invitee (must match the invite's uid).")
    uid!: string;
}
