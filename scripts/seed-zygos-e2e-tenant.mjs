// Ensure the dedicated FINREG/zygos E2E tenant has enough payment instructions for the @ui tier's
// LIST screens to have something to render.
//
// ── Why this exists ──────────────────────────────────────────────────────────
// The E2E fixture users used to live in the PUBLIC demo tenant, so the @ui tier was quietly
// reading demo-seeded rows: `zygos-i18n.ui.spec.ts` opens "the first instruction in the list" to
// reach the detail screen, and `zygos-pager.ui.spec.ts` needs more than one page. Neither creates
// a row; both simply assumed rows existed, because in the demo tenant ~345 always did.
//
// Now that the suite has its own tenant those rows have to come from somewhere. They come from
// HERE, through the real API, rather than from a test's beforeAll, because:
//   * payment instructions are APPEND-ONLY (contract §2 — there is no DELETE route), so seeding is
//     a one-time cost, not a per-run one, and paying it per run would add rows forever;
//   * a 30-row seed inside a spec would blow the 100-req/60s-per-user budget the whole tier shares.
//
// Idempotent: counts first and creates only the shortfall. A no-op on every run after the first.
//
// Usage:  node scripts/seed-zygos-e2e-tenant.mjs [--min 30]
const BASE = (process.env.ZYGOS_WEB_URL?.trim() || 'https://app.finreg.dloizides.com').replace(/\/+$/, '');
const API = '/bff/api/zygos/api/v1';
const USER = process.env.ZYGOS_SEED_USER || 'zygos-maker-a';
const PASSWORD = process.env.ZYGOS_TEST_PASSWORD?.trim() || 'SuperUser123!';

// > SMALL_PAGE_SIZE (25) in zygos-pager.ui.spec.ts, so the instructions list has a second page.
const DEFAULT_MIN_ROWS = 30;
const minIndex = process.argv.indexOf('--min');
const MIN_ROWS = minIndex > -1 ? Number(process.argv[minIndex + 1]) : DEFAULT_MIN_ROWS;

const csrf = { 'X-BFF-Csrf': '1', Origin: BASE, 'Content-Type': 'application/json' };

async function login() {
  const res = await fetch(`${BASE}/bff/login`, {
    method: 'POST',
    headers: csrf,
    body: JSON.stringify({ username: USER, password: PASSWORD }),
    redirect: 'manual',
  });
  if (!res.ok) throw new Error(`login as ${USER} failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
  const jar = (res.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ');
  if (!jar) throw new Error('login returned no session cookie');
  return jar;
}

async function currentCount(jar) {
  const res = await fetch(`${BASE}${API}/payment-instructions?pageSize=1`, {
    headers: { Cookie: jar, Origin: BASE },
  });
  if (!res.ok) throw new Error(`list failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
  return (await res.json()).totalCount ?? 0;
}

function instructionBody(tag) {
  // Mirrors `instructionBody` in tests/zygos/zygos-client.ts. Tagged so the rows are obviously
  // provisioning fixtures and can be told apart from a spec's own tagged rows.
  return {
    amount: 100.5,
    currency: 'EUR',
    valueDate: '2026-08-01',
    direction: 'Outgoing',
    debtor: { name: `Debtor ${tag}`, iban: 'CY17002001280000001200527600', country: 'CY' },
    creditor: { name: `Creditor ${tag}`, iban: 'DE89370400440532013000', country: 'DE' },
    remittanceInfo: tag,
  };
}

const jar = await login();
const before = await currentCount(jar);
console.log(`[seed] ${USER} sees ${before} payment instruction(s); minimum wanted: ${MIN_ROWS}`);

if (before >= MIN_ROWS) {
  console.log('[seed] nothing to do.');
  process.exit(0);
}

let created = 0;
for (let i = before; i < MIN_ROWS; i++) {
  const tag = `ZY-E2E-SEED-${Date.now().toString(36)}-${i}`;
  const res = await fetch(`${BASE}${API}/payment-instructions`, {
    method: 'POST',
    headers: { ...csrf, Cookie: jar },
    body: JSON.stringify(instructionBody(tag)),
  });
  if (!res.ok) {
    console.error(`[seed] create #${i} failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
    process.exit(1);
  }
  created++;
  // Stay under the 100-requests/60s-per-user budget the whole suite shares.
  await new Promise((r) => setTimeout(r, 700));
}

console.log(`[seed] created ${created}; tenant now has ${await currentCount(jar)}.`);
