/**
 * Poueni host resolution for E2E. Mirrors the per-target hostname pattern the
 * Poueni marketing/dashboard pages use at runtime (`resolveApiOrigin()` in
 * apps/web-landing + the dashboard's same-origin `/bff/*`).
 *
 *   prod    → public LE-fronted hosts
 *   staging → staging.* hosts (WireGuard-only; reachable from the in-cluster
 *             runner or a dev PC with the host-override DNS patch)
 *   local   → docker-compose ports
 *
 * `marketingUrl` hosts the /signup, /forgot-password, /reset-password pages.
 * `dashboardUrl` hosts the SPA login (`/login`) whose form POSTs same-origin
 * `/bff/login`. `apiUrl` is the public poueni-api (`/v1/public/*`).
 */
import { e2eTarget } from '../target.js';

export interface PoueniUrls {
  marketingUrl: string;
  dashboardUrl: string;
  apiUrl: string;
}

const PROD: PoueniUrls = {
  marketingUrl: 'https://poueni.dloizides.com',
  dashboardUrl: 'https://app.poueni.dloizides.com',
  apiUrl: 'https://api.poueni.dloizides.com',
};

const STAGING: PoueniUrls = {
  marketingUrl: 'https://poueni.staging.dloizides.com',
  dashboardUrl: 'https://app.poueni.staging.dloizides.com',
  apiUrl: 'https://poueni.staging.dloizides.com',
};

const LOCAL: PoueniUrls = {
  marketingUrl: 'http://localhost:4321',
  dashboardUrl: 'http://localhost:5173',
  apiUrl: 'http://localhost:5085',
};

export function getPoueniUrls(): PoueniUrls {
  const target = e2eTarget();
  if (target === 'prod') return PROD;
  if (target === 'staging') return STAGING;
  return LOCAL;
}
