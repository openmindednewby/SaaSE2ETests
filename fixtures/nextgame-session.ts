import { execFileSync } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * NextGame has no Keycloak realm: the only identity is an HMAC-signed cookie that the API
 * issues after Steam OpenID (`NextGame.Web/Session/SessionCookie.cs`). Steam OpenID cannot be
 * driven from a test, so the suite mints the SAME token from the SAME local signing key and
 * seeds the user row the endpoints look up.
 *
 * Minting a cookie is NOT hand-assembling a request: every URL, method, body and header of the
 * calls under test still comes from the SPA's own `createNextGameApi`.
 */
const COOKIE_NAME = '__Host-nextgame-session';
const DAY_SECONDS = 86_400;
const CONTAINER = 'SharedDB';
const DB = 'nextgame';
const NEWLINE = String.fromCharCode(10);

export const NEXTGAME_API_URL = process.env.NEXTGAME_API_URL ?? 'http://localhost:5105';

function signingKey(): string {
  const envKey = process.env.NEXTGAME_SESSION_SIGNING_KEY;
  if (envKey) return envKey;
  // The compose file interpolates ${NEXTGAME_SESSION_SIGNING_KEY} from the SaaS-root .env.local,
  // and its `environment:` block OVERRIDES `env_file`, so this is the one authoritative source.
  const envFile = readFileSync(join(process.cwd(), '..', '.env.local'), 'utf8');
  const line = envFile.split(/\r?\n/).find((l) => l.startsWith('NEXTGAME_SESSION_SIGNING_KEY='));
  if (!line) throw new Error('NEXTGAME_SESSION_SIGNING_KEY missing from SaaS/.env.local');
  return line.slice('NEXTGAME_SESSION_SIGNING_KEY='.length).trim();
}

function psql(sql: string): string {
  return execFileSync('docker', ['exec', CONTAINER, 'psql', '-U', 'postgres', '-d', DB, '-t', '-A', '-c', sql], {
    encoding: 'utf8',
  });
}

export interface NextGameUser {
  userId: string;
  steamId64: string;
  cookie: string;
}

/** Mints the cookie for an arbitrary id — used for the "expired / not a real user" negative cases. */
export function mintCookie(userId: string, lifetimeSeconds = DAY_SECONDS): string {
  const expiresAt = Math.floor(Date.now() / 1000) + lifetimeSeconds;
  const payload = `${userId.replace(/-/g, '')}.${String(expiresAt)}`;
  const signature = createHmac('sha256', signingKey()).update(payload).digest('hex').toUpperCase();
  return `${COOKIE_NAME}=${payload}.${signature}`;
}

/** Inserts a users row and returns a signed cookie for it. */
export function createSignedInUser(): NextGameUser {
  const userId = randomUUID();
  const steamId64 = `7656119${String(Date.now()).slice(-10)}${String(Math.floor(Math.random() * 100)).padStart(2, '0')}`;
  psql(
    `INSERT INTO users ("Id","SteamId64","BirthYear","CreatedAt","LastSeenAt") ` +
      `VALUES ('${userId}','${steamId64}',1990,now(),now());`,
  );
  return { userId, steamId64, cookie: mintCookie(userId) };
}

/**
 * Seeds the library snapshot the import job would have written. The job serialises
 * `ImportedLibrary` with System.Text.Json defaults, so the jsonb is PascalCase; the WIRE
 * contract the SPA reads is camelCase and is produced by `LibraryView`.
 */
export function seedLibrarySnapshot(userId: string): void {
  const payload = JSON.stringify({
    TakenAt: new Date().toISOString(),
    Games: [
      { AppId: 440, Name: 'Team Fortress 2', MinutesForever: 1200, MinutesTwoWeeks: 30 },
      { AppId: 570, Name: 'Dota 2', MinutesForever: 0, MinutesTwoWeeks: 0 },
    ],
  });
  psql(
    `INSERT INTO library_snapshots ("Id","UserId","TakenAt","Payload") ` +
      `VALUES (gen_random_uuid(),'${userId}',now(),'${payload}'::jsonb) ` +
      `ON CONFLICT ("UserId") DO UPDATE SET "Payload" = EXCLUDED."Payload", "TakenAt" = now();`,
  );
}

export function deleteUser(userId: string): void {
  psql(`DELETE FROM users WHERE "Id" = '${userId}';`);
}

/** A fetch that carries one user's session cookie. Everything else about the request is the SPA's. */
export function cookieFetch(cookie: string | null) {
  return async (input: string | URL, init?: RequestInit): Promise<Response> => {
    const headers = new Headers(init?.headers);
    if (cookie) headers.set('Cookie', cookie);
    return globalThis.fetch(input, { ...init, headers });
  };
}

/** Reads back the persisted consent rows as `purpose|granted|policyVersion` strings. */
export function consentRowsFor(userId: string): string[] {
  return psql(`SELECT "Purpose" || '|' || "Granted" || '|' || "PolicyVersion" FROM consents WHERE "UserId" = '${userId}';`)
    .split(NEWLINE)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}
