/**
 * Placeholder image helpers for the Phase C KUCY-shaped landing fixture.
 *
 * Uses placehold.co — a zero-config image generator that returns a real PNG
 * for any size. The hostname pattern is stable; the spec's subdomain probe
 * looks for "placehold.co" as one of the markers proving the API overlay
 * pipeline runs.
 *
 * Sizes chosen to match the slots template-1's components ask for:
 *   - hero:    1200x630 (Open Graph aspect)
 *   - logo:     400x120
 *   - person:   400x400
 */

const PLACEHOLDER_HOST = 'https://placehold.co';

/** Build a placeholder PNG URL at the given dimensions. */
export function placeholderImage(width: number, height: number): string {
  return `${PLACEHOLDER_HOST}/${width}x${height}.png`;
}

/** Hero / poster image — 1200x630 (Open Graph aspect). */
export function placeholderHero(): string {
  return placeholderImage(1200, 630);
}

/** Logo lockup — 400x120 (wide-rectangle aspect). */
export function placeholderLogo(): string {
  return placeholderImage(400, 120);
}

/** Performer headshot — 400x400 square. */
export function placeholderPerson(): string {
  return placeholderImage(400, 400);
}
