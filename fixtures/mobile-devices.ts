import { devices } from '@playwright/test';

/**
 * Device DESCRIPTORS, never bare viewports. A `viewport: {width, height}` alone
 * leaves `isMobile` false, the device-scale-factor at 1, `hasTouch` off and a
 * DESKTOP user-agent, so the page is rendered by a desktop engine that happens
 * to be narrow: `<meta name="viewport">` is not honoured, the visual viewport is
 * not emulated, and a layout that only breaks under real mobile viewport
 * semantics is papered over instead of reproduced.
 *
 * The heights below are the descriptors' own values, read from the installed
 * Playwright rather than from a spec sheet - a descriptor height is the USABLE
 * viewport with browser chrome already subtracted, so Pixel 5 is 393x727 and
 * not the 393x851 physical screen.
 */
type DeviceDescriptor = (typeof devices)[string];
type MobileDescriptor = Omit<DeviceDescriptor, 'defaultBrowserType'>;

/**
 * A descriptor with `defaultBrowserType` removed, so it can be passed to a
 * DESCRIBE-scoped `test.use(...)`. That one key forces a new worker, and
 * Playwright refuses it anywhere but top level: a describe-scoped
 * `test.use(devices['Pixel 5'])` fails at LOAD time and the whole file (and in
 * `--list`, the whole project) reports 0 tests. Every emulation key that matters
 * - viewport, isMobile, hasTouch, deviceScaleFactor, userAgent - is kept; the
 * browser comes from the project, which is Chromium everywhere these are used.
 */
function withoutBrowserType(descriptor: DeviceDescriptor): MobileDescriptor {
  const { defaultBrowserType: _ignored, ...emulation } = descriptor;
  return emulation;
}

/** The floor every surface must survive: 360x640. */
export const MOBILE_FLOOR = withoutBrowserType(devices['Galaxy S5']);
/** The representative modern phone: 393x727 (screen 393x851). */
export const MOBILE_REPRESENTATIVE = withoutBrowserType(devices['Pixel 5']);
