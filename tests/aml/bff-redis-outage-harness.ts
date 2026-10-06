// Infra control for the BFF-REDIS-1 "Redis resilience" reconnect spec.
//
// Seam: the SHARED staging Redis (sessions for bff-aml, bff-zygos, bff-agora, bff-ichnos) is never
// touched. Instead a throwaway pod runs the exact image + env of the live bff-aml Deployment, with
// ONLY its Redis connection string pointed at a private stand-in Service. The Service starts with no
// selector (no endpoints, so connects are refused at once = "Redis unreachable") and gets the real
// Redis selector added to "bring Redis back". The pod carries no `app: bff-aml` label, so it never
// joins the bff-aml Service and no user request reaches it.
//
// Everything is driven over `ssh <STAGING_SSH> sudo kubectl` (default jim@10.0.0.2, WireGuard) and
// the pod is probed through the API-server pod proxy, so no port-forward is left behind. Teardown
// deletes by label, so a run killed half-way is swept by the next run's `sweep()`.
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const NAMESPACE = process.env.AML_BFF_NAMESPACE?.trim() || 'dloizides';
const SSH_TARGET = process.env.STAGING_SSH?.trim() || 'jim@10.0.0.2';
const SOURCE_DEPLOYMENT = 'bff-aml';
const PROBE_LABEL = 'e2e-probe';
const PROBE_LABEL_VALUE = 'bff-redis-reconnect';
const REDIS_SELECTOR = { app: 'redis' };
const REDIS_PORT = 6379;
const CONTAINER_PORT = 8080;
const SSH_TIMEOUT_MS = 90_000;
const POD_RUNNING_TIMEOUT = '90s';
const RUN_ID_BYTES = 3;
const REDIS_CONNECTION_ENV = 'Bff__Redis__ConnectionString';

export const enum HealthPath {
  Live = 'live',
  Ready = 'ready',
}

export interface KubectlResult {
  ok: boolean;
  output: string;
}

interface ContainerSpec {
  env?: { name: string; value?: string }[];
  livenessProbe?: unknown;
  readinessProbe?: unknown;
  startupProbe?: unknown;
}

interface PodSpec {
  containers: ContainerSpec[];
  restartPolicy?: string;
}

function kubectl(args: string, input?: string): KubectlResult {
  const command = `sudo kubectl -n ${NAMESPACE} ${args}`;
  try {
    const output = execFileSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', SSH_TARGET, command], {
      input,
      encoding: 'utf8',
      timeout: SSH_TIMEOUT_MS,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { ok: true, output };
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; message?: string };
    return { ok: false, output: `${failure.stdout ?? ''}${failure.stderr ?? failure.message ?? ''}` };
  }
}

function mustKubectl(what: string, args: string, input?: string): string {
  const result = kubectl(args, input);
  if (!result.ok) throw new Error(`BFF-REDIS-1 harness: ${what} failed: ${result.output.trim()}`);
  return result.output;
}

function standInService(name: string, withRedis: boolean): string {
  const selector = withRedis ? { selector: REDIS_SELECTOR } : {};
  return JSON.stringify({
    apiVersion: 'v1',
    kind: 'Service',
    metadata: { name, namespace: NAMESPACE, labels: { [PROBE_LABEL]: PROBE_LABEL_VALUE } },
    spec: { ...selector, ports: [{ port: REDIS_PORT, targetPort: REDIS_PORT, protocol: 'TCP' }] },
  });
}

function probePod(name: string, serviceName: string): string {
  const deployment = JSON.parse(mustKubectl('read bff-aml deployment', `get deploy ${SOURCE_DEPLOYMENT} -o json`));
  const spec = deployment.spec.template.spec as PodSpec;
  const [container] = spec.containers;
  delete container.livenessProbe;
  delete container.readinessProbe;
  delete container.startupProbe;
  const env = (container.env ?? []).filter((entry) => entry.name !== REDIS_CONNECTION_ENV);
  container.env = [...env, { name: REDIS_CONNECTION_ENV, value: `${serviceName}:${REDIS_PORT}` }];
  spec.restartPolicy = 'Never';
  return JSON.stringify({
    apiVersion: 'v1',
    kind: 'Pod',
    metadata: { name, namespace: NAMESPACE, labels: { [PROBE_LABEL]: PROBE_LABEL_VALUE } },
    spec,
  });
}

export class BffRedisOutageProbe {
  readonly podName: string;
  readonly serviceName: string;

  constructor() {
    const runId = randomBytes(RUN_ID_BYTES).toString('hex');
    this.podName = `bff-aml-redis-e2e-${runId}`;
    this.serviceName = `bff-aml-redis-standin-${runId}`;
  }

  sweep(): void {
    kubectl(`delete pod,svc -l ${PROBE_LABEL}=${PROBE_LABEL_VALUE} --ignore-not-found --wait=false`);
  }

  startWithRedisUnreachable(): void {
    mustKubectl('create stand-in Service (no endpoints)', 'apply -f -', standInService(this.serviceName, false));
    mustKubectl('create probe pod', 'apply -f -', probePod(this.podName, this.serviceName));
    mustKubectl(
      'wait for probe pod Running',
      `wait --for=jsonpath={.status.phase}=Running pod/${this.podName} --timeout=${POD_RUNNING_TIMEOUT}`,
    );
  }

  restoreRedis(): void {
    mustKubectl('add the real Redis selector', 'apply -f -', standInService(this.serviceName, true));
  }

  health(path: HealthPath): KubectlResult {
    return kubectl(`get --raw /api/v1/namespaces/${NAMESPACE}/pods/${this.podName}:${CONTAINER_PORT}/proxy/health/${path}`);
  }

  logs(): string {
    return kubectl(`logs pod/${this.podName} --tail=200`).output;
  }

  teardown(): void {
    kubectl(`delete pod/${this.podName} svc/${this.serviceName} --ignore-not-found --wait=false`);
    this.sweep();
  }
}
