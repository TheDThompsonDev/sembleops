import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import { AgentBadge } from "./Badge";
import { parseIdeaDocument, type IdeaImportSelection } from "./contentIdeaParser";
import type {
  ContentIdea,
  ContentAgentRun,
  ContentIdeaPatch,
  ContentIdeaPriority,
  ContentIdeaStage,
  MarcoResponse,
  Meta,
} from "./types";

const STAGES: Array<{
  id: ContentIdeaStage;
  label: string;
  number: string;
  description: string;
}> = [
  { id: "inbox", label: "Inbox", number: "01", description: "Raw sparks worth keeping" },
  { id: "shaping", label: "Shaping", number: "02", description: "Find the angle and audience" },
  { id: "ready", label: "Ready", number: "03", description: "Briefed and ready to write" },
  { id: "drafting", label: "In progress", number: "04", description: "Actively becoming a post" },
];

const stageLabel = (stage: ContentIdeaStage): string =>
  STAGES.find((item) => item.id === stage)?.label ?? stage;

function StudioIcon({ name }: { name: "plus" | "upload" | "search" | "close" | "stack" }) {
  return (
    <svg className="studio-icon" viewBox="0 0 24 24" aria-hidden="true">
      {name === "plus" && <path d="M12 5v14M5 12h14" />}
      {name === "upload" && <path d="M12 16V4m0 0 4 4m-4-4L8 8M5 15v4h14v-4" />}
      {name === "search" && <path d="m15.5 15.5 4 4M10.5 17a6.5 6.5 0 1 1 0-13 6.5 6.5 0 0 1 0 13Z" />}
      {name === "close" && <path d="m7 7 10 10M17 7 7 17" />}
      {name === "stack" && <path d="m4 8 8-4 8 4-8 4-8-4Zm0 4 8 4 8-4M4 16l8 4 8-4" />}
    </svg>
  );
}

const MAX_IDEA_FILE_BYTES = 256_000;

function timeAgo(iso: string): string {
  const elapsed = Date.now() - Date.parse(iso);
  if (elapsed < 60_000) return "just now";
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function briefProgress(idea: Pick<ContentIdea, "hook" | "angle" | "audience" | "notes">): number {
  return [idea.hook, idea.angle, idea.audience, idea.notes].filter((field) => field.trim()).length;
}

function agentName(slug: string, meta: Meta | null): string {
  return meta?.personas[slug]?.name ?? slug.charAt(0).toUpperCase() + slug.slice(1);
}

interface ContentMission {
  id: string;
  missionId: string | null;
  runs: ContentAgentRun[];
  createdAt: string;
}

function groupContentMissions(runs: ContentAgentRun[]): ContentMission[] {
  const missions = new Map<string, ContentMission>();
  for (const run of runs) {
    const id = run.mission_id ?? run.id;
    const current = missions.get(id);
    if (current) current.runs.push(run);
    else missions.set(id, { id, missionId: run.mission_id, runs: [run], createdAt: run.created_at });
  }
  return [...missions.values()];
}

function missionAgents(mission: ContentMission): string[] {
  return [...new Set(mission.runs.map((run) => run.agent))];
}

function missionStatus(mission: ContentMission): ContentAgentRun["status"] {
  for (const status of ["running", "queued", "needs_review", "error", "reviewed", "dismissed"] as const) {
    if (mission.runs.some((run) => run.status === status)) return status;
  }
  return "reviewed";
}

function routedWorkLabel(mission: ContentMission, meta: Meta | null): string {
  const working = mission.runs.filter((run) => run.status === "queued" || run.status === "running");
  const ready = mission.runs.filter((run) => run.status === "needs_review");
  const errors = mission.runs.filter((run) => run.status === "error");
  if (working.length > 0) {
    const names = [...new Set(working.map((run) => agentName(run.agent, meta)))];
    if (names.length === 1) return `${names[0]} is working`;
    if (names.length === 2) return `${names[0]} and ${names[1]} are working`;
    return `${names.length} agents are working`;
  }
  if (ready.length > 0) return `${ready.length} packet${ready.length === 1 ? " is" : "s are"} ready`;
  if (errors.length > 0) return `${errors.length} routed task${errors.length === 1 ? " needs" : "s need"} attention`;
  return "Mission reviewed";
}

function IdeaCapture({
  onCreate,
}: {
  onCreate: (titles: string[]) => Promise<{ added: number; skippedTitles: string[] }>;
}) {
  const [raw, setRaw] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [parseMode, setParseMode] = useState<IdeaImportSelection>("auto");
  const fileRef = useRef<HTMLInputElement>(null);
  const parsed = useMemo(() => parseIdeaDocument(raw, parseMode), [raw, parseMode]);
  const titles = parsed.titles;
  const invalidTitles = titles.filter((title) => title.length > 240);
  const validTitles = titles.filter((title) => title.length <= 240);
  const tooMany = validTitles.length > 100;

  const submit = async () => {
    if (validTitles.length === 0 || tooMany || busy) return;
    setBusy(true);
    setError(null);
    setFeedback(null);
    try {
      const result = await onCreate(validTitles);
      const skipped = result.skippedTitles.length;
      const skippedCopy = skipped > 0
        ? ` ${skipped} duplicate${skipped === 1 ? " was" : "s were"} already on the board.`
        : "";
      const invalidCopy = invalidTitles.length > 0
        ? ` ${invalidTitles.length} long ${invalidTitles.length === 1 ? "line remains" : "lines remain"} to shorten.`
        : "";
      setFeedback(`${result.added} card${result.added === 1 ? "" : "s"} added.${skippedCopy}${invalidCopy}`);
      setRaw(invalidTitles.join("\n"));
      if (invalidTitles.length > 0) setParseMode("lines");
      setFileName(null);
      if (fileRef.current) fileRef.current.value = "";
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const readFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setFeedback(null);
    if (file.size > MAX_IDEA_FILE_BYTES) {
      setError("That file is over 250 KB. Trim it to the idea list and try again.");
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    try {
      setRaw(await file.text());
      setFileName(file.name);
      setParseMode("auto");
    } catch {
      setError("That file could not be read.");
    }
  };

  return (
    <section className="idea-capture" aria-labelledby="idea-capture-title">
      <div className="idea-capture-copy">
        <span className="content-kicker">Quick capture</span>
        <h2 id="idea-capture-title">Empty your head. Keep every good spark.</h2>
        <p>Import up to 100 ideas at once. An 80-item Markdown list becomes 80 separate Inbox cards.</p>
      </div>
      <div className="idea-capture-input" aria-busy={busy || undefined}>
        <textarea
          id="content-capture"
          value={raw}
          rows={4}
          placeholder={"- Why great onboarding feels like editing\n- The hidden cost of solving the wrong developer problem\n- A practical lesson from shipping software"}
          onChange={(event) => {
            setRaw(event.target.value);
            setFileName(null);
            setFeedback(null);
            setError(null);
          }}
          disabled={busy}
        />
        <div className="idea-capture-actions">
          <button className="btn primary content-add" type="button" onClick={submit} disabled={validTitles.length === 0 || tooMany || busy}>
            <StudioIcon name="plus" />
            {busy ? "Adding..." : validTitles.length > 1 ? `Create ${validTitles.length} cards` : "Create card"}
          </button>
          <label className="btn ghost content-file-button">
            <StudioIcon name="upload" />
            {fileName ?? "Import .md or .txt"}
            <input
              ref={fileRef}
              type="file"
              accept=".md,.markdown,.txt,text/markdown,text/plain"
              onChange={(event) => readFile(event.target.files?.[0])}
            />
          </label>
          <label className="capture-mode">
            <span>Split by</span>
            <select value={parseMode} onChange={(event) => setParseMode(event.target.value as IdeaImportSelection)}>
              <option value="auto">Auto detect</option>
              <option value="list">Top-level bullets</option>
              <option value="headings">Markdown headings</option>
              <option value="lines">Every non-empty line</option>
            </select>
          </label>
          {raw.trim() && !tooMany && (
            <span className="capture-detected">{validTitles.length} {validTitles.length === 1 ? "card" : "cards"} from {parsed.modeLabel.toLowerCase()}</span>
          )}
        </div>
        {tooMany && <div className="content-inline-error">Keep each import to 100 ideas or fewer.</div>}
        {invalidTitles.length > 0 && (
          <div className="content-inline-warning">
            {invalidTitles.length} {invalidTitles.length === 1 ? "line is" : "lines are"} over 240 characters and will stay here for editing.
          </div>
        )}
        {error && <div className="content-inline-error" role="alert">{error}</div>}
        {feedback && <div className="content-inline-success" aria-live="polite">{feedback}</div>}
      </div>
      {validTitles.length > 1 && validTitles.length <= 100 && (
        <div className="capture-preview" aria-label="Cards to create">
          <div className="capture-preview-head">
            <span>Preview / {parsed.modeLabel}</span>
            <span>{validTitles.length} cards</span>
          </div>
          <ol>
            {validTitles.slice(0, 5).map((title) => <li key={title}>{title}</li>)}
          </ol>
          {validTitles.length > 5 && <div className="capture-preview-more">and {validTitles.length - 5} more</div>}
        </div>
      )}
    </section>
  );
}

function IdeaCard({
  idea,
  meta,
  draggable,
  dragging,
  dropBefore,
  onOpen,
  onMove,
  onDragStart,
  onDragEnd,
  onDropBefore,
  onDragBefore,
}: {
  idea: ContentIdea;
  meta: Meta | null;
  draggable: boolean;
  dragging: boolean;
  dropBefore: boolean;
  onOpen: () => void;
  onMove: (stage: ContentIdeaStage) => void;
  onDragStart: (event: React.DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
  onDropBefore: (event: React.DragEvent<HTMLElement>) => void;
  onDragBefore: (event: React.DragEvent<HTMLElement>) => void;
}) {
  const progress = briefProgress(idea);
  const preview = idea.hook || idea.angle;
  const latestMission = groupContentMissions(idea.agent_runs)[0];
  return (
    <article
      className={`idea-card priority-${idea.priority} ${preview ? "" : "is-raw"} ${dragging ? "is-dragging" : ""} ${dropBefore ? "drop-before" : ""}`}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragBefore}
      onDrop={onDropBefore}
    >
      <button type="button" className="idea-card-open" onClick={onOpen}>
        <div className="idea-card-topline">
          <span className={`idea-priority ${idea.priority}`}>{idea.priority === "normal" ? "Backlog" : `${idea.priority} priority`}</span>
          <span className="idea-progress">{progress}/4 brief</span>
        </div>
        <h3>{idea.title}</h3>
        {preview && <p>{preview}</p>}
        {idea.tags.length > 0 && (
          <div className="idea-tags">
            {idea.tags.slice(0, 3).map((tag) => <span key={tag}>{tag}</span>)}
            {idea.tags.length > 3 && <span>+{idea.tags.length - 3}</span>}
          </div>
        )}
        {latestMission && (
          <div className={`idea-agent-status status-${missionStatus(latestMission)}`}>
            <span className="idea-agent-stack" aria-hidden="true">
              {missionAgents(latestMission).slice(0, 3).map((slug) => (
                <AgentBadge
                  key={slug}
                  slug={slug}
                  color={meta?.personas[slug]?.color ?? "#2563EB"}
                  size={24}
                />
              ))}
            </span>
            <span>
              <strong>Routed by Marco</strong>
              <small>{routedWorkLabel(latestMission, meta)}</small>
            </span>
          </div>
        )}
      </button>
      <div className="idea-card-foot">
        <span>{idea.target_date ? new Date(`${idea.target_date}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : `Touched ${timeAgo(idea.updated_at)}`}</span>
        <label>
          <span className="sr-only">Move {idea.title}</span>
          <select
            value={idea.stage}
            draggable={false}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => onMove(event.target.value as ContentIdeaStage)}
            aria-label={`Move ${idea.title} to another stage`}
          >
            {STAGES.map((stage) => <option key={stage.id} value={stage.id}>{stage.label}</option>)}
          </select>
        </label>
      </div>
    </article>
  );
}

function IdeaEditor({
  idea,
  meta,
  onClose,
  onSave,
  onArchive,
  onRouteIdea,
  onOpenAgentRun,
  onOpenMission,
}: {
  idea: ContentIdea;
  meta: Meta | null;
  onClose: () => void;
  onSave: (patch: ContentIdeaPatch) => Promise<void>;
  onArchive: () => Promise<void>;
  onRouteIdea: (patch: ContentIdeaPatch, focus: string, requestId: string) => Promise<MarcoResponse | null>;
  onOpenAgentRun: (id: string) => void;
  onOpenMission: (id: string) => void;
}) {
  const [title, setTitle] = useState(idea.title);
  const [hook, setHook] = useState(idea.hook);
  const [angle, setAngle] = useState(idea.angle);
  const [audience, setAudience] = useState(idea.audience);
  const [notes, setNotes] = useState(idea.notes);
  const [stage, setStage] = useState(idea.stage);
  const [priority, setPriority] = useState(idea.priority);
  const [tags, setTags] = useState(idea.tags.join(", "));
  const [targetDate, setTargetDate] = useState(idea.target_date ?? "");
  const [saving, setSaving] = useState(false);
  const [routingBusy, setRoutingBusy] = useState(false);
  const [routingFocus, setRoutingFocus] = useState("");
  const [routingReceipt, setRoutingReceipt] = useState<MarcoResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const routingGuard = useRef(false);
  const pendingRoutingRequest = useRef<string | null>(null);
  const progress = briefProgress({ hook, angle, audience, notes });
  const ensembleRuns = idea.agent_runs;
  const contentMissions = groupContentMissions(ensembleRuns);
  const pendingEnsembleRun = ensembleRuns.find((run) =>
    run.status === "queued" || run.status === "running" || run.status === "needs_review",
  );
  const pendingMission = contentMissions.find((mission) =>
    mission.runs.some((run) => run.status === "queued" || run.status === "running" || run.status === "needs_review"),
  );

  const currentPatch = (): ContentIdeaPatch => ({
    title,
    hook,
    angle,
    audience,
    notes,
    stage,
    priority,
    tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean),
    target_date: targetDate || null,
  });

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  const save = async () => {
    if (!title.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(currentPatch());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const routeIdea = async () => {
    if (!title.trim() || routingGuard.current) return;
    routingGuard.current = true;
    const requestId = pendingRoutingRequest.current ?? crypto.randomUUID();
    pendingRoutingRequest.current = requestId;
    setRoutingBusy(true);
    setError(null);
    try {
      const receipt = await onRouteIdea(currentPatch(), routingFocus, requestId);
      pendingRoutingRequest.current = null;
      setRoutingFocus("");
      setRoutingReceipt(receipt);
    } catch (err) {
      // The server's idea-level reservation prevents duplicate paid work even
      // if the response was lost, so a visible retry may safely use a new key.
      pendingRoutingRequest.current = null;
      setError((err as Error).message);
    } finally {
      routingGuard.current = false;
      setRoutingBusy(false);
    }
  };

  const archive = async () => {
    if (!confirm(`Archive "${idea.title}"? You can keep the board focused without deleting the underlying record.`)) return;
    setSaving(true);
    setError(null);
    try {
      await onArchive();
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  };

  return (
    <div className="idea-editor-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <aside
        className="idea-editor"
        role="dialog"
        aria-modal="true"
        aria-labelledby="idea-editor-title"
        aria-busy={saving || routingBusy || undefined}
      >
        <header className="idea-editor-head">
          <div>
            <span className="content-kicker">Shape the idea</span>
            <h2 id="idea-editor-title">Build the writing brief</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close idea editor">
            <StudioIcon name="close" />
          </button>
        </header>

        <div className="brief-meter">
          <div>
            <span>Brief readiness</span>
            <strong>{progress === 4 ? "Ready to write" : `${progress} of 4 fields`}</strong>
          </div>
          <div className="brief-meter-track"><span style={{ width: `${progress * 25}%` }} /></div>
        </div>

        <div className="idea-editor-scroll">
          <label className="content-field title-field">
            <span>Working title</span>
            <textarea rows={2} value={title} maxLength={240} onChange={(event) => setTitle(event.target.value)} autoFocus />
            <small>{title.length}/240</small>
          </label>

          <div className="editor-two-up">
            <label className="content-field">
              <span>Stage</span>
              <select value={stage} onChange={(event) => setStage(event.target.value as ContentIdeaStage)}>
                {STAGES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </label>
            <label className="content-field">
              <span>Target date</span>
              <input type="date" value={targetDate} onChange={(event) => setTargetDate(event.target.value)} />
            </label>
          </div>

          <fieldset className="priority-field">
            <legend>Priority</legend>
            <div className="priority-options">
              {(["low", "normal", "high"] as ContentIdeaPriority[]).map((value) => (
                <button key={value} type="button" className={priority === value ? "active" : ""} onClick={() => setPriority(value)}>
                  {value === "normal" ? "Backlog" : value.charAt(0).toUpperCase() + value.slice(1)}
                </button>
              ))}
            </div>
          </fieldset>

          <label className="content-field">
            <span>Hook <em>What makes someone stop?</em></span>
            <input value={hook} maxLength={2000} onChange={(event) => setHook(event.target.value)} placeholder="The surprising promise or tension at the center of the post" />
          </label>

          <label className="content-field">
            <span>Core premise <em>What will you argue?</em></span>
            <textarea rows={4} value={angle} maxLength={2000} onChange={(event) => setAngle(event.target.value)} placeholder="The point of view, lesson, or claim this post should leave behind" />
          </label>

          <label className="content-field">
            <span>Audience <em>Who needs this?</em></span>
            <input value={audience} maxLength={2000} onChange={(event) => setAudience(event.target.value)} placeholder="For example: engineering leaders building their first platform team" />
          </label>

          <label className="content-field">
            <span>Outline and raw material</span>
            <textarea className="notes-field" rows={10} value={notes} maxLength={50_000} onChange={(event) => setNotes(event.target.value)} placeholder={"## Opening\n\n## Main beats\n- Point one\n- Point two\n\n## Examples, links, and stories"} />
            <small>Markdown stays exactly as you type it.</small>
          </label>

          <label className="content-field">
            <span>Tags</span>
            <input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="leadership, developer experience, evergreen" />
            <small>Comma separated, up to eight.</small>
          </label>

          <section className="idea-agent-workbench" aria-labelledby="idea-agent-title">
            <header>
              <AgentBadge slug="marco" color={meta?.personas.marco?.color ?? "#2563EB"} size={46} />
              <div>
                <span className="content-kicker">Route with the ensemble</span>
                <h3 id="idea-agent-title">Give this idea to Marco</h3>
              </div>
            </header>
            <p className="idea-agent-intro">
              Marco will read the saved brief, choose the next useful step, and route only the work this idea needs.
            </p>
            <div className="context-focus-chips" aria-label="Suggested outcomes">
              {["Recommend the next move", "Validate the premise", "Build an outline", "Prepare a first draft"].map((suggestion) => (
                <button key={suggestion} type="button" onClick={() => setRoutingFocus(suggestion)}>
                  {suggestion}
                </button>
              ))}
            </div>
            <label className="content-field context-focus-field">
              <span>What should happen next?</span>
              <textarea
                rows={3}
                maxLength={2_000}
                value={routingFocus}
                onChange={(event) => setRoutingFocus(event.target.value)}
                placeholder="Optional: Validate whether this angle is distinct, then recommend whether it is worth drafting."
              />
            </label>
            <div className="context-disclaimer">
              Marco may route one or more agents. Nothing is published or sent, and every result comes back here for review. Current facts still need source-backed verification.
            </div>
            {pendingMission
              && !pendingMission.runs.some((run) => run.status === "queued" || run.status === "running")
              && pendingMission.runs.some((run) => run.status === "needs_review") ? (
              <button
                className="btn context-send"
                type="button"
                onClick={() => pendingMission.missionId
                  ? onOpenMission(pendingMission.missionId)
                  : onOpenAgentRun(pendingMission.runs[0]!.id)}
              >
                Review Marco's mission
              </button>
            ) : (
              <button
                className="btn context-send"
                type="button"
                disabled={!title.trim() || saving || routingBusy || Boolean(pendingEnsembleRun)}
                onClick={routeIdea}
              >
                {routingBusy
                  ? "Briefing Marco..."
                  : pendingMission
                    ? routedWorkLabel(pendingMission, meta)
                    : "Save brief and route with Marco"}
              </button>
            )}

            {routingReceipt && (
              <div className="marco-routing-receipt" role="status" aria-live="polite">
                <span>Marco's routing note</span>
                <p>{routingReceipt.reply}</p>
                {routingReceipt.actions.some((action) => action.type === "delegate") && (
                  <div className="marco-routing-crew">
                    {routingReceipt.actions.filter((action) => action.type === "delegate").map((action) => (
                      <div key={action.id}>
                        <AgentBadge
                          slug={action.agent}
                          color={meta?.personas[action.agent]?.color ?? "#2563EB"}
                          size={26}
                        />
                        <span><strong>{agentName(action.agent, meta)}</strong>{action.title}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {contentMissions.length > 0 && (
              <div className="context-run-history">
                <div className="context-run-history-head">
                  <span>Marco's missions</span>
                  <span>{contentMissions.length}</span>
                </div>
                {contentMissions.slice(0, 4).map((mission) => (
                  <button
                    key={mission.id}
                    type="button"
                    className={`context-run status-${missionStatus(mission)}`}
                    onClick={() => mission.missionId
                      ? onOpenMission(mission.missionId)
                      : onOpenAgentRun(mission.runs[0]!.id)}
                  >
                    <span className="context-run-agents" aria-hidden="true">
                      {missionAgents(mission).slice(0, 3).map((slug) => (
                        <AgentBadge
                          key={slug}
                          slug={slug}
                          color={meta?.personas[slug]?.color ?? "#2563EB"}
                          size={28}
                        />
                      ))}
                    </span>
                    <span>
                      <strong>{routedWorkLabel(mission, meta)}</strong>
                      <small>
                        {missionAgents(mission).map((slug) => agentName(slug, meta)).join(" + ")} / {new Date(mission.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                      </small>
                    </span>
                    <span className="context-run-open">{mission.missionId ? "Open mission" : "Open packet"}</span>
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>

        {error && <div className="content-editor-error" role="alert">{error}</div>}
        <footer className="idea-editor-actions">
          <button className="btn danger ghost" type="button" disabled={saving || routingBusy} onClick={archive}>Archive</button>
          <div>
            <button className="btn ghost" type="button" disabled={saving || routingBusy} onClick={onClose}>Cancel</button>
            <button className="btn primary" type="button" disabled={!title.trim() || saving || routingBusy} onClick={save}>
              {saving ? "Saving..." : "Save brief"}
            </button>
          </div>
        </footer>
      </aside>
    </div>
  );
}

export function ContentStudio({
  meta,
  onOpenPacket,
  onOpenMission,
}: {
  meta: Meta | null;
  onOpenPacket: (id: string) => void;
  onOpenMission: (id: string) => void;
}) {
  const [ideas, setIdeas] = useState<ContentIdea[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [priority, setPriority] = useState<"all" | ContentIdeaPriority>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const loadSequence = useRef(0);
  const mutationEpoch = useRef(0);
  const activeMutations = useRef(0);

  const beginMutation = () => {
    activeMutations.current += 1;
    mutationEpoch.current += 1;
  };

  const finishMutation = () => {
    activeMutations.current = Math.max(0, activeMutations.current - 1);
    mutationEpoch.current += 1;
  };

  const load = async () => {
    const sequence = ++loadSequence.current;
    const epoch = mutationEpoch.current;
    try {
      const result = await api.contentIdeas();
      if (
        sequence !== loadSequence.current
        || epoch !== mutationEpoch.current
        || activeMutations.current > 0
      ) return;
      setIdeas(result.ideas);
      setError(null);
    } catch (err) {
      if (sequence === loadSequence.current && epoch === mutationEpoch.current) {
        setError((err as Error).message);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const hasActiveContextRuns = ideas.some((idea) =>
    idea.agent_runs.some((run) => run.status === "queued" || run.status === "running"),
  );

  useEffect(() => {
    if (!hasActiveContextRuns) return;
    const id = window.setInterval(load, 5_000);
    return () => window.clearInterval(id);
  }, [hasActiveContextRuns]);

  const selected = ideas.find((idea) => idea.id === selectedId) ?? null;
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleIdeas = ideas.filter((idea) => {
    if (priority !== "all" && idea.priority !== priority) return false;
    if (!normalizedQuery) return true;
    return [idea.title, idea.hook, idea.angle, idea.audience, idea.notes, ...idea.tags]
      .some((value) => value.toLocaleLowerCase().includes(normalizedQuery));
  });
  const filtersActive = Boolean(normalizedQuery) || priority !== "all";

  const createIdeas = async (titles: string[]) => {
    beginMutation();
    try {
      const result = await api.importContentIdeas(titles);
      setIdeas((current) => [...current, ...result.ideas]);
      return { added: result.ideas.length, skippedTitles: result.skipped_titles };
    } finally {
      finishMutation();
    }
  };

  const moveIdea = async (id: string, stage: ContentIdeaStage, index: number) => {
    const previous = ideas;
    const moving = ideas.find((idea) => idea.id === id);
    if (!moving) return;
    // A dropped card may move in the DOM before the browser dispatches
    // dragend. Clear the transient state here so it cannot stay washed out.
    setDraggedId(null);
    setDropTarget(null);
    beginMutation();
    const without = ideas.filter((idea) => idea.id !== id);
    const destination = without
      .filter((idea) => idea.stage === stage)
      .sort((a, b) => a.sort_order - b.sort_order);
    const target = Math.max(0, Math.min(index, destination.length));
    destination.splice(target, 0, { ...moving, stage });
    const positions = new Map(destination.map((idea, position) => [idea.id, position]));
    setIdeas([
      ...without.map((idea) => positions.has(idea.id) ? { ...idea, sort_order: positions.get(idea.id)! } : idea),
      ...destination.filter((idea) => idea.id === id).map((idea) => ({ ...idea, sort_order: target })),
    ]);
    try {
      const result = await api.moveContentIdea(id, stage, target);
      setIdeas((current) => current.map((idea) => idea.id === id ? result.idea : idea));
    } catch (err) {
      setIdeas(previous);
      setError((err as Error).message);
    } finally {
      finishMutation();
    }
  };

  const focusCapture = () => {
    document.getElementById("content-capture")?.scrollIntoView({ behavior: "smooth", block: "center" });
    window.setTimeout(() => document.getElementById("content-capture")?.focus(), 350);
  };

  const readyCount = ideas.filter((idea) => idea.stage === "ready").length;
  const draftingCount = ideas.filter((idea) => idea.stage === "drafting").length;

  return (
    <section className="content-studio">
      <header className="content-hero">
        <div>
          <span className="content-kicker">Content Studio</span>
          <h1>Turn sparks into stories.</h1>
          <p>A living backlog for capturing rough ideas, finding the angle, and knowing what is ready to write.</p>
        </div>
        <div className="content-hero-actions">
          <div className="content-stat"><strong>{ideas.length}</strong><span>ideas</span></div>
          <div className="content-stat ready"><strong>{readyCount}</strong><span>ready</span></div>
          <div className="content-stat active"><strong>{draftingCount}</strong><span>in progress</span></div>
          <button className="btn primary" type="button" onClick={focusCapture}><StudioIcon name="plus" /> Add ideas</button>
        </div>
      </header>

      <IdeaCapture onCreate={createIdeas} />

      <div className="content-board-head">
        <div>
          <span className="content-kicker">Editorial pipeline</span>
          <h2>Your idea board</h2>
        </div>
        <div className="content-tools">
          <label className="content-search">
            <StudioIcon name="search" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search ideas and notes" />
          </label>
          <label className="content-priority-filter">
            <span className="sr-only">Filter by priority</span>
            <select value={priority} onChange={(event) => setPriority(event.target.value as "all" | ContentIdeaPriority)}>
              <option value="all">All priorities</option>
              <option value="high">High priority</option>
              <option value="normal">Backlog</option>
              <option value="low">Low priority</option>
            </select>
          </label>
        </div>
      </div>

      {filtersActive && (
        <div className="content-filter-note">
          Showing {visibleIdeas.length} of {ideas.length} ideas. Clear filters to drag and reorder cards.
          <button type="button" onClick={() => { setQuery(""); setPriority("all"); }}>Clear filters</button>
        </div>
      )}
      {error && <div className="content-board-error" role="alert">Content Studio could not sync: {error}</div>}

      <div className="content-board" aria-label="Content idea board" aria-busy={loading || undefined}>
        {STAGES.map((stage) => {
          const columnIdeas = visibleIdeas
            .filter((idea) => idea.stage === stage.id)
            .sort((a, b) => a.sort_order - b.sort_order || Date.parse(b.updated_at) - Date.parse(a.updated_at));
          const allColumnIdeas = ideas
            .filter((idea) => idea.stage === stage.id)
            .sort((a, b) => a.sort_order - b.sort_order);
          const endIndex = allColumnIdeas.length;
          return (
            <section
              key={stage.id}
              className={`content-column stage-${stage.id} ${dropTarget === `${stage.id}:end` ? "is-drop-target" : ""}`}
              onDragOver={(event) => {
                if (filtersActive) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                setDropTarget(`${stage.id}:end`);
              }}
              onDrop={(event) => {
                if (filtersActive) return;
                event.preventDefault();
                const id = event.dataTransfer.getData("text/content-idea") || draggedId;
                if (id) moveIdea(id, stage.id, endIndex);
              }}
            >
              <header className="content-column-head">
                <span className="column-number">{stage.number}</span>
                <div>
                  <h3>{stage.label} <span>{columnIdeas.length}</span></h3>
                  <p>{stage.description}</p>
                </div>
              </header>
              <div className="content-column-cards">
                {loading && <div className="content-column-empty">Loading your backlog...</div>}
                {!loading && columnIdeas.length === 0 && (
                  <button className="content-column-empty" type="button" onClick={focusCapture}>
                    <StudioIcon name="stack" />
                    <span>{filtersActive ? "No matching ideas here" : stage.id === "inbox" ? "Capture your first spark" : "Move a card here when it is ready"}</span>
                  </button>
                )}
                {columnIdeas.map((idea) => {
                  const fullIndex = allColumnIdeas.findIndex((item) => item.id === idea.id);
                  return (
                    <IdeaCard
                      key={idea.id}
                      idea={idea}
                      meta={meta}
                      draggable={!filtersActive}
                      dragging={draggedId === idea.id}
                      dropBefore={dropTarget === `${stage.id}:${idea.id}`}
                      onOpen={() => setSelectedId(idea.id)}
                      onMove={(nextStage) => {
                        const nextIndex = ideas.filter((item) => item.stage === nextStage && item.id !== idea.id).length;
                        moveIdea(idea.id, nextStage, nextIndex);
                      }}
                      onDragStart={(event) => {
                        setDraggedId(idea.id);
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/content-idea", idea.id);
                      }}
                      onDragEnd={() => { setDraggedId(null); setDropTarget(null); }}
                      onDragBefore={(event) => {
                        if (filtersActive) return;
                        event.preventDefault();
                        event.stopPropagation();
                        if (draggedId === idea.id) {
                          setDropTarget(null);
                          return;
                        }
                        setDropTarget(`${stage.id}:${idea.id}`);
                      }}
                      onDropBefore={(event) => {
                        if (filtersActive) return;
                        event.preventDefault();
                        event.stopPropagation();
                        const id = event.dataTransfer.getData("text/content-idea") || draggedId;
                        if (!id || id === idea.id) return;
                        const sourceIndex = allColumnIdeas.findIndex((item) => item.id === id);
                        const targetIndex = sourceIndex >= 0 && sourceIndex < fullIndex ? fullIndex - 1 : fullIndex;
                        moveIdea(id, stage.id, Math.max(0, targetIndex));
                      }}
                    />
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      {selected && (
        <IdeaEditor
          key={selected.id}
          idea={selected}
          meta={meta}
          onClose={() => setSelectedId(null)}
          onSave={async (patch) => {
            beginMutation();
            try {
              const result = await api.updateContentIdea(selected.id, patch);
              setIdeas((current) => current.map((idea) => idea.id === selected.id ? result.idea : idea));
              setSelectedId(null);
            } finally {
              finishMutation();
            }
          }}
          onArchive={async () => {
            beginMutation();
            try {
              await api.archiveContentIdea(selected.id);
              setIdeas((current) => current.filter((idea) => idea.id !== selected.id));
              setSelectedId(null);
            } finally {
              finishMutation();
            }
          }}
          onRouteIdea={async (patch, focus, requestId) => {
            beginMutation();
            try {
              const saved = await api.updateContentIdea(selected.id, patch);
              setIdeas((current) => current.map((idea) => idea.id === selected.id ? saved.idea : idea));
              let result = await api.handoffContentIdea(selected.id, focus, requestId);
              for (
                let attempt = 0;
                attempt < 10 && result.handoff?.status === "routing" && result.marco === null;
                attempt += 1
              ) {
                await new Promise((resolve) => window.setTimeout(resolve, 1_000));
                result = await api.handoffContentIdea(selected.id, focus, requestId);
              }
              if (result.handoff?.status === "routing" && result.marco === null) {
                throw new Error("Marco is still routing this idea. Try again in a moment.");
              }
              const routedIds = new Set(result.delegations.map((run) => run.id));
              const nextIdea: ContentIdea = {
                ...saved.idea,
                agent_runs: [
                  ...result.delegations,
                  ...saved.idea.agent_runs.filter((run) => !routedIds.has(run.id)),
                ],
              };
              setIdeas((current) => current.map((idea) => idea.id === selected.id ? nextIdea : idea));
              return result.marco;
            } finally {
              finishMutation();
            }
          }}
          onOpenAgentRun={(id) => {
            setSelectedId(null);
            onOpenPacket(id);
          }}
          onOpenMission={(id) => {
            setSelectedId(null);
            onOpenMission(id);
          }}
        />
      )}
    </section>
  );
}
