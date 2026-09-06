import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import fastifyCookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { Marco, MarcoResponse } from "../agents/marco.js";
import type { SembleopsConfig } from "../config/load.js";
import { defaultNagTime, parseCapture } from "../engine/capture.js";
import type {
  ContentHandoff,
  Delegation,
  DelegationStore,
} from "../engine/delegations.js";
import { blockedRecheckLine, larryLine, MAX_LEVEL } from "../engine/nag.js";
import type { ContentIdeaStore, ContentIdeaUpdate } from "../engine/contentIdeas.js";
import { listProjects } from "../engine/projects.js";
import { transcribeAudio } from "../engine/transcribe.js";
import { openAiApiKeyAvailable } from "../runtime/openaiConfig.js";
import type { TaskStore } from "../engine/store.js";
import type {
  ContentIdeaPriority,
  ContentIdeaStage,
  ContentIdea,
  DecisionInput,
  InboxItem,
} from "../shared/types.js";

const TIME_HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;
const MIN_SECRET_LENGTH = 32;

export interface WorkerState {
  lastSeen: string | null;
  projects: string[];
}

export interface ApiDeps {
  store: TaskStore;
  contentIdeas: ContentIdeaStore;
  delegations: DelegationStore;
  marco: Marco;
  config: SembleopsConfig;
  runtimeKinds: string[];
  workerState: WorkerState;
  onDelegationFinish: (job: Delegation) => void;
}

type ContentIdeaBody = {
  title?: unknown;
  hook?: unknown;
  angle?: unknown;
  audience?: unknown;
  notes?: unknown;
  stage?: unknown;
  priority?: unknown;
  tags?: unknown;
  target_date?: unknown;
};

const CONTENT_STAGES = new Set<ContentIdeaStage>(["inbox", "shaping", "ready", "drafting"]);
const CONTENT_PRIORITIES = new Set<ContentIdeaPriority>(["low", "normal", "high"]);

function validContentStage(value: unknown): value is ContentIdeaStage {
  return typeof value === "string" && CONTENT_STAGES.has(value as ContentIdeaStage);
}

function validContentPriority(value: unknown): value is ContentIdeaPriority {
  return typeof value === "string" && CONTENT_PRIORITIES.has(value as ContentIdeaPriority);
}

function validTargetDate(value: unknown): value is string | null {
  if (value === null) return true;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function contentPatch(body: ContentIdeaBody): { patch?: ContentIdeaUpdate; error?: string } {
  const patch: ContentIdeaUpdate = {};
  const textFields = ["hook", "angle", "audience", "notes"] as const;

  if (body.title !== undefined) {
    if (typeof body.title !== "string" || body.title.trim().length === 0) {
      return { error: "title must not be empty" };
    }
    if (body.title.trim().length > 240) return { error: "title must be 240 characters or fewer" };
    patch.title = body.title;
  }
  for (const field of textFields) {
    const value = body[field];
    if (value === undefined) continue;
    if (typeof value !== "string") return { error: `${field} must be text` };
    const max = field === "notes" ? 50_000 : 2_000;
    if (value.length > max) return { error: `${field} is too long` };
    patch[field] = value;
  }
  if (body.stage !== undefined) {
    if (!validContentStage(body.stage)) return { error: "invalid content stage" };
    patch.stage = body.stage;
  }
  if (body.priority !== undefined) {
    if (!validContentPriority(body.priority)) return { error: "invalid content priority" };
    patch.priority = body.priority;
  }
  if (body.tags !== undefined) {
    if (!Array.isArray(body.tags) || !body.tags.every((tag) => typeof tag === "string")) {
      return { error: "tags must be a list of text values" };
    }
    patch.tags = body.tags;
  }
  if (body.target_date !== undefined) {
    if (!validTargetDate(body.target_date)) return { error: "target_date must be YYYY-MM-DD or null" };
    patch.target_date = body.target_date;
  }
  return { patch };
}

function contentHandoffBrief(idea: ContentIdea, focus: string): string {
  const notes = idea.notes.trim().slice(0, 6_000);
  return `The operator is handing you a saved Content Studio idea. This is not a personal commitment for the accountability agent. Coordinate the next useful agent work and route it to the best member or members of the ensemble.

Keep the scope focused. Prefer one reviewable next step unless two tracks are genuinely independent. The work may include researching the idea, pressure-testing the premise, shaping the angle, drafting an artifact, or verifying public claims. Make each delegation self-contained from the saved brief below.

Idea title: ${idea.title}
Hook: ${idea.hook || "Not defined yet"}
Core premise: ${idea.angle || "Not defined yet"}
Audience: ${idea.audience || "Not defined yet"}
Tags: ${idea.tags.join(", ") || "None"}
Working notes:
${notes || "No notes yet"}

Operator direction for this handoff:
${focus || "Choose and route the next most useful step for developing this idea."}`;
}

type ContentHandoffRoute = {
  Params: { id: string };
  Body: { focus?: unknown; request_id?: unknown };
};

function handoffView(handoff: ContentHandoff) {
  return {
    request_id: handoff.request_id,
    content_idea_id: handoff.content_idea_id,
    status: handoff.status,
    mission_id: handoff.mission_id,
    created_at: handoff.created_at,
    updated_at: handoff.updated_at,
    error: handoff.error,
  };
}

function handoffResponse(handoff: ContentHandoff): MarcoResponse | null {
  if (!handoff.response_json) return null;
  try {
    const value = JSON.parse(handoff.response_json) as Partial<MarcoResponse>;
    if (typeof value.reply !== "string" || !Array.isArray(value.actions)) return null;
    return { reply: value.reply, actions: value.actions } as MarcoResponse;
  } catch {
    return null;
  }
}

function tokenMatches(provided: string | undefined, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function isLoopbackHost(host: string): boolean {
  const normalized = host.toLowerCase().trim().replace(/^\[|\]$/g, "");
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

function secretFromEnv(name: string): string | undefined {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
}

/** Validate invariants even when callers construct config without loadConfig(). */
export function assertServerSecurity(config: SembleopsConfig): void {
  const { server, coding } = config.node;
  const external = config.node.node === "cloud" || !isLoopbackHost(server.host);
  const hubToken = secretFromEnv(server.auth_token_env);
  const workerToken = secretFromEnv(server.worker_token_env);

  if (external && !hubToken) {
    throw new Error(`${server.auth_token_env} is required for cloud or non-loopback deployments`);
  }
  if (external && hubToken!.length < MIN_SECRET_LENGTH) {
    throw new Error(`${server.auth_token_env} must be at least ${MIN_SECRET_LENGTH} characters`);
  }
  if (coding.dex_mode === "remote" && !workerToken) {
    throw new Error(`${server.worker_token_env} is required when coding.dex_mode is remote`);
  }
  if (coding.dex_mode === "remote" && workerToken!.length < MIN_SECRET_LENGTH) {
    throw new Error(`${server.worker_token_env} must be at least ${MIN_SECRET_LENGTH} characters`);
  }
  if (hubToken && workerToken && tokenMatches(hubToken, workerToken)) {
    throw new Error(`${server.auth_token_env} and ${server.worker_token_env} must use different values`);
  }
}

function validTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function buildServer(deps: ApiDeps): FastifyInstance {
  const { store, contentIdeas, delegations, marco, config, runtimeKinds, workerState } = deps;
  assertServerSecurity(config);
  const app = Fastify({ logger: false, bodyLimit: 1024 * 1024 });
  const { nag } = config.node;
  const reminderDefaults = {
    timezone: config.node.timezone,
    quiet_hours: config.node.quiet_hours,
    morning_brief: nag.morning_brief,
    evening_reckoning: nag.evening_reckoning,
  };
  const reminderSettings = () => store.getReminderSettings(reminderDefaults);

  const hubToken = secretFromEnv(config.node.server.auth_token_env);
  const workerToken = secretFromEnv(config.node.server.worker_token_env);
  const secureCookies = config.node.node === "cloud" || !isLoopbackHost(config.node.server.host);
  const sessions = new Map<string, number>();

  const removeExpiredSessions = (): void => {
    const now = Date.now();
    for (const [token, expiresAt] of sessions) {
      if (expiresAt <= now) sessions.delete(token);
    }
  };
  const issueSession = (): string => {
    removeExpiredSessions();
    while (sessions.size >= 32) {
      const oldest = sessions.keys().next().value as string | undefined;
      if (!oldest) break;
      sessions.delete(oldest);
    }
    const token = randomBytes(32).toString("base64url");
    sessions.set(token, Date.now() + SESSION_MAX_AGE_SECONDS * 1000);
    return token;
  };
  const validSession = (token: string | undefined): boolean => {
    if (!token) return false;
    const expiresAt = sessions.get(token);
    if (!expiresAt || expiresAt <= Date.now()) {
      if (expiresAt) sessions.delete(token);
      return false;
    }
    return true;
  };

  app.register(fastifyCookie);

  app.addHook("onSend", async (req, reply, payload) => {
    reply.header(
      "Content-Security-Policy",
      "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; object-src 'none'; " +
        "script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
        "media-src 'self' blob:; connect-src 'self'",
    );
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Cross-Origin-Opener-Policy", "same-origin");
    reply.header("Cross-Origin-Resource-Policy", "same-origin");
    reply.header("Permissions-Policy", "camera=(), geolocation=(), microphone=(self)");
    reply.header("Referrer-Policy", "no-referrer");
    if (secureCookies) reply.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    if (req.url.startsWith("/api")) reply.header("Cache-Control", "no-store");
    return payload;
  });

  // Tolerate empty JSON bodies (a POST with no payload is fine here);
  // Fastify's default parser rejects them with a 400.
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
    if (typeof body !== "string" || body.trim().length === 0) return done(null, {});
    try {
      done(null, JSON.parse(body));
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  // Auth is optional only in explicit loopback-only local mode.
  if (hubToken) {
    app.addHook("onRequest", async (req, reply) => {
      const route = req.routeOptions.url;
      if (!route) {
        if (!req.url.startsWith("/api")) return;
        return reply.code(401).send({ error: "unauthorized" });
      }
      if (!route.startsWith("/api")) return; // static shell is public; data is not
      if (route === "/api/login") return;
      if (route.startsWith("/api/worker/")) return; // worker routes check their own token
      const cookieToken = req.cookies["hub_session"];
      const headerToken = req.headers["x-hub-token"] as string | undefined;
      if (validSession(cookieToken) || tokenMatches(headerToken, hubToken)) return;
      return reply.code(401).send({ error: "unauthorized" });
    });
  }

  // -- health route -- 

  app.get("/api/health", async (req, res) => {
    return {
      status: "Server is healthy"
    };
  });

  app.post<{ Body: { token?: string } }>("/api/login", { bodyLimit: 1024 }, async (req, reply) => {
    if (!hubToken) return { ok: true, auth: "disabled" };
    if (!tokenMatches(req.body?.token, hubToken)) {
      return reply.code(401).send({ error: "wrong token" });
    }
    reply.setCookie("hub_session", issueSession(), {
      httpOnly: true,
      secure: secureCookies,
      sameSite: "strict",
      path: "/",
      maxAge: SESSION_MAX_AGE_SECONDS,
    });
    return { ok: true };
  });

  app.post("/api/logout", async (req, reply) => {
    const session = req.cookies["hub_session"];
    if (session) sessions.delete(session);
    reply.clearCookie("hub_session", {
      httpOnly: true,
      secure: secureCookies,
      sameSite: "strict",
      path: "/",
    });
    return { ok: true };
  });

  // ---- Remote worker protocol (home Dex runner) ----

  const requireWorker = (req: { headers: Record<string, unknown> }): boolean =>
    Boolean(workerToken) && tokenMatches(req.headers["x-worker-token"] as string | undefined, workerToken!);
  
  app.post<{ Body: { agent?: string; projects?: string[] } }>("/api/worker/claim", async (req, reply) => {
    if (!requireWorker(req)) return reply.code(401).send({ error: "unauthorized" });
    workerState.lastSeen = new Date().toISOString();
    // The worker reports its local project folders so Marco can route Dex
    // work even though the cloud hub never sees the filesystem.
    if (Array.isArray(req.body?.projects)) {
      workerState.projects = [...new Set(
        req.body.projects.filter(
          (project): project is string =>
            typeof project === "string" &&
            project.length <= 255 &&
            /^[^./\\][^/\\]*$/.test(project),
        ),
      )].slice(0, 200);
    }
    const agent = req.body?.agent ?? "dex";
    const job = delegations.claimNextFor(agent);
    return { job: job ?? null };
  });

  app.post<{
    Body: {
      id?: string;
      ok?: boolean;
      text?: string;
      sessionId?: string | null;
      costUsd?: number | null;
      error?: string;
      runtime?: string;
      inputTokens?: number | null;
      outputTokens?: number | null;
      diff?: string | null;
    };
  }>("/api/worker/complete", { bodyLimit: 2 * 1024 * 1024 }, async (req, reply) => {
    if (!requireWorker(req)) return reply.code(401).send({ error: "unauthorized" });
    workerState.lastSeen = new Date().toISOString();
    const body = req.body ?? {};
    if (!body.id) return reply.code(400).send({ error: "id required" });
    const job = delegations.get(body.id);
    if (!job || job.status !== "running") {
      return reply.code(409).send({ error: "job not in running state" });
    }
    delegations.finish(job.id, {
      ok: Boolean(body.ok),
      text: body.text ?? "",
      sessionId: body.sessionId ?? null,
      costUsd: body.costUsd ?? null,
      ...(body.error !== undefined && { error: body.error }),
      runtime: body.runtime ?? "remote",
      diff: body.diff ?? null,
    });
    delegations.recordUsage(
      job,
      body.costUsd ?? null,
      body.runtime ?? "remote",
      body.inputTokens ?? null,
      body.outputTokens ?? null,
    );
    const finished = delegations.get(job.id);
    if (finished) deps.onDelegationFinish(finished);
    return { ok: true };
  });

  const uiDist = resolve("dist-ui");
  if (existsSync(uiDist)) {
    app.register(fastifyStatic, { root: uiDist });
  }

  const dexOnline = (): boolean =>
    config.node.coding.dex_mode === "local" ||
    (workerState.lastSeen !== null && Date.now() - Date.parse(workerState.lastSeen) < 60_000);

  const projectList = (): string[] =>
    config.node.coding.dex_mode === "remote"
      ? workerState.projects
      : listProjects(config.node.coding.projects_root);

  app.get("/api/meta", async () => ({
    node: config.node.node,
    timezone: reminderSettings().timezone,
    personas: config.personas,
    snooze_cap: nag.snooze_cap,
    runtimes: runtimeKinds,
    projects: projectList(),
    dex_mode: config.node.coding.dex_mode,
    dex_online: dexOnline(),
  }));

  app.get("/api/settings/reminders", async () => ({
    settings: reminderSettings(),
    defaults: reminderDefaults,
  }));

  app.post<{
    Body: {
      timezone?: string;
      quiet_hours?: { start?: string; end?: string };
      morning_brief?: string;
      evening_reckoning?: string;
    };
  }>("/api/settings/reminders", async (req, reply) => {
    const body = req.body ?? {};
    if (body.timezone !== undefined && !validTimezone(body.timezone)) {
      return reply.code(422).send({ error: "timezone must be a valid IANA timezone" });
    }
    const times = [
      body.quiet_hours?.start,
      body.quiet_hours?.end,
      body.morning_brief,
      body.evening_reckoning,
    ].filter((value): value is string => value !== undefined);
    if (times.some((value) => !TIME_HHMM.test(value))) {
      return reply.code(422).send({ error: "times must use HH:MM 24-hour format" });
    }
    return { settings: store.updateReminderSettings(body, reminderDefaults) };
  });

  // ---- Content Studio: editorial ideas stay out of the commitment engine ----

  const contentRunSummary = (run: Delegation) => ({
    id: run.id,
    created_at: run.created_at,
    finished_at: run.finished_at,
    agent: run.agent,
    title: run.title,
    status: run.status,
    mission_id: run.mission_id,
    content_idea_id: run.content_idea_id,
    content_run_kind: run.content_run_kind,
  });
  const contentIdeaView = (idea: ContentIdea) => ({
    ...idea,
    agent_runs: delegations.byContentIdea(idea.id).map(contentRunSummary),
  });

  app.get<{ Querystring: { archived?: string } }>("/api/content-ideas", async (req) => {
    const ideas = contentIdeas.list(req.query.archived === "true");
    const runs = delegations.contentRuns();
    const runsByIdea = new Map<string, ReturnType<typeof contentRunSummary>[]>();
    for (const run of runs) {
      if (!run.content_idea_id) continue;
      const group = runsByIdea.get(run.content_idea_id) ?? [];
      group.push(contentRunSummary(run));
      runsByIdea.set(run.content_idea_id, group);
    }
    return {
      ideas: ideas.map((idea) => ({ ...idea, agent_runs: runsByIdea.get(idea.id) ?? [] })),
    };
  });

  app.post<{ Body: ContentIdeaBody }>("/api/content-ideas", async (req, reply) => {
    const parsed = contentPatch(req.body ?? {});
    if (parsed.error) return reply.code(422).send({ error: parsed.error });
    if (!parsed.patch?.title) return reply.code(400).send({ error: "title required" });
    const idea = contentIdeas.create({ ...parsed.patch, title: parsed.patch.title, source: "manual" });
    return reply.code(201).send({ idea: contentIdeaView(idea) });
  });

  app.post<{ Body: { titles?: unknown } }>("/api/content-ideas/import", async (req, reply) => {
    const raw = req.body?.titles;
    if (!Array.isArray(raw)) return reply.code(400).send({ error: "titles must be a list" });
    if (raw.length > 100) return reply.code(422).send({ error: "imports are limited to 100 ideas" });
    if (!raw.every((title) => typeof title === "string")) {
      return reply.code(422).send({ error: "every title must be text" });
    }
    const titles = raw.map((title) => title.trim()).filter(Boolean);
    if (titles.length === 0) return reply.code(400).send({ error: "at least one idea is required" });
    if (titles.some((title) => title.length > 240)) {
      return reply.code(422).send({ error: "each title must be 240 characters or fewer" });
    }
    const result = contentIdeas.importTitles(titles);
    return reply.code(201).send({
      ...result,
      ideas: result.ideas.map(contentIdeaView),
    });
  });

  app.patch<{ Params: { id: string }; Body: ContentIdeaBody }>(
    "/api/content-ideas/:id",
    async (req, reply) => {
      const parsed = contentPatch(req.body ?? {});
      if (parsed.error) return reply.code(422).send({ error: parsed.error });
      if (!parsed.patch || Object.keys(parsed.patch).length === 0) {
        return reply.code(400).send({ error: "no changes supplied" });
      }
      const idea = contentIdeas.update(req.params.id, parsed.patch);
      return idea ? { idea: contentIdeaView(idea) } : reply.code(404).send({ error: "idea not found" });
    },
  );

  app.post<{
    Params: { id: string };
    Body: { stage?: unknown; index?: unknown };
  }>("/api/content-ideas/:id/move", async (req, reply) => {
    const { stage, index } = req.body ?? {};
    if (!validContentStage(stage)) return reply.code(422).send({ error: "invalid content stage" });
    if (typeof index !== "number" || !Number.isInteger(index) || index < 0) {
      return reply.code(422).send({ error: "index must be a non-negative integer" });
    }
    const idea = contentIdeas.move(req.params.id, stage, index);
    return idea ? { idea: contentIdeaView(idea) } : reply.code(404).send({ error: "idea not found" });
  });

  app.get<{ Params: { id: string } }>("/api/content-ideas/:id/agent-runs", async (req, reply) => {
    const idea = contentIdeas.get(req.params.id);
    if (!idea) return reply.code(404).send({ error: "idea not found" });
    return { agent_runs: delegations.byContentIdea(idea.id).map(contentRunSummary) };
  });

  const routeContentIdea = async (
    req: FastifyRequest<ContentHandoffRoute>,
    reply: FastifyReply,
  ) => {
    const idea = contentIdeas.get(req.params.id);
    if (!idea || idea.archived_at) return reply.code(404).send({ error: "idea not found" });
    const body = req.body ?? {};
    if (
      typeof body.request_id !== "string"
      || !/^[A-Za-z0-9-]{8,80}$/.test(body.request_id)
    ) {
      return reply.code(422).send({ error: "request_id is required" });
    }
    if (body.focus !== undefined && typeof body.focus !== "string") {
      return reply.code(422).send({ error: "focus must be text" });
    }
    const focus = typeof body.focus === "string" ? body.focus.trim() : "";
    if (focus.length > 2_000) return reply.code(422).send({ error: "focus is too long" });

    const started = delegations.beginContentHandoff(body.request_id, idea.id, randomUUID());
    if (started.kind === "request_conflict") {
      return reply.code(409).send({ error: "request_id is already in use" });
    }
    if (started.kind !== "started") {
      const handoff = started.handoff;
      const routed = handoff
        ? delegations.byMission(handoff.mission_id).filter((run) => run.content_idea_id === idea.id)
        : started.active
          ? [started.active]
          : [];
      const payload = {
        handoff: handoff ? handoffView(handoff) : null,
        marco: handoff ? handoffResponse(handoff) : null,
        delegations: routed,
        reused: true,
      };
      if (handoff?.status === "error") {
        return reply.code(409).send({
          ...payload,
          error: handoff.error ?? "Marco could not route this handoff",
        });
      }
      if (!handoff || handoff.status === "routing") return reply.code(202).send(payload);
      return reply.send(payload);
    }

    try {
      const result = await marco.handle(contentHandoffBrief(idea, focus), {
        missionId: started.handoff.mission_id,
        contentIdeaId: idea.id,
        contentRunKind: "context",
        logUserText: `Develop content idea: ${idea.title}`,
        delegatesOnly: true,
      });
      const handoff = delegations.completeContentHandoff(
        body.request_id,
        JSON.stringify(result),
      );
      return reply.code(201).send({
        handoff: handoffView(handoff),
        marco: result,
        delegations: delegations
          .byMission(handoff.mission_id)
          .filter((run) => run.content_idea_id === idea.id),
        reused: false,
      });
    } catch (error) {
      delegations.failContentHandoff(
        body.request_id,
        error instanceof Error ? error.message : "Marco routing failed",
      );
      throw error;
    }
  };

  app.post<ContentHandoffRoute>("/api/content-ideas/:id/handoff", routeContentIdea);
  // Compatibility for the first Content Studio client. It now follows the
  // same Marco routing path instead of directly assigning the idea to Sam.
  app.post<ContentHandoffRoute>("/api/content-ideas/:id/context", routeContentIdea);

  app.delete<{ Params: { id: string } }>("/api/content-ideas/:id", async (req, reply) => {
    const idea = contentIdeas.archive(req.params.id);
    return idea ? { idea: contentIdeaView(idea) } : reply.code(404).send({ error: "idea not found" });
  });

  // ---- Marco: the conversational front door ----

  app.post<{ Body: { text?: string } }>("/api/message", async (req, reply) => {
    const text = req.body?.text?.trim();
    if (!text) return reply.code(400).send({ error: "text required" });
    return marco.handle(text);
  });

  app.get("/api/message/log", async () => ({ log: marco.log() }));

  // Voice capture from the browser: audio in memory -> transcript -> Marco.
  // Raw audio is never written to disk.
  app.addContentTypeParser(/^audio\//, { parseAs: "buffer" }, (_req, body, done) => {
    done(null, body);
  });

  // Transcribe-only: the UI shows "Heard: ..." immediately, then routes the
  // transcript through the normal /api/message path with its own progress state.
  app.post("/api/transcribe", { bodyLimit: 25 * 1024 * 1024 }, async (req, reply) => {
    if (!openAiApiKeyAvailable()) {
      return reply.code(400).send({ error: "OPENAI_API_KEY is not configured" });
    }
    const audio = req.body as Buffer;
    if (!Buffer.isBuffer(audio) || audio.length === 0) {
      return reply.code(400).send({ error: "audio body required" });
    }
    const t = await transcribeAudio(audio, req.headers["content-type"] ?? "audio/webm", "voice.webm");
    if (!t.ok || t.text.length === 0) {
      return reply.code(422).send({ error: t.error ?? "couldn't hear anything in that recording" });
    }
    return { transcript: t.text };
  });

  // One-shot voice -> route (kept for the PWA share target and Discord parity).
  app.post("/api/message/voice", { bodyLimit: 25 * 1024 * 1024 }, async (req, reply) => {
    if (!openAiApiKeyAvailable()) {
      return reply.code(400).send({ error: "OPENAI_API_KEY is not configured" });
    }
    const audio = req.body as Buffer;
    if (!Buffer.isBuffer(audio) || audio.length === 0) {
      return reply.code(400).send({ error: "audio body required" });
    }
    const t = await transcribeAudio(audio, req.headers["content-type"] ?? "audio/webm", "voice.webm");
    if (!t.ok || t.text.length === 0) {
      return reply.code(422).send({ error: t.error ?? "couldn't hear anything in that recording" });
    }
    const res = await marco.handle(t.text);
    return { transcript: t.text, ...res };
  });

  // ---- Direct capture (bypasses Marco — used by the quick-capture affordance) ----

  app.post<{ Body: { text?: string } }>("/api/tasks", async (req, reply) => {
    const text = req.body?.text?.trim();
    if (!text) return reply.code(400).send({ error: "text required" });
    const parsed = parseCapture(text);
    const task = store.createTask({
      title: parsed.title,
      source: "text",
      due_at: parsed.due_at,
      next_nag_at: parsed.due_at ?? defaultNagTime(reminderSettings().morning_brief).toISOString(),
    });
    return { task, echo: parsed.echo };
  });

  // ---- Tasks / decisions ----

  app.get("/api/tasks", async () => ({
    open: store.listTasks(["open"]),
    blocked: store.listTasks(["blocked"]),
    closed: store.listTasks(["done", "killed"]).slice(-30).reverse(),
  }));

  app.get<{ Params: { id: string } }>("/api/tasks/:id/history", async (req, reply) => {
    const task = store.getTask(req.params.id);
    if (!task) return reply.code(404).send({ error: "not found" });
    return { task, history: store.history(task.id) };
  });

  app.get("/api/inbox", async () => {
    const nags: InboxItem[] = store.inboxTasks().map((task) => ({
      task,
      message: larryLine(task, task.escalation_level),
      forced: task.escalation_level >= MAX_LEVEL || task.snooze_count >= nag.snooze_cap,
    }));
    const rechecks = store
      .listTasks(["blocked"])
      .map((task) => ({ task, message: blockedRecheckLine(task) }));
    return { nags, rechecks };
  });

  app.post<{ Params: { id: string }; Body: DecisionInput }>(
    "/api/tasks/:id/decision",
    async (req, reply) => {
      const task = store.getTask(req.params.id);
      if (!task) return reply.code(404).send({ error: "not found" });
      const result = store.applyDecision(task, req.body, nag.snooze_cap, nag.blocked_recheck_hours);
      if (!result.ok) return reply.code(422).send({ error: result.error });
      return { task: result.task };
    },
  );

  app.post<{ Params: { id: string } }>("/api/tasks/:id/take-now", async (req, reply) => {
    const task = store.getTask(req.params.id);
    if (!task || task.status !== "open") return reply.code(404).send({ error: "no such open task" });
    store.nagNow(task);
    return { task: store.getTask(task.id) };
  });

  app.post<{ Params: { id: string } }>("/api/tasks/:id/unblock", async (req, reply) => {
    const task = store.getTask(req.params.id);
    if (!task || task.status !== "blocked") {
      return reply.code(404).send({ error: "no such blocked task" });
    }
    return { task: store.unblock(task) };
  });

  // ---- Local delivery events (browser/PWA notification stopgap) ----

  app.get("/api/notifications", async () => ({
    notifications: store.listNotifications(),
  }));

  app.post<{ Params: { id: string } }>("/api/notifications/:id/notified", async (req, reply) => {
    const event = store.markNotificationBrowserNotified(Number(req.params.id));
    if (!event) return reply.code(404).send({ error: "not found" });
    return { notification: event };
  });

  app.post<{ Params: { id: string } }>("/api/notifications/:id/read", async (req, reply) => {
    const event = store.markNotificationRead(Number(req.params.id));
    if (!event) return reply.code(404).send({ error: "not found" });
    return { notification: event };
  });

  app.post("/api/notifications/read-all", async () => {
    store.markAllNotificationsRead();
    return { ok: true };
  });

  // ---- Delegations (agent execution) ----

  app.get("/api/delegations", async () => ({
    running: delegations.list(["queued", "running"]),
    needs_review: delegations.list(["needs_review"]),
    recent: delegations.list(["reviewed", "dismissed", "error"]).slice(0, 20),
  }));

  app.get<{ Params: { id: string } }>("/api/delegations/:id", async (req, reply) => {
    const d = delegations.get(req.params.id);
    if (!d) return reply.code(404).send({ error: "not found" });
    const parent = d.parent_id ? delegations.get(d.parent_id) : undefined;
    return {
      delegation: d,
      children: delegations.childrenOf(d.id),
      parent: parent ? { id: parent.id, title: parent.title, agent: parent.agent } : null,
    };
  });

  // A mission is every delegation born from one Marco routing, plus the goal.
  app.get<{ Params: { id: string } }>("/api/missions/:id", async (req, reply) => {
    const members = delegations.byMission(req.params.id);
    if (members.length === 0) return reply.code(404).send({ error: "not found" });
    return { goal: marco.goalForMission(req.params.id), delegations: members };
  });

  app.post<{ Params: { id: string }; Body: { action?: string } }>(
    "/api/delegations/:id/review",
    async (req, reply) => {
      const d = delegations.get(req.params.id);
      if (!d) return reply.code(404).send({ error: "not found" });
      const action = req.body?.action;
      if ((action === "reviewed" || action === "dismissed") && d.status === "needs_review") {
        delegations.setStatus(d.id, action);
      } else if (action === "retry" && d.status === "error") {
        delegations.setStatus(d.id, "queued");
      } else if (action === "reviewed" || action === "dismissed" || action === "retry") {
        return reply.code(409).send({ error: `action is not available while delegation is ${d.status}` });
      } else {
        return reply.code(400).send({ error: "action must be reviewed | dismissed | retry" });
      }
      return { delegation: delegations.get(d.id) };
    },
  );

  // ---- Today summary (dashboard header chips + brief) ----

  app.get("/api/today", async () => {
    const open = store.listTasks(["open"]);
    const inboxCount = store.inboxTasks().length;
    const running = delegations.list(["queued", "running"]);
    const needsReview = delegations.list(["needs_review"]);
    const atRisk = open.filter(
      (t) => t.escalation_level >= 2 || (t.due_at !== null && new Date(t.due_at) < new Date()),
    );
    return {
      decisions_needed: inboxCount + needsReview.length,
      agents_working: running.length,
      at_risk: atRisk.length,
      top3: open.slice(0, 3),
      open_count: open.length,
      blocked_count: store.listTasks(["blocked"]).length,
      notifications: store.listNotifications().length,
    };
  });

  return app;
}
