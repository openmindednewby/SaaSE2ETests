/**
 * Custom ESLint Rule: No networkidle
 *
 * Prohibits the string literal 'networkidle' anywhere in test code.
 * This wait strategy is slow, flaky, and deprecated by Playwright best practices.
 * Use 'domcontentloaded' or 'commit' with actionable waits instead.
 *
 * Examples:
 *   BAD:  await page.goto(url, { waitUntil: 'networkidle' });
 *   BAD:  await page.waitForLoadState('networkidle');
 *   GOOD: await page.goto(url, { waitUntil: 'domcontentloaded' });
 *   GOOD: await page.waitForLoadState('domcontentloaded');
 */

const noNetworkidleRule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        "Disallow 'networkidle' string. Use 'domcontentloaded' or 'commit' with actionable waits instead.",
      category: 'Best Practices',
      recommended: true,
    },
    schema: [],
    messages: {
      noNetworkidle:
        "Avoid 'networkidle'. It waits for 500ms of no network activity, making tests slow and flaky. Use 'domcontentloaded' or 'commit' with actionable waits instead.",
    },
  },

  create(context) {
    return {
      Literal(node) {
        if (node.value === 'networkidle')
          context.report({ node, messageId: 'noNetworkidle' });
      },
    };
  },
};

export default {
  rules: {
    'no-networkidle': noNetworkidleRule,
  },
};
