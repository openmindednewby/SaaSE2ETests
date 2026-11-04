import { execFileSync } from 'node:child_process';

const PROD_HOST = 'root@204.168.225.236';
const STAGING_HOST = 'jim@10.0.0.2';
const SSH_TIMEOUT_MS = 240_000;
const FIELD_SEPARATOR = '|';
const PSQL_READ_ONLY = `PGOPTIONS="-c default_transaction_read_only=on" psql -U "$POSTGRES_USER" -At -v ON_ERROR_STOP=1 -F "${FIELD_SEPARATOR}"`;

function ssh(host: string, command: string, input?: string): string {
  const options = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10'];
  return execFileSync('ssh', [...options, host, command], { input, encoding: 'utf8', timeout: SSH_TIMEOUT_MS }).trim();
}

function readProd(pod: string, database: string, sql: string): string {
  return ssh(PROD_HOST, `kubectl exec -i -n dloizides ${pod} -- sh -c '${PSQL_READ_ONLY} -d ${database}'`, sql);
}

function readJinxDb(sql: string): string {
  return ssh(STAGING_HOST, `sudo -n kubectl exec -i -n dloizides saas-db-0 -- sh -c '${PSQL_READ_ONLY} -d JinxDB'`, sql);
}

export interface JinxRows {
  patterns: number;
  favourites: number;
}

export interface LedgerState {
  requestStatus: number;
  completedAt: string;
  rows: number;
  service: string;
  status: number;
  attempts: number;
  confirmedAt: string;
  buildSha: string;
  erased: string;
  readBack: string;
  lastFailure: string;
}

export function stopJinxApi(): void {
  ssh(STAGING_HOST, 'sudo -n kubectl scale deploy/jinx-api -n dloizides --replicas=0 && sudo -n kubectl wait pod -l app=jinx-api -n dloizides --for=delete --timeout=90s');
}

export function startJinxApi(): void {
  ssh(STAGING_HOST, 'sudo -n kubectl scale deploy/jinx-api -n dloizides --replicas=1 && sudo -n kubectl rollout status deploy/jinx-api -n dloizides --timeout=200s');
}

export function patternOwner(externalId: string): string {
  return readJinxDb(`select "OwnerUserId" from "Patterns" where "ExternalId"='${externalId}';`);
}

export function jinxRows(userId: string): JinxRows {
  const line = readJinxDb(
    `select (select count(*) from "Patterns" where "OwnerUserId"='${userId}'), (select count(*) from "Favourites" where "UserId"='${userId}');`,
  );
  const [patterns, favourites] = line.split(FIELD_SEPARATOR).map(Number);
  return { patterns, favourites };
}

export function loginEnabled(userId: string): string {
  return readProd('keycloak-db-0', 'keycloak', `select enabled from user_entity where id='${userId}';`);
}

export function ledgerOf(userId: string): LedgerState {
  const line = readProd(
    'saas-db-0',
    'IdentityServiceDb',
    `select r."Status", coalesce(r."CompletedAt"::text, ''), count(e."Id") over (), coalesce(e."Service", ''), coalesce(e."Status", -1),
       coalesce(e."AttemptCount", 0), coalesce(e."ConfirmedAt"::text, ''), coalesce(e."BuildSha", ''), coalesce(e."ErasedRowCount"::text, ''),
       coalesce(e."ReadBackRowCount"::text, ''), coalesce(regexp_replace(e."LastFailure", '[|\\n]', ' ', 'g'), '')
     from "AccountDeletionRequests" r left join "ErasureLedgerEntries" e on e."AccountDeletionRequestId" = r."Id"
     where r."UserId" = '${userId}' order by r."Id" desc limit 1;`,
  );
  const [requestStatus, completedAt, rows, service, status, attempts, confirmedAt, buildSha, erased, readBack, lastFailure] = line.split(FIELD_SEPARATOR);
  return {
    requestStatus: Number(requestStatus),
    completedAt,
    rows: Number(rows),
    service,
    status: Number(status),
    attempts: Number(attempts),
    confirmedAt,
    buildSha,
    erased,
    readBack,
    lastFailure,
  };
}
