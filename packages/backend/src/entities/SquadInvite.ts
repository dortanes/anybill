/**
 * @module entities/SquadInvite
 *
 * SquadInvite entity — a pending invitation to join a squad.
 *
 * When a squad owner wants to invite a user, they create an invite for
 * that user's external ID (`uid`). The invitee can then accept or decline
 * it via the SDK API. Invites expire after a configurable TTL (default: 7 days,
 * set in Settings → Billing).
 */

import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
    ManyToOne,
    Index,
} from "typeorm";
import { Squad } from "./Squad";

/**
 * Squad invite lifecycle status.
 *
 * | Status      | Meaning                                              |
 * |-------------|------------------------------------------------------|
 * | `pending`   | Invite sent, awaiting response.                      |
 * | `accepted`  | Invitee accepted; they are now an active member.     |
 * | `declined`  | Invitee explicitly declined the invitation.          |
 * | `cancelled` | Owner cancelled the invite before it was responded.  |
 * | `expired`   | Invite TTL elapsed before a response was received.   |
 */
export type SquadInviteStatus = "pending" | "accepted" | "declined" | "cancelled" | "expired";

@Entity()
@Index(["squadId", "uid", "status"])
export class SquadInvite {
    @PrimaryGeneratedColumn("uuid")
    id!: string;

    /** The squad this invite belongs to. */
    @ManyToOne(() => Squad, { onDelete: "CASCADE" })
    squad!: Squad;

    /** Foreign key to the squad. */
    @Column()
    squadId!: string;

    /** External user ID of the invited user (from the client's application). */
    @Column()
    uid!: string;

    /** Current invite status. */
    @Column({ type: "varchar", default: "pending" })
    status!: SquadInviteStatus;

    /**
     * When this invite expires. Null = no expiration.
     * Calculated from `account.inviteTtlDays` at creation time,
     * or overridden by the `ttlDays` parameter in the request.
     */
    @Column({ type: "datetime", nullable: true })
    expiresAt!: Date | null;

    @CreateDateColumn()
    createdAt!: Date;

    @UpdateDateColumn()
    updatedAt!: Date;
}
