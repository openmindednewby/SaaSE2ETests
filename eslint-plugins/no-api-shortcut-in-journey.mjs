/**
 * Custom ESLint Rule: No UNDECLARED API writes in a critical-path journey spec
 *
 * WHY THIS EXISTS
 * ---------------
 * On 2026-09-06 the door check-in journey was green while the real feature returned 415 at
 * a venue door and threw a ReferenceError on the UI path. Both were invisible because the
 * "journey" spec performed the action under test by calling the API directly instead of
 * clicking through the app. It replayed a request IT had assembled — so it proved the
 * server worked and proved nothing about the thing a user touches.
 *
 * This is already the rule in CLAUDE.md:
 *
 *     "Replay the request the real UI sends, not one you assembled."
 *
 * Convention did not survive one deadline. This is the same rule with an exit code.
 *
 * WHY IT DOES NOT SIMPLY BAN API CLIENTS
 * --------------------------------------
 * A journey spec legitimately uses API clients to SEED state (create the event, the
 * attendee, the plan) and to ASSERT outcomes (read the door ledger). Statically, seeding
 * and performing-the-action-under-test look identical. A blanket ban would be wrong most
 * of the time and would be switched off within a week — and a disabled rule observes
 * nothing.
 *
 * So this rule does not forbid. It forces the write to be DECLARED:
 *
 *     // journey-setup: seed an attendee so the door has someone to admit
 *     await ledgerClient.post(...)        // allowed, and visible in review
 *
 *     await ledgerClient.post(...)        // ERROR — undeclared API write
 *
 * Setup stays legal but becomes visible. Performing the action under test through the API
 * becomes impossible to do silently, which is the only property that actually mattered.
 *
 * WHAT IT FLAGS (only in files this rule is scoped to — see eslint.config.mjs)
 *   BAD:  await request.post('/bff/checkin', { data });        // Playwright API fixture
 *   BAD:  await page.request.post('/bff/checkin', { data });   // same, via page
 *   BAD:  await doorLedgerClient.admit(...)                    // *Client / *Api receiver
 *   GOOD: await page.getByTestId('door-admit').click();        // the real UI
 *   GOOD: // journey-setup: create the event under test
 *         await adminClient.createEvent(...);
 *
 * WHAT IT CANNOT OBSERVE
 *   - A UI-driven test that asserts nothing meaningful.
 *   - A `journey-setup:` marker used dishonestly to wave through the action under test.
 *     The marker makes that a review question instead of an invisible one; it cannot
 *     make it impossible.
 *   - An API call reached through an indirection whose receiver name matches none of the
 *     configured patterns. `receivers` / `receiverPattern` are the hand-maintained parts.
 */

const DEFAULT_RECEIVERS = ['request', 'apiContext', 'apiRequest', 'api'];
const DEFAULT_RECEIVER_PATTERN = '(Client|Api)$';
const DEFAULT_WRITE_METHODS = [
  'post',
  'put',
  'patch',
  'delete',
  'fetch',
  'create',
  'update',
  'remove',
  'admit',
  'checkIn',
  'submit',
];
const DEFAULT_ALLOW_MARKER = 'journey-setup:';

/** Resolves the receiver of `x.post()` / `page.request.post()` to `x` / `request`. */
function receiverNameOf(calleeObject) {
  if (calleeObject === undefined || calleeObject === null) return undefined;
  if (calleeObject.type === 'Identifier') return calleeObject.name;
  if (calleeObject.type === 'MemberExpression' && calleeObject.property?.type === 'Identifier') {
    return calleeObject.property.name;
  }
  if (calleeObject.type === 'ThisExpression') return 'this';
  return undefined;
}

/** True when a `journey-setup:` marker sits on, just above, or just after the statement. */
function hasAllowMarker(sourceCode, node, marker) {
  const before = sourceCode.getCommentsBefore(node) ?? [];
  const after = sourceCode.getCommentsAfter(node) ?? [];
  let statement = node;
  while (statement.parent !== undefined && statement.parent !== null && !/Statement|Declaration/.test(statement.parent.type)) {
    statement = statement.parent;
  }
  const aroundStatement =
    statement.parent === undefined || statement.parent === null
      ? []
      : [
          ...(sourceCode.getCommentsBefore(statement.parent) ?? []),
          ...(sourceCode.getCommentsBefore(statement) ?? []),
          ...(sourceCode.getCommentsAfter(statement) ?? []),
        ];
  return [...before, ...after, ...aroundStatement].some((c) => c.value.includes(marker));
}

const noApiShortcutInJourneyRule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'In a critical-path journey spec, every API write must be declared as setup with a `journey-setup:` comment. The action under test must go through the real UI.',
      category: 'Best Practices',
      recommended: true,
    },
    schema: [
      {
        type: 'object',
        properties: {
          receivers: { type: 'array', items: { type: 'string' } },
          receiverPattern: { type: 'string' },
          writeMethods: { type: 'array', items: { type: 'string' } },
          allowMarker: { type: 'string' },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      undeclaredApiWrite:
        "Undeclared API write '{{receiver}}.{{method}}()' in a critical-path journey spec. If this IS the action under test, drive the real UI instead — this exact shortcut hid a 415 and a ReferenceError on 2026-09-06 while the spec stayed green. If it is setup or teardown, say so: add a `// {{marker}} <why>` comment above it.",
    },
  },

  create(context) {
    const options = context.options[0] ?? {};
    const receivers = new Set(options.receivers ?? DEFAULT_RECEIVERS);
    const receiverPattern = new RegExp(options.receiverPattern ?? DEFAULT_RECEIVER_PATTERN);
    const writeMethods = new Set(options.writeMethods ?? DEFAULT_WRITE_METHODS);
    const marker = options.allowMarker ?? DEFAULT_ALLOW_MARKER;
    const sourceCode = context.sourceCode ?? context.getSourceCode();

    // Receivers discovered by CONSTRUCTION, not by name. The real door-checkin spec does
    // `const door = new KefiDoorLedgerClient()` — a name-only rule is blind to exactly the
    // file it was written for, which is the failure this whole rule is an instance of.
    const constructedClients = new Set();

    return {
      VariableDeclarator(node) {
        if (node.init?.type !== 'NewExpression') return;
        if (node.init.callee?.type !== 'Identifier') return;
        if (!receiverPattern.test(node.init.callee.name)) return;
        if (node.id?.type !== 'Identifier') return;
        constructedClients.add(node.id.name);
      },

      CallExpression(node) {
        const { callee } = node;
        if (callee.type !== 'MemberExpression') return;
        if (callee.property?.type !== 'Identifier') return;

        const method = callee.property.name;
        if (!writeMethods.has(method)) return;

        const receiver = receiverNameOf(callee.object);
        if (receiver === undefined) return;
        const isApiReceiver =
          receivers.has(receiver) ||
          receiverPattern.test(receiver) ||
          constructedClients.has(receiver);
        if (!isApiReceiver) return;

        if (hasAllowMarker(sourceCode, node, marker)) return;

        context.report({
          node,
          messageId: 'undeclaredApiWrite',
          data: { receiver, method, marker },
        });
      },
    };
  },
};

export default {
  rules: {
    'no-api-shortcut-in-journey': noApiShortcutInJourneyRule,
  },
};
