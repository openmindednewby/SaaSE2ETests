/**
 * Kefi MESSAGE-TEMPLATE DEFAULTS E2E — "at most ONE default per (event, channel)".
 *
 * The rule that decides which copy the organizer's broadcast box opens with. It
 * spans ROWS, so it cannot be enforced on the entity: `MessageTemplateDefaultRule`
 * clears every sibling default in the use case, and a filtered unique index
 * (`IX_EventMessageTemplates_EventId_Channel_Default` on `(EventId, Channel)
 * WHERE "IsDefault"`) backstops it in the database.
 *
 * Two mechanisms enforcing one invariant is precisely the arrangement in which
 * they can disagree — and they currently do. See the comment on the test below.
 *
 * The other half of the rule is the per-channel scoping: promoting an Email
 * template must not leave WhatsApp with no default at all, which would silently
 * change what a WhatsApp broadcast opens with.
 *
 * Pure `@api`. PROD-SAFE: every template is deleted in `finally` via the tracked
 * event-ops teardown, and only templates this spec created are ever promoted, so
 * the organizer's own default (if any) survives untouched.
 */

import { test, expect } from '@playwright/test';

import type { MessageTemplate } from '../../helpers/kefi/kefiMessageTemplateClient.js';
import { openEventOps } from '../../helpers/kefi/kefiEventOpsFixture.js';
import {
  fixtureTenantAvailable,
  FIXTURE_TENANT_SKIP_REASON,
} from '../../helpers/kefi/kefiFixtureTenant.js';
import { isRemoteTarget } from '../../helpers/target.js';

test.describe.configure({ mode: 'serial' });

const HTTP_OK = 200;

test.describe('Kefi message template defaults', () => {
  test.skip(!isRemoteTarget(), 'Kefi event-ops E2E targets a deployed environment');
  test.skip(!fixtureTenantAvailable(), FIXTURE_TENANT_SKIP_REASON);

  /**
   * ⚠️ CURRENTLY RED — this test has found a real server bug, and is deliberately
   * left failing rather than weakened. Ordered LAST in this serial describe so it
   * does not mask the tests above it.
   *
   * `PUT …/message-templates/{id}` with `isDefault: true` returns **500** whenever
   * the template being promoted has a LOWER database Id than the template that
   * currently holds the default for that channel. Reproduced standalone against
   * prod: create A then B, both with `isDefault: true` (B wins, as designed), then
   * PUT A with `isDefault: true` → 500 "An error occurred while saving the entity
   * changes"; PUT B (already default) → 200.
   *
   * Cause: `UpdateMessageTemplateHandler` stages the sibling demotion and the
   * promotion into ONE `SaveChangesAsync`, and the storage layer carries a filtered
   * unique index `IX_EventMessageTemplates_EventId_Channel_Default` on
   * `(EventId, Channel) WHERE "IsDefault"`. EF emits the two UPDATEs in primary-key
   * order, so when the promoted row sorts first there is a transient instant with
   * two `IsDefault = true` rows and Postgres rejects the batch. The CREATE path is
   * unaffected only by luck — an INSERT is ordered after the UPDATEs.
   *
   * Effect for a user: an organizer can never promote an OLDER template back to
   * default from the portal. The fix belongs in the handler (demote first, commit,
   * then promote — or make the index DEFERRABLE), not in this spec.
   */
  test('@api isDefault clears the previous default for the SAME channel only', async () => {
    const ops = await openEventOps();
    try {
      // Two Email templates and one WhatsApp, all promoted to default. The
      // Email pair contest one slot; the WhatsApp one has its own.
      const firstEmail = await ops.createTemplate({
        name: `${ops.marker} email-default-1`,
        channel: 'Email',
        subject: 'First',
        body: 'First body.',
        isDefault: true,
      });
      const whatsappDefault = await ops.createTemplate({
        name: `${ops.marker} whatsapp-default`,
        channel: 'WhatsApp',
        body: 'WhatsApp body.',
        isDefault: true,
      });

      const readOurs = async (): Promise<MessageTemplate[]> =>
        ((await ops.templates.list(ops.bearer, ops.tenant.eventExternalId))
          .data as MessageTemplate[]).filter((t) => t.name.startsWith(ops.marker));

      const beforeSecond = await readOurs();
      expect(
        beforeSecond.find((t) => t.externalId === firstEmail.externalId)?.isDefault,
        'the first Email template is the Email default',
      ).toBe(true);
      expect(
        beforeSecond.find((t) => t.externalId === whatsappDefault.externalId)?.isDefault,
        'and the WhatsApp template is the WhatsApp default',
      ).toBe(true);

      // Promote a SECOND Email template. It must displace the first — and only
      // the first.
      const secondEmail = await ops.createTemplate({
        name: `${ops.marker} email-default-2`,
        channel: 'Email',
        subject: 'Second',
        body: 'Second body.',
        isDefault: true,
      });

      const afterSecond = await readOurs();
      expect(
        afterSecond.find((t) => t.externalId === secondEmail.externalId)?.isDefault,
        'the newly promoted Email template is the Email default',
      ).toBe(true);
      expect(
        afterSecond.find((t) => t.externalId === firstEmail.externalId)?.isDefault,
        'the previously-default Email template was DEMOTED — one default per channel',
      ).toBe(false);
      expect(
        afterSecond.find((t) => t.externalId === whatsappDefault.externalId)?.isDefault,
        'but the WhatsApp default is UNTOUCHED — the channels contest separate slots, ' +
          'so promoting an email must never leave WhatsApp with no default',
      ).toBe(true);

      expect(
        afterSecond.filter((t) => t.channel === 'Email' && t.isDefault),
        'exactly one of our Email templates is default',
      ).toHaveLength(1);

      // Promotion works through UPDATE too, not just create.
      const promotedBack = await ops.templates.update(
        ops.bearer,
        ops.tenant.eventExternalId,
        firstEmail.externalId,
        {
          name: `${ops.marker} email-default-1`,
          subject: 'First',
          body: 'First body.',
          isDefault: true,
        },
      );
      expect(promotedBack.status, 'promoting via update succeeds').toBe(HTTP_OK);
      expect(
        (promotedBack.data as MessageTemplate).isDefault,
        'and the updated template reports itself default',
      ).toBe(true);

      const afterPromoteBack = await readOurs();
      expect(
        afterPromoteBack.find((t) => t.externalId === secondEmail.externalId)?.isDefault,
        'which demotes the one that held the slot',
      ).toBe(false);
      expect(
        afterPromoteBack.find((t) => t.externalId === whatsappDefault.externalId)?.isDefault,
        'and still leaves WhatsApp alone',
      ).toBe(true);
    } finally {
      const failures = await ops.cleanup();
      expect(failures, 'every template this test created was cleaned up').toEqual([]);
    }
  });
});
