# playwright-e2e — in-cluster canary Job runner image (Phase 4 of the
# e2e-multi-environment effort). One image runs any suite; the suite is
# selected at run time via the E2E_SUITE env var.
#
# Used by:
#   - personalServerNotes/k8s/playwright-e2e/job.yml.tpl  (the canary Job —
#     command: node scripts/run-canary-incluster.mjs)
#   - personalServerNotes/k8s/playwright-e2e/orphan-cleanup.cronjob.yml
#     (weekly sweep — command: node scripts/canary-incluster-cleanup.mjs)
#
# Build / deploy:  personalServerNotes/scripts/manage.sh deploy playwright-e2e
FROM mcr.microsoft.com/playwright:v1.48.0-noble
LABEL org.opencontainers.image.authors="dloizides.com"
LABEL org.opencontainers.image.vendor="dloizides.com"
LABEL org.opencontainers.image.title="playwright-e2e"
LABEL built-by="dloizides.com"

WORKDIR /app

# kubectl — the lock mechanism (helpers/canary-lock.ts) and the orphan-cleanup
# script create/get/delete the canary-run-lock ConfigMap via kubectl against
# the in-cluster API server (RBAC granted by k8s/playwright-e2e/rbac.yml).
# AWS CLI v2 — the wrapper uploads the HTML report + traces to SeaweedFS S3,
# and the orphan-cleanup script does the 30-day S3 retention sweep. Installed
# from the official zip: Ubuntu noble dropped the `awscli` apt package.
# kubectl pinned to match the staging/prod K3s server minor (v1.34.x) — the
# lock ops are trivial configmap CRUD, but matching avoids version-skew.
ARG KUBECTL_VERSION=v1.34.0
RUN apt-get update \
    && apt-get install -y --no-install-recommends unzip ca-certificates curl \
    && curl -fsSL -o /usr/local/bin/kubectl \
       "https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/amd64/kubectl" \
    && chmod +x /usr/local/bin/kubectl \
    && curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o /tmp/awscliv2.zip \
    && unzip -q /tmp/awscliv2.zip -d /tmp \
    && /tmp/aws/install \
    && rm -rf /tmp/awscliv2.zip /tmp/aws \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Copy package files first for layer caching.
COPY package*.json ./

# `npm ci` (NOT `--omit=dev`): the runtime deps (axios, dotenv,
# @playwright/test) all live under devDependencies in package.json, so
# `--omit=dev` would produce a broken image.
RUN npm ci

# Copy test files (.dockerignore strips node_modules, reports, secrets, etc.).
COPY . .

# Browsers — Chromium only; the in-cluster canary runs the chromium projects.
RUN npx playwright install --with-deps chromium

RUN mkdir -p reports test-results

# AWS CLI v2.23+ enables data-integrity checksums (CRC32) by default. SeaweedFS
# (and most non-AWS S3 implementations) reject the checksum trailers with an
# opaque `InternalError` on PutObject. Force the pre-2.23 behaviour so
# `aws s3 cp` works against SeaweedFS — applies to both the report upload
# (run-canary-incluster.mjs) and the retention sweep (canary-incluster-cleanup.mjs).
ENV AWS_REQUEST_CHECKSUM_CALCULATION=when_required
ENV AWS_RESPONSE_CHECKSUM_VALIDATION=when_required

# Default command. The Job + CronJob manifests override `command:` explicitly;
# this is just a sensible bare-image default.
CMD ["npx", "playwright", "test", "--reporter=html,json"]
