/**
 * Kefi MESSAGE-TEMPLATE E2E — the reusable per-event copy an organizer
 * broadcasts from, and the two ways it silently lied before it was fixed.
 *
 * A message template is the last thing that runs before words reach a real
 * attendee's inbox or phone, which makes "the API returned 200" a uselessly weak
 * guarantee. Two properties matter more than the CRUD happy path, and this spec
 * exists mainly for them:
 *
 *  1. **The channel is immutable, and the server ENFORCES that by ignoring it.**
 *     `UpdateMessageTemplateRequest` does not declare `channel`, and
 *     FastEndpoints silently DISCARDS undeclared body fields. So a client that
 *     PUTs `channel: "WhatsApp"` onto an Email template gets a cheerful 200 and
 *     nothing changes — which is correct behaviour dressed as success, and is
 *     exactly how the portal came to claim it had switched a template's channel
 *     when it had not. The assertion below pins the SERVER side of that: the
 *     response must still report Email.
 *
 *  2. **An unknown `{{token}}` renders as the EMPTY STRING, never as itself.**
 *     `MessageTemplateRenderer.Resolve` returns `string.Empty` for anything it
 *     does not recognise. That is deliberate: a half-remembered `{{discount}}`
 *     must not reach a recipient looking like a broken mail-merge, and it must
 *     not throw mid-broadcast and strand the rest of the list. The client's
 *     `renderForSend` now blanks the same way, so this assertion is the
 *     server half of a parity pair — if the server ever starts echoing the raw
 *     token back, previews and sends diverge and nobody notices until a customer
 *     receives `Hi Maria, your {{discount}} awaits`.
 *
 * The surrounding CRUD contract — create/list/delete, the validation walls, the
 * subject-per-channel rule and the one-default-per-channel invariant — lives in
 * `kefi-message-templates-crud.spec.ts`.
 *
 * Pure `@api`. PROD-SAFE: every template this spec creates is deleted in
 * `finally` via the tracked event-ops teardown, and it never touches a template
 * it did not create — the fixture event's real templates are read but never
 * written. It also never promotes a default it does not then clean up, so the
 * organizer's own default (if any) survives untouched.
 */

import { test, expect } from '@playwright/test';

import type { MessageTemplate, RenderedMessage } from '../../helpers/kefi/kefiMessageTemplateClient.js';
import { openEventOps } from '../../helpers/kefi/kefiEventOpsFixture.js';
import {
  fixtureTenantAvailable,
  FIXTURE_TENANT_SKIP_REASON,
} from '../../helpers/kefi/kefiFixtureTenant.js';
import { isRemoteTarget } from '../../helpers/target.js';

test.describe.configure({ mode: 'serial' });

const HTTP_OK = 200;

/** The server's sample-preview person, from `MessageTemplateValues.Sample`. */
const SAMPLE_NAME = 'Maria';

test.describe('Kefi message templates', () => {
  test.skip(!isRemoteTarget(), 'Kefi event-ops E2E targets a deployed environment');
  test.skip(!fixtureTenantAvailable(), FIXTURE_TENANT_SKIP_REASON);

  test('@api the channel is immutable — a PUT carrying a new channel is ignored, while the editable fields take effect', async () => {
    const ops = await openEventOps();
    try {
      const created = await ops.createTemplate({
        name: `${ops.marker} channel-lock`,
        channel: 'Email',
        subject: 'Original subject',
        body: 'Original body for {{name}}.',
      });
      expect(created.channel, 'the template is created on the Email channel').toBe('Email');

      // ── The bug: `channel` is not declared on the update request, so
      // FastEndpoints DISCARDS it. A 200 here does NOT mean the switch happened.
      const smuggled = await ops.templates.update(
        ops.bearer,
        ops.tenant.eventExternalId,
        created.externalId,
        {
          name: `${ops.marker} channel-lock`,
          subject: 'Original subject',
          body: 'Original body for {{name}}.',
          channel: 'WhatsApp',
        },
      );
      expect(smuggled.status, 'the update is accepted — the stray field is not an error').toBe(
        HTTP_OK,
      );
      expect(
        (smuggled.data as MessageTemplate).channel,
        'the server IGNORED the smuggled channel — an Email template is never silently ' +
          'promoted to WhatsApp, whatever the body says',
      ).toBe('Email');

      // And it is not merely the response that lies — re-read it.
      const afterSmuggle = (
        (await ops.templates.list(ops.bearer, ops.tenant.eventExternalId)).data as MessageTemplate[]
      ).find((t) => t.externalId === created.externalId);
      expect(
        afterSmuggle?.channel,
        'the STORED channel is still Email — the discard is durable, not cosmetic',
      ).toBe('Email');

      // ── The other half: a normal PUT genuinely takes effect, so the assertion
      // above cannot pass merely because updates are broken outright.
      const updated = await ops.templates.update(
        ops.bearer,
        ops.tenant.eventExternalId,
        created.externalId,
        {
          name: `${ops.marker} channel-lock renamed`,
          subject: 'Rewritten subject',
          body: 'Rewritten body for {{name}}.',
          isDefault: false,
        },
      );
      expect(updated.status, 'a normal update succeeds').toBe(HTTP_OK);
      const row = updated.data as MessageTemplate;
      expect(row.name, 'the name was rewritten').toBe(`${ops.marker} channel-lock renamed`);
      expect(row.subject, 'the subject was rewritten').toBe('Rewritten subject');
      expect(row.body, 'the body was rewritten').toBe('Rewritten body for {{name}}.');

      const afterUpdate = (
        (await ops.templates.list(ops.bearer, ops.tenant.eventExternalId)).data as MessageTemplate[]
      ).find((t) => t.externalId === created.externalId);
      expect(afterUpdate?.name, 'and the rewrite is persisted, not just echoed').toBe(
        `${ops.marker} channel-lock renamed`,
      );
    } finally {
      const failures = await ops.cleanup();
      expect(failures, 'every template this test created was cleaned up').toEqual([]);
    }
  });

  test('@api preview substitutes known tokens and BLANKS unknown ones — no raw {{token}} ever reaches a recipient', async () => {
    const ops = await openEventOps();
    try {
      const template = await ops.createTemplate({
        name: `${ops.marker} token-render`,
        channel: 'Email',
        subject: 'Hello {{name}} — {{discount}}',
        body: 'Hi {{name}}, your {{pass}} for {{eventName}} is ready. Bonus: {{discount}}!',
      });

      const resp = await ops.templates.preview(
        ops.bearer,
        ops.tenant.eventExternalId,
        template.externalId,
      );
      expect(resp.status, 'preview renders against the sample person').toBe(HTTP_OK);
      const rendered = resp.data as RenderedMessage;

      // ── Known tokens substituted ────────────────────────────────────────
      expect(
        rendered.body,
        'the known {{name}} token substituted the sample first name',
      ).toContain(SAMPLE_NAME);
      expect(rendered.body, 'the known {{pass}} token substituted').toContain('FULL');
      expect(rendered.body, 'the {{eventName}} token substituted a real event name').not.toContain(
        '{{eventName}}',
      );

      // ── The unknown token is BLANKED, not echoed ────────────────────────
      expect(
        rendered.body,
        'the unknown {{discount}} token does NOT survive into the rendered body — a ' +
          'recipient must never see a raw placeholder',
      ).not.toContain('{{discount}}');
      expect(
        rendered.body,
        'no raw placeholder of ANY kind survives rendering',
      ).not.toMatch(/\{\{\s*\w+\s*\}\}/);
      expect(
        rendered.body,
        'the unknown token rendered as the EMPTY string — not "null", not "undefined", ' +
          'and not the bare token name',
      ).not.toContain('discount');
      expect(
        rendered.body,
        'the copy that surrounded the blanked token is intact and closes up cleanly',
      ).toContain('Bonus: !');

      // ── The subject renders by the same rule ────────────────────────────
      expect(rendered.subject, 'an Email template renders a subject').not.toBeNull();
      expect(rendered.subject!, 'the subject substituted its known token').toContain(SAMPLE_NAME);
      expect(
        rendered.subject!,
        'and blanked its unknown one exactly like the body',
      ).not.toContain('{{discount}}');
      expect(rendered.subject!.trimEnd(), 'leaving the copy that surrounded it').toBe(
        `Hello ${SAMPLE_NAME} —`,
      );
    } finally {
      const failures = await ops.cleanup();
      expect(failures, 'every template this test created was cleaned up').toEqual([]);
    }
  });
});
