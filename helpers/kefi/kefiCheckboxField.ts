/**
 * State helpers for kefi-web's shared `CheckboxField` row.
 *
 * Generic to the component, not to any one card: `CheckboxField` is used across
 * the organizer dashboard (the notification channels, the promoter table, the
 * message-template defaults), so every spec driving any of them needs the same
 * workaround and the same defect assertion. Keeping them here means a fix to
 * the component is picked up everywhere at once.
 */

import { type Locator, expect } from '@playwright/test';

/**
 * The glyph `CheckboxField` renders inside the box when checked. Measured, not
 * assumed — see {@link isChecked}.
 */
export const CHECK_GLYPH = '✓';

/**
 * True when a `CheckboxField` row is currently checked.
 *
 * ⚠️ Reads the ✓ GLYPH, not `aria-checked`, and that is a deliberate
 * concession to a defect rather than a preference.
 *
 * `CheckboxField` renders `role="checkbox"` on a plain `<div>` and passes its
 * checked state via React Native's `accessibilityState={{ checked }}`, which
 * this version of react-native-web does NOT map to an `aria-checked`
 * attribute. Measured against prod: the rendered element carries `role`,
 * `aria-label`, `tabindex` and nothing else, before OR after a click. The only
 * DOM difference a click makes is the appearance of the ✓ text node.
 *
 * So `aria-checked` cannot be used to detect state — it is permanently absent,
 * which means an assertion like `expect(aria-checked).not.toBe('true')` passes
 * for a checkbox that IS checked. That is the trap this comment exists to stop
 * the next reader falling into: the natural locator is not merely unreliable
 * here, it silently reports every checkbox as unchecked.
 *
 * The missing attribute is itself a defect and is asserted separately by
 * `expectExposesCheckedStateToAssistiveTech` — this helper only needs the
 * functional truth so the behavioural specs can run.
 */
export async function isChecked(control: Locator): Promise<boolean> {
  const text = await control.innerText();
  return text.includes(CHECK_GLYPH);
}

/**
 * Assert a checkbox row reports its state to assistive technology.
 *
 * An element with `role="checkbox"` and no `aria-checked` is invalid ARIA: a
 * screen reader announces "…, checkbox" and cannot say whether it is on or off.
 * For this card specifically that means an organizer using VoiceOver or
 * TalkBack cannot determine whether she will be told about a registration —
 * which is the entire question the card exists to answer.
 */
export async function expectExposesCheckedStateToAssistiveTech(
  control: Locator,
  name: string,
): Promise<void> {
  await expect(control, `${name} is rendered`).toBeVisible();

  const role = await control.getAttribute('role');
  const ariaChecked = await control.getAttribute('aria-checked');
  const visuallyChecked = await isChecked(control);

  expect(
    ariaChecked,
    `${name} declares role="${role}" but renders NO aria-checked attribute (it is visually ` +
      `${visuallyChecked ? 'CHECKED' : 'unchecked'} right now). A checkbox role without ` +
      'aria-checked is invalid ARIA: a screen reader announces the label and the role but ' +
      'cannot say whether the box is ticked. An organizer using VoiceOver or TalkBack therefore ' +
      'cannot tell whether registration notifications are ON — the one fact this card exists to ' +
      'communicate. Cause: CheckboxField passes React Native\'s accessibilityState={{ checked }}, ' +
      'which this react-native-web version does not map to aria-checked; the modern prop is a ' +
      'plain `aria-checked`. The checked state currently reaches the user through the ✓ glyph ' +
      'alone, i.e. through sight only.',
  ).not.toBeNull();

  expect(String(ariaChecked), `${name} reports the CORRECT state to assistive tech`).toBe(
    String(visuallyChecked),
  );
}

/** Assert a checkbox row's checked state, with a message naming the control. */
export async function expectChecked(
  control: Locator,
  name: string,
  expected: boolean,
): Promise<void> {
  await expect(control, `${name} is rendered`).toBeVisible();
  expect(
    await isChecked(control),
    `${name} is ${expected ? 'ON' : 'OFF'}. A notification setting that does not read back the ` +
      'way the organizer left it is worse than no setting at all — she has no way to tell ' +
      'whether she will actually be told about a registration.',
  ).toBe(expected);
}

/** Set a checkbox row to an exact state (pressing it only when it must change). */
export async function setChecked(control: Locator, next: boolean): Promise<void> {
  if ((await isChecked(control)) === next) return;
  await control.click();
  await expect
    .poll(async () => isChecked(control), { timeout: 5_000 })
    .toBe(next);
}
