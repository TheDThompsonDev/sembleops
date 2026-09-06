import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { NodeConfigSchema } from "../src/config/schema.js";
import type { SembleopsConfig } from "../src/config/load.js";
import {
  assertServerSecurity,
  buildServer,
  type ApiDeps,
} from "../src/server/api.js";

const HUB_ENV = "SEMBLEOPS_TEST_HUB_TOKEN";
const WORKER_ENV = "SEMBLEOPS_TEST_WORKER_TOKEN";
const HUB_TOKEN = "h".repeat(32);
const WORKER_TOKEN = "w".repeat(32);

afterEach(() => {
  delete process.env[HUB_ENV];
  delete process.env[WORKER_ENV];
});

function config(options: {
  node?: "local" | "cloud";
  host?: string;
  dexMode?: "local" | "remote";
} = {}): SembleopsConfig {
  const node = NodeConfigSchema.parse({
    node: options.node ?? "local",
    timezone: "UTC",
    quiet_hours: { start: "21:00", end: "08:00" },
    discord: {
      token_env: "DISCORD_BOT_TOKEN",
      owner_user_id_env: "DISCORD_OWNER_USER_ID",
      channel: "inbox",
    },
    server: {
      port: 4747,
      host: options.host ?? "127.0.0.1",
      auth_token_env: HUB_ENV,
      worker_token_env: WORKER_ENV,
    },
    coding: {
      projects_root: ".",
      allowed_projects: [],
      dex_mode: options.dexMode ?? "local",
    },
    storage: {
      db_path: ":memory:",
      transcripts_dir: "data/transcripts",
      artifacts_dir: "data/artifacts",
    },
    nag: {
      snooze_cap: 3,
      blocked_recheck_hours: 72,
      morning_brief: "08:00",
      evening_reckoning: "20:30",
    },
    runtimes: [{ kind: "codex", default: true }],
  });
  return { node, personas: {} };
}

function deps(appConfig: SembleopsConfig): ApiDeps {
  const store = {
    getReminderSettings: (defaults: unknown) => defaults,
  };
  return {
    store: store as ApiDeps["store"],
    contentIdeas: {} as ApiDeps["contentIdeas"],
    delegations: {} as ApiDeps["delegations"],
    marco: {} as ApiDeps["marco"],
    config: appConfig,
    runtimeKinds: ["codex"],
    workerState: { lastSeen: null, projects: [] },
    onDelegationFinish: () => undefined,
  };
}

test("loopback local mode remains available without authentication", () => {
  assert.doesNotThrow(() => assertServerSecurity(config()));
});

test("health endpoint is available without authentication", async () => {
  const app = buildServer(deps(config()));

  try {
    const response = await app.inject({
      method: "GET",
      url: "/api/health",
    });

    assert.equal(response.statusCode, 200);

    assert.deepEqual(response.json(), {
      status: "Server is healthy",
    });
  } finally {
    await app.close();
  }
});

test("cloud and non-loopback modes fail closed without a strong hub token", () => {
  assert.throws(
    () => assertServerSecurity(config({ node: "cloud" })),
    /is required for cloud or non-loopback/,
  );
  assert.throws(
    () => assertServerSecurity(config({ host: "0.0.0.0" })),
    /is required for cloud or non-loopback/,
  );

  process.env[HUB_ENV] = "too-short";
  assert.throws(
    () => assertServerSecurity(config({ host: "0.0.0.0" })),
    /must be at least 32 characters/,
  );
});

test("remote worker mode fails closed without its own strong secret", () => {
  process.env[HUB_ENV] = HUB_TOKEN;
  assert.throws(
    () => assertServerSecurity(config({ node: "cloud", dexMode: "remote" })),
    /WORKER_TOKEN.*required|SEMBLEOPS_TEST_WORKER_TOKEN.*required/,
  );

  process.env[WORKER_ENV] = "too-short";
  assert.throws(
    () => assertServerSecurity(config({ node: "cloud", dexMode: "remote" })),
    /must be at least 32 characters/,
  );

  process.env[WORKER_ENV] = HUB_TOKEN;
  assert.throws(
    () => assertServerSecurity(config({ node: "cloud", dexMode: "remote" })),
    /must use different values/,
  );
});

test("login uses a hardened revocable session cookie", async () => {
  process.env[HUB_ENV] = HUB_TOKEN;
  const app = buildServer(deps(config({ node: "cloud" })));

  try {
    const unauthorized = await app.inject({ method: "GET", url: "/api/meta" });
    assert.equal(unauthorized.statusCode, 401);
    assert.equal(unauthorized.headers["cache-control"], "no-store");
    assert.match(unauthorized.headers["content-security-policy"] ?? "", /default-src 'self'/);
    assert.equal(unauthorized.headers["x-frame-options"], "DENY");
    assert.match(unauthorized.headers["strict-transport-security"] ?? "", /max-age=31536000/);

    const wrong = await app.inject({
      method: "POST",
      url: "/api/login",
      payload: { token: "wrong" },
    });
    assert.equal(wrong.statusCode, 401);

    const login = await app.inject({
      method: "POST",
      url: "/api/login",
      payload: { token: HUB_TOKEN },
    });
    assert.equal(login.statusCode, 200);
    const setCookie = login.headers["set-cookie"];
    assert.equal(typeof setCookie, "string");
    assert.match(setCookie as string, /^hub_session=/);
    assert.match(setCookie as string, /HttpOnly/i);
    assert.match(setCookie as string, /Secure/i);
    assert.match(setCookie as string, /SameSite=Strict/i);
    assert.doesNotMatch(setCookie as string, new RegExp(HUB_TOKEN));

    const cookie = (setCookie as string).split(";", 1)[0]!;
    const authenticated = await app.inject({
      method: "GET",
      url: "/api/meta",
      headers: { cookie },
    });
    assert.equal(authenticated.statusCode, 200);

    const logout = await app.inject({
      method: "POST",
      url: "/api/logout",
      headers: { cookie },
    });
    assert.equal(logout.statusCode, 200);

    const revoked = await app.inject({
      method: "GET",
      url: "/api/meta",
      headers: { cookie },
    });
    assert.equal(revoked.statusCode, 401);

    const headerAuthenticated = await app.inject({
      method: "GET",
      url: "/api/meta",
      headers: { "x-hub-token": HUB_TOKEN },
    });
    assert.equal(headerAuthenticated.statusCode, 200);
  } finally {
    await app.close();
  }
});
