/**
 * @module models/SettingsModels
 *
 * Request body models for account settings endpoints.
 */

import { Optional, Format, Property, Min, Description } from "@tsed/schema";

/** Body for `PUT /api/admin/settings/checkout` — update checkout appearance. */
export class UpdateCheckoutSettingsBody {
    @Optional()
    @Property(Object)
    checkoutConfig?: Record<string, unknown>;

    @Optional()
    @Format("uri")
    @Property(String)
    successRedirectUrl?: string | null;
}

/** Body for `PUT /api/admin/settings/billing` — update invoice auto-expiration settings. */
export class UpdateBillingSettingsBody {
    @Optional()
    @Property(Boolean)
    @Description("Enable or disable automatic expiration of stale pending invoices.")
    invoiceAutoExpire?: boolean;

    @Optional()
    @Min(1)
    @Property(Number)
    @Description("Time-to-live for pending invoices in minutes before auto-cancellation.")
    invoiceExpireTtlMinutes?: number;

    @Optional()
    @Min(0)
    @Property(Number)
    @Description("Default TTL for squad invites in days. 0 = no expiration.")
    inviteTtlDays?: number;
}
