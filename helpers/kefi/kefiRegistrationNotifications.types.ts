/**
 * Wire types and constants for the organizer registration-notifications card.
 *
 * Split from the driver so the CONTRACT (what the backend sends, what the
 * channel wire codes are, what the recipient cap is) can be read on its own —
 * these are the values that must stay in step with
 * `kefi-web/src/api/types/registrationNotificationTypes.ts` and the backend
 * `OrganizerNotificationPlanner`, and a drift between them is the most likely
 * way this suite starts asserting the wrong thing while still passing.
 */

/**
 * Wire code for the genuinely server-sent channel. Mirrors `CHANNEL_EMAIL` in
 * `kefi-web/src/api/types/registrationNotificationTypes.ts` — the backend flags
 * enum calls this `Email = 1`.
 */
export const CHANNEL_EMAIL = 'email';

/**
 * Wire code for the WhatsApp channel (`WhatsAppHandoff = 2` on the backend).
 *
 * There is NO server sender behind it: a `wa.me` deep link opens a chat on a
 * device, so the server sends nothing. Selecting only this must therefore
 * produce a visible warning rather than a silently-inert setting — the exact
 * failure the feature exists to prevent.
 */
export const CHANNEL_WHATSAPP_HANDOFF = 'whatsapp-handoff';

/** Max recipient addresses — mirrors `MAX_RECIPIENTS` / the backend planner. */
export const MAX_RECIPIENTS = 5;

/** The stored per-tenant config, as round-tripped by GET|PUT. */
export interface RegistrationNotificationConfig {
  schemaVersion?: number;
  enabled: boolean;
  channels: string[];
  recipientEmails: string[];
}

/** The editor-load payload of `GET /admin/registration-notifications`. */
export interface MyRegistrationNotifications {
  /** `null` when this tenant has NEVER configured notifications. */
  config: RegistrationNotificationConfig | null;
  ownerAccountEmail: string | null;
  /** Channels the backend can genuinely deliver. Server-authoritative. */
  serverDeliveredChannels: string[];
}
