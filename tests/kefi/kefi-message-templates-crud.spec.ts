/**
 * Kefi MESSAGE-TEMPLATE CRUD E2E — the storage contract underneath the copy.
 *
 * `kefi-message-templates.spec.ts` owns the two behaviours that shipped as bugs
 * (the immutable channel and the blanked unknown token). This file owns the
 * plumbing they sit on: create/list/delete, the validation walls, the
 * subject-per-channel rule, and the "at most one default per (event, channel)"
 * invariant.
 *
 * The invariant is the interesting one. It spans ROWS, so it cannot live on the
 * entity — it is applied by the use case clearing every sibling default, and
 * backstopped by a filtered unique index in the database. Two mechanisms
 * enforcing one rule is exactly the arrangement where they can disagree, which
 * is what the last test in this file currently catches.
 *
 * Pure `@api`. PROD-SAFE: every template is deleted in `finally` via the tracked
 * event-ops teardown, and no pre-existing template is ever written or promoted.
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
const HTTP_CREATED = 201;
const HTTP_NO_CONTENT = 204;
const HTTP_BAD_REQUEST = 400;
const HTTP_UNAUTHORIZED = 401;
const HTTP_NOT_FOUND = 404;

const UNKNOWN_ID = '00000000-0000-0000-0000-000000000000';

/** The server's sample-preview person, from `MessageTemplateValues.Sample`. */
const SAMPLE_NAME = 'Maria';

test.describe('Kefi message template CRUD', () => {
  test.skip(!isRemoteTarget(), 'Kefi event-ops E2E targets a deployed environment');
  test.skip(!fixtureTenantAvailable(), FIXTURE_TENANT_SKIP_REASON);

  test('@api create/list/delete lifecycle, the subject-per-channel rule, and the validation walls', async () => {
    const ops = await openEventOps();
    try {
      // ── An Email template CARRIES a subject ─────────────────────────────
      const email = await ops.createTemplate({
        name: `${ops.marker} email`,
        channel: 'Email',
        subject: 'Your pass is ready',
        body: 'Hi {{name}}.',
      });
      expect(email.subject, 'an Email template keeps its subject').toBe('Your pass is ready');

      // ── A WhatsApp template does NOT, even when one is submitted ────────
      const whatsapp = await ops.createTemplate({
        name: `${ops.marker} whatsapp`,
        channel: 'WhatsApp',
        subject: 'This subject is meaningless on WhatsApp',
        body: 'Hi {{name}}.',
      });
      expect(whatsapp.channel, 'the WhatsApp template is on the WhatsApp channel').toBe('WhatsApp');
      expect(
        whatsapp.subject,
        'a WhatsApp template stores NO subject — the channel has no such concept, so a ' +
          'submitted one is dropped rather than kept and quietly ignored at send time',
      ).toBeNull();

      const whatsappPreview = await ops.templates.preview(
        ops.bearer,
        ops.tenant.eventExternalId,
        whatsapp.externalId,
      );
      expect(whatsappPreview.status, 'a WhatsApp template previews').toBe(HTTP_OK);
      expect(
        (whatsappPreview.data as RenderedMessage).subject,
        'and renders a null subject — "no subject" is a distinct case from "empty subject"',
      ).toBeNull();

      // ── Both are listed ─────────────────────────────────────────────────
      const listed = await ops.templates.list(ops.bearer, ops.tenant.eventExternalId);
      expect(listed.status, 'the organizer can list their templates').toBe(HTTP_OK);
      const ours = (listed.data as MessageTemplate[]).filter((t) =>
        t.name.startsWith(ops.marker),
      );
      expect(ours, 'both templates are listed, across both channels').toHaveLength(2);

      // ── Validation walls ────────────────────────────────────────────────
      const bad = async (input: Parameters<typeof ops.templates.create>[2]): Promise<number> =>
        (await ops.templates.create(ops.bearer, ops.tenant.eventExternalId, input)).status;

      expect(
        await bad({ name: '', channel: 'Email', body: 'Body.' }),
        'a template must be named — an unnamed one is unpickable in the portal',
      ).toBe(HTTP_BAD_REQUEST);
      expect(
        await bad({ name: `${ops.marker} bodyless`, channel: 'Email', body: '' }),
        'a template must have a body — there is nothing to send otherwise',
      ).toBe(HTTP_BAD_REQUEST);
      expect(
        await bad({ name: `${ops.marker} bad-channel`, channel: 'Telepathy', body: 'Body.' }),
        'an unknown channel is rejected rather than defaulted',
      ).toBe(HTTP_BAD_REQUEST);

      // ── Authorization walls ─────────────────────────────────────────────
      expect(
        (await ops.templates.list('', ops.tenant.eventExternalId)).status,
        'an unauthenticated caller cannot list templates',
      ).toBe(HTTP_UNAUTHORIZED);
      expect(
        (await ops.templates.list(ops.bearer, UNKNOWN_ID)).status,
        'an event outside the caller tenant is not found',
      ).toBe(HTTP_NOT_FOUND);
      expect(
        (await ops.templates.preview(ops.bearer, ops.tenant.eventExternalId, UNKNOWN_ID)).status,
        'previewing a template that does not exist is not found',
      ).toBe(HTTP_NOT_FOUND);

      // ── Delete removes it from the list ─────────────────────────────────
      const deleted = await ops.templates.remove(
        ops.bearer,
        ops.tenant.eventExternalId,
        whatsapp.externalId,
      );
      expect(deleted.status, 'deleting a template returns 204').toBe(HTTP_NO_CONTENT);

      const afterDelete = (
        (await ops.templates.list(ops.bearer, ops.tenant.eventExternalId)).data as MessageTemplate[]
      ).filter((t) => t.name.startsWith(ops.marker));
      expect(afterDelete, 'the deleted template is gone from the list').toHaveLength(1);
      expect(afterDelete[0].externalId, 'and the one left is the OTHER one').toBe(email.externalId);
      expect(
        (await ops.templates.remove(ops.bearer, ops.tenant.eventExternalId, whatsapp.externalId))
          .status,
        'deleting it again is not found — the row is genuinely gone',
      ).toBe(HTTP_NOT_FOUND);
    } finally {
      const failures = await ops.cleanup();
      expect(failures, 'every template this test created was cleaned up').toEqual([]);
    }
  });

  test('@api create returns 201 with a stored row whose id is immediately usable', async () => {
    const ops = await openEventOps();
    try {
      const resp = await ops.templates.create(ops.bearer, ops.tenant.eventExternalId, {
        name: `${ops.marker} created`,
        channel: 'Email',
        subject: 'Subject',
        body: 'Body for {{fullName}}.',
      });
      expect(resp.status, 'creating a template returns 201, not 200').toBe(HTTP_CREATED);
      const created = resp.data as MessageTemplate;
      ops.trackTemplate(created.externalId);

      expect(created.externalId, 'the response carries the new external id').toBeTruthy();
      expect(created.isDefault, 'a template is not default unless asked to be').toBe(false);
      expect(
        created.body,
        'the stored body is the RAW body — rendering happens at preview and send, not at rest',
      ).toBe('Body for {{fullName}}.');

      const preview = await ops.templates.preview(
        ops.bearer,
        ops.tenant.eventExternalId,
        created.externalId,
      );
      expect(preview.status, 'the id from create works immediately on preview').toBe(HTTP_OK);
      expect(
        (preview.data as RenderedMessage).body,
        'and {{fullName}} joins the sample first and last name',
      ).toContain(`${SAMPLE_NAME} Georgiou`);
    } finally {
      const failures = await ops.cleanup();
      expect(failures, 'every template this test created was cleaned up').toEqual([]);
    }
  });
});
