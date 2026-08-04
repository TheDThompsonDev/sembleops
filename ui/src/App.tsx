import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { api } from "./api";
import { AgentBadge } from "./Badge";
import { ContentStudio } from "./ContentStudio";
import { MissionView } from "./MissionView";
import { PacketView } from "./PacketView";
import type {
  Delegation,
  DelegationsResponse,
  InboxResponse,
  MarcoLogEntry,
  MarcoResponse,
  Meta,
  NotificationEvent,
  ReminderSettings,
  Task,
  TasksResponse,
  Today,
} from "./types";

const FALLBACK_COLOR = "#2563EB";
type View =
  | "today"
  | "content"
  | "ensemble"
  | "sessions"
  | "commitments"
  | "approvals"
  | "calendar"
  | "settings"
  | "packet"
  | "mission";

const navItems: Array<{ id: View; label: string; icon: string }> = [
  { id: "today", label: "Today", icon: "home" },
  { id: "content", label: "Content", icon: "content" },
  { id: "ensemble", label: "Ensemble", icon: "gear" },
  { id: "sessions", label: "Sessions", icon: "radar" },
  { id: "commitments", label: "Commitments", icon: "calendar" },
  { id: "approvals", label: "Approvals", icon: "approve" },
  { id: "calendar", label: "Calendar", icon: "date" },
  { id: "settings", label: "Settings", icon: "gear" },
];

function color(meta: Meta | null, slug: string): string {
  return meta?.personas?.[slug]?.color ?? FALLBACK_COLOR;
}

function name(meta: Meta | null, slug: string): string {
  return meta?.personas?.[slug]?.name ?? slug;
}

function role(meta: Meta | null, slug: string): string {
  return meta?.personas?.[slug]?.role ?? "Agent";
}

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

function dueLabel(iso: string | null): string {
  if (!iso) return "No due date";
  const d = new Date(iso);
  const now = new Date();
  const today = d.toDateString() === now.toDateString();
  if (today) {
    return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function notificationPermission(): NotificationPermission | "unsupported" {
  return "Notification" in window ? Notification.permission : "unsupported";
}

function Icon({ name: iconName }: { name: string }) {
  return (
    <svg className="ui-icon" viewBox="0 0 24 24" aria-hidden="true">
      {iconName === "home" && <path d="M4 11.5 12 5l8 6.5V20h-5v-6H9v6H4z" />}
      {iconName === "content" && <path d="M5 4h14v16H5zM8 8h8M8 12h8M8 16h5" />}
      {iconName === "check" && <path d="M5 12.5 9.2 17 19 7" />}
      {iconName === "gear" && (
        <path d="M12 8.2a3.8 3.8 0 1 1 0 7.6 3.8 3.8 0 0 1 0-7.6Zm0-5.2 1.3 2.4 2.8.6.8 2.7 2.1 1.8-1 2.7.8 2.8-2.2 1.7-.9 2.7-2.8.4L12 23l-1.3-2.4-2.8-.4-.9-2.7L4.8 16l.8-2.8-1-2.7 2.1-1.8.8-2.7 2.8-.6z" />
      )}
      {iconName === "radar" && <path d="M12 21a9 9 0 1 1 9-9M12 12l5 7M8 12a4 4 0 1 1 8 0" />}
      {iconName === "calendar" && <path d="M6 4v3m12-3v3M4 9h16M5 6h14v14H5z" />}
      {iconName === "approve" && <path d="M5 12a7 7 0 1 0 14 0 7 7 0 0 0-14 0Zm4 0 2 2 4-5" />}
      {iconName === "date" && <path d="M7 3v4m10-4v4M4 9h16M5 6h14v14H5zm4 7h2m3 0h2m-7 3h2m3 0h2" />}
      {iconName === "mic" && <path d="M12 4a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V7a3 3 0 0 0-3-3Zm-7 8a7 7 0 0 0 14 0M12 19v3" />}
      {iconName === "type" && <path d="M4 6h16M8 6v12m8-12v12M6 18h4m4 0h4" />}
      {iconName === "upload" && <path d="M12 17V5m0 0 5 5m-5-5-5 5M5 19h14" />}
      {iconName === "search" && <path d="m15.5 15.5 4 4M10.5 17a6.5 6.5 0 1 1 0-13 6.5 6.5 0 0 1 0 13Z" />}
      {iconName === "bell" && <path d="M6 17h12l-1.5-2.5V10a4.5 4.5 0 0 0-9 0v4.5Zm4 2a2 2 0 0 0 4 0" />}
      {iconName === "user" && <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0" />}
      {iconName === "arrow" && <path d="M14 6 8 12l6 6" />}
      {iconName === "close" && <path d="m7 7 10 10M17 7 7 17" />}
      {iconName === "more" && <path d="M5 12h.01M12 12h.01M19 12h.01" />}
    </svg>
  );
}

function initials(nameText: string): string {
  return nameText
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function TokenGate() {
  const [token, setToken] = useState("");
  const [failed, setFailed] = useState(false);
  const submit = async () => {
    try {
      await api.login(token);
      location.reload();
    } catch {
      setFailed(true);
    }
  };
  return (
    <div className="token-gate">
      <div className="token-card">
        <div className="logo">
          <span className="logo-mark">S</span>
          <span className="logo-text">SembleOps</span>
        </div>
        <div className="panel-sub">This hub is private. Enter your access token to continue.</div>
        <input
          type="password"
          value={token}
          placeholder="Access token"
          onChange={(e) => setToken(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          autoFocus
        />
        {failed && <div className="error">That token was not accepted.</div>}
        <button className="btn primary full" onClick={submit} disabled={!token.trim()}>
          Unlock
        </button>
      </div>
    </div>
  );
}

function statusCount(view: View, decisions: number, running: number, open: number, reviews: number): number {
  if (view === "today") return decisions;
  if (view === "sessions") return running;
  if (view === "commitments") return open;
  if (view === "approvals") return reviews;
  return 0;
}

/** Sensible defer targets so nobody has to type a raw date to block time. */
function quickSlots(): { label: string; date: Date }[] {
  const now = new Date();
  const later = new Date(now);
  later.setHours(now.getHours() + 3, 0, 0, 0);
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);
  const nextWeek = new Date(now);
  nextWeek.setDate(now.getDate() + (((8 - now.getDay()) % 7) || 7));
  nextWeek.setHours(9, 0, 0, 0);
  const dayWord = (d: Date) =>
    d.toDateString() === now.toDateString()
      ? "Today"
      : d.toDateString() === tomorrow.toDateString()
        ? "Tomorrow"
        : d.toLocaleDateString(undefined, { weekday: "short" });
  return [
    { label: `${dayWord(later)}, ${later.toLocaleTimeString(undefined, { hour: "numeric" })}`, date: later },
    { label: "Tomorrow, 9 AM", date: tomorrow },
    { label: `${dayWord(nextWeek)}, 9 AM`, date: nextWeek },
  ];
}

function NotificationBell({
  notifications,
  permission,
  onPermissionChange,
  onRead,
  onReadAll,
}: {
  notifications: NotificationEvent[];
  permission: NotificationPermission | "unsupported";
  onPermissionChange: (permission: NotificationPermission | "unsupported") => void;
  onRead: (id: number) => void;
  onReadAll: () => void;
}) {
  const [open, setOpen] = useState(false);
  const requestPermission = async () => {
    if (!("Notification" in window)) {
      onPermissionChange("unsupported");
      return;
    }
    onPermissionChange(await Notification.requestPermission());
  };

  return (
    <div className="notification-wrap">
      <button
        className={`icon-button bell ${notifications.length > 0 ? "hot" : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-label="Notifications"
      >
        <Icon name="bell" />
        {notifications.length > 0 && <span className="bell-count">{notifications.length}</span>}
      </button>
      {open && (
        <div className="notification-popover">
          <div className="notification-head">
            <div>
              <div className="panel-title">Larry delivery</div>
              <div className="panel-sub">
                {permission === "granted"
                  ? "Browser notifications are on."
                  : permission === "denied"
                    ? "Notifications are blocked in this browser."
                    : permission === "unsupported"
                      ? "This browser does not support notifications."
                      : "Turn on browser notifications for nags and briefs."}
              </div>
            </div>
            {notifications.length > 0 && (
              <button className="btn small ghost" onClick={onReadAll}>
                Clear
              </button>
            )}
          </div>
          {permission === "default" && (
            <button className="btn primary full" onClick={requestPermission}>
              Enable notifications
            </button>
          )}
          {notifications.length === 0 ? (
            <div className="empty compact">No unread delivery events.</div>
          ) : (
            <ul className="notification-list">
              {notifications.map((n) => (
                <li key={n.id}>
                  <button className="notification-item" onClick={() => onRead(n.id)}>
                    <span className={`notification-kind ${n.kind}`}>{n.kind}</span>
                    <span className="notification-title">{n.title}</span>
                    <span className="notification-body">{n.body.split("\n")[0]}</span>
                    <span className="notification-time">{new Date(n.created_at).toLocaleTimeString()}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function MarcoCapture({
  meta,
  onRouted,
}: {
  meta: Meta | null;
  onRouted: () => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [heard, setHeard] = useState<string | null>(null);
  const [response, setResponse] = useState<MarcoResponse | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const routeText = async (input: string) => {
    setBusy(true);
    try {
      const res = await api.message(input);
      setResponse(res);
      onRouted();
    } catch (err) {
      setResponse({ reply: `Routing failed: ${(err as Error).message}`, actions: [] });
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    if (!text.trim() || busy) return;
    setResponse(null);
    setHeard(null);
    const input = text;
    setText("");
    await routeText(input);
  };

  const toggleRecording = async () => {
    if (busy || transcribing) return;
    if (recording) {
      recorderRef.current?.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        setTranscribing(true);
        setResponse(null);
        setHeard(null);
        try {
          const blob = new Blob(chunksRef.current, { type: "audio/webm" });
          // Two stages so the transcript appears the moment it exists.
          const { transcript } = await api.transcribe(blob);
          setHeard(transcript);
          setTranscribing(false);
          await routeText(transcript);
        } catch (err) {
          setTranscribing(false);
          setResponse({ reply: `Voice capture failed: ${(err as Error).message}`, actions: [] });
        }
      };
      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
    } catch {
      setResponse({ reply: "Microphone unavailable. Check browser permissions and try again.", actions: [] });
    }
  };

  return (
    <section className="capture-card">
      <div className="capture-copy">
        <div className="capture-head">
          <AgentBadge slug="marco" color={color(meta, "marco")} size={40} />
          <div>
            <div className="panel-title">Tell Marco what changed</div>
            <div className="panel-sub">He routes it: commitments to Larry, work to the ensemble.</div>
          </div>
        </div>
        <textarea
          value={text}
          rows={2}
          placeholder='Type it, or tap the mic and say it: "Remind me to send Jacob the outline tomorrow"'
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        {text.trim().length > 0 && (
          <button className="btn primary capture-send" onClick={send} disabled={busy}>
            {busy ? "Routing..." : "Send to Marco"}
          </button>
        )}
      </div>
      <button
        className={`mic-orb ${recording ? "recording" : ""} ${transcribing ? "waiting" : ""}`}
        onClick={toggleRecording}
        disabled={busy || transcribing}
        aria-label={recording ? "Stop recording" : "Record a voice capture"}
      >
        <Icon name={recording ? "close" : "mic"} />
      </button>
      {recording && <div className="capture-hint">Listening... tap the mic again when you're done.</div>}
      {(busy || transcribing || heard || response) && !recording && (
        <div className="marco-reply">
          <div className="marco-reply-head">
            <AgentBadge slug="marco" color={color(meta, "marco")} size={26} />
            <span>{name(meta, "marco")}</span>
          </div>
          {heard && <div className="marco-heard">Heard: "{heard}"</div>}
          <div className="marco-reply-text">
            {transcribing ? "Transcribing..." : busy ? "Routing it now..." : response?.reply}
          </div>
          {response && response.actions.length > 0 && (
            <ul className="routing-list">
              {response.actions.map((a) => (
                <li key={a.id}>
                  <span className="dot" style={{ background: color(meta, a.agent) }} />
                  <strong>{name(meta, a.agent)}</strong>
                  <span>{a.type === "commitment" ? "tracking" : "working on"}: {a.title}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function TaskDecisionCard({
  meta,
  task,
  message,
  forced,
  featured = false,
  selected,
  snoozeCap,
  onSelect,
  onDone,
}: {
  meta: Meta | null;
  task: Task;
  message: string;
  forced: boolean;
  featured?: boolean;
  selected: boolean;
  snoozeCap: number;
  onSelect: () => void;
  onDone: () => void;
}) {
  const [mode, setMode] = useState<"none" | "blocked" | "defer">("none");
  const [reason, setReason] = useState("");
  const [deferDate, setDeferDate] = useState("");

  const act = (body: Parameters<typeof api.decide>[1]) =>
    api.decide(task.id, body).then(onDone, (e) => {
      alert((e as Error).message);
      onDone();
    });

  const cardClass = [
    "decision-card",
    "larry-card",
    featured ? "featured-decision" : "",
    forced ? "forced" : "",
    selected ? "selected" : "",
  ].filter(Boolean).join(" ");

  return (
    <article className={cardClass} onClick={onSelect}>
      {featured ? (
        <>
          <div className="featured-main">
            <AgentBadge slug="larry" color={color(meta, "larry")} size={108} />
            <div className="featured-copy">
              <div className="featured-kicker">
                <span className="card-agent-name">{name(meta, "larry")}</span>
                {forced && <span className="chip risk">Commitment at risk</span>}
              </div>
              <p className="featured-msg">{message}</p>
              {task.blocked_reason && <div className="card-meta">Context: {task.blocked_reason}</div>}
            </div>
            <div className="featured-detail">
              <div className="mini-details">
                <span><Icon name="calendar" /> Commitment</span>
                <strong>{task.title}</strong>
                <span><Icon name="date" /> Due</span>
                <strong>{task.due_at ? dueLabel(task.due_at) : "Today"}</strong>
                <span><Icon name="approve" /> Snoozed</span>
                <strong>{task.snooze_count} time{task.snooze_count === 1 ? "" : "s"}</strong>
              </div>
              <div className="recommendation compact-rec" onClick={(e) => e.stopPropagation()}>
                <div className="rec-title"> Recommended next step</div>
                <div>Block time for this and Larry will hold the slot.</div>
                <div className="slot-row">
                  {quickSlots().map((slot) => (
                    <button
                      key={slot.label}
                      className="slot-chip"
                      onClick={() => act({ action: "defer", due_at: slot.date.toISOString() })}
                    >
                      {slot.label}
                    </button>
                  ))}
                  <button
                    className={`slot-chip custom ${mode === "defer" ? "open" : ""}`}
                    onClick={() => setMode(mode === "defer" ? "none" : "defer")}
                  >
                    <Icon name="date" /> Pick a time
                  </button>
                </div>
                {mode === "defer" && (
                  <div className="inline-control">
                    <input type="datetime-local" value={deferDate} onChange={(e) => setDeferDate(e.target.value)} autoFocus />
                    <button
                      className="btn blue"
                      disabled={!deferDate}
                      onClick={() => act({ action: "defer", due_at: new Date(deferDate).toISOString() })}
                    >
                      Hold it
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
          {mode === "blocked" ? (
            <div className="inline-control featured-inline" onClick={(e) => e.stopPropagation()}>
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Blocked on what?" autoFocus />
              <button className="btn" disabled={!reason.trim()} onClick={() => act({ action: "blocked", reason })}>
                Save blocker
              </button>
            </div>
          ) : (
            <div className="featured-actions" onClick={(e) => e.stopPropagation()}>
              <button className="btn done-solid" onClick={() => act({ action: "done" })}><Icon name="approve" /> Done</button>
              {!forced && task.snooze_count < snoozeCap && (
                <button className="btn blue" onClick={() => act({ action: "snooze", snooze_hours: 3 })}><Icon name="date" /> Snooze</button>
              )}
              <button className="btn amber" onClick={() => setMode("blocked")}>Blocked</button>
              <button className="btn danger" onClick={() => confirm('Kill "' + task.title + '"?') && act({ action: "kill" })}>Kill</button>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="card-agent">
            <AgentBadge slug="larry" color={color(meta, "larry")} size={46} />
            <div className="card-agent-copy">
              <span className="card-agent-name">{name(meta, "larry")}</span>
              <span className="card-type">Commitment decision</span>
            </div>
            {forced && <span className="chip risk">At risk</span>}
          </div>
          <p className="card-msg">{message}</p>
          <div className="card-meta">
            {dueLabel(task.due_at)}
            {task.snooze_count > 0 && " ? snoozed " + task.snooze_count + "x"}
          </div>
          {mode === "blocked" ? (
            <div className="inline-control" onClick={(e) => e.stopPropagation()}>
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Blocked on what?" autoFocus />
              <button className="btn" disabled={!reason.trim()} onClick={() => act({ action: "blocked", reason })}>
                Save
              </button>
            </div>
          ) : mode === "defer" ? (
            <div className="inline-control" onClick={(e) => e.stopPropagation()}>
              <input type="datetime-local" value={deferDate} onChange={(e) => setDeferDate(e.target.value)} autoFocus />
              <button className="btn" disabled={!deferDate} onClick={() => act({ action: "defer", due_at: new Date(deferDate).toISOString() })}>
                Save
              </button>
            </div>
          ) : (
            <div className="card-actions larry-actions" onClick={(e) => e.stopPropagation()}>
              <button className="btn done" onClick={() => act({ action: "done" })}>Done</button>
              {!forced && task.snooze_count < snoozeCap && (
                <button className="btn blue" onClick={() => act({ action: "snooze", snooze_hours: 3 })}>Snooze</button>
              )}
              <button className="btn amber" onClick={() => setMode("blocked")}>Blocked</button>
              <button className="btn danger" onClick={() => confirm('Kill "' + task.title + '"?') && act({ action: "kill" })}>
                Kill
              </button>
              <button className="btn blue" onClick={() => setMode("defer")}>Block Time</button>
            </div>
          )}
        </>
      )}
    </article>
  );
}

function previewText(raw: string, max = 112): string {
  const clean = raw
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return clean.length > max ? clean.slice(0, max) + "..." : clean;
}

function DelegationReviewCard({
  meta,
  d,
  onDone,
  onOpen,
}: {
  meta: Meta | null;
  d: Delegation;
  onDone: () => void;
  onOpen: (id: string) => void;
}) {
  const c = color(meta, d.agent);
  return (
    <article className="decision-card review-card" style={{ "--agent": c } as React.CSSProperties}>
      <div className="card-agent">
        <AgentBadge slug={d.agent} color={c} size={64} />
        <div className="card-agent-copy">
          <span className="card-agent-name">{name(meta, d.agent)}</span>
          <span className="card-type">{d.project ? `Review packet · ${d.project}` : "Review packet"}</span>
          <p className="card-msg inline-card-msg">{d.title}</p>
        </div>
        <span className="chip warn">Review needed</span>
      </div>
      {d.result && <p className="card-meta">{previewText(d.result)}</p>}
      <div className="card-actions review-actions">
        <button className="btn blue" onClick={() => onOpen(d.id)}>Review packet</button>
        <button className="btn ghost" onClick={() => api.reviewDelegation(d.id, "reviewed").then(onDone)}>
          Mark reviewed
        </button>
        <button className="btn ghost" onClick={() => api.reviewDelegation(d.id, "dismissed").then(onDone)}>
          Dismiss
        </button>
      </div>
    </article>
  );
}

type MissionGroup =
  | { kind: "mission"; missionId: string; members: Delegation[]; working: number }
  | { kind: "single"; d: Delegation };

/** Group ready-for-review work: one card per multi-agent mission. */
function groupMissions(delegations: DelegationsResponse): MissionGroup[] {
  const byMission = new Map<string, { review: Delegation[]; working: number }>();
  for (const d of delegations.needs_review) {
    if (!d.mission_id) continue;
    const g = byMission.get(d.mission_id) ?? { review: [], working: 0 };
    g.review.push(d);
    byMission.set(d.mission_id, g);
  }
  for (const d of delegations.running) {
    if (!d.mission_id || !byMission.has(d.mission_id)) continue;
    byMission.get(d.mission_id)!.working += 1;
  }

  const out: MissionGroup[] = [];
  const claimed = new Set<string>();
  for (const [missionId, g] of byMission) {
    const distinct = new Set(g.review.map((d) => d.agent)).size;
    if (g.review.length + g.working >= 2 && (distinct >= 2 || g.working > 0)) {
      out.push({ kind: "mission", missionId, members: g.review, working: g.working });
      g.review.forEach((d) => claimed.add(d.id));
    }
  }
  for (const d of delegations.needs_review) {
    if (!claimed.has(d.id)) out.push({ kind: "single", d });
  }
  return out;
}

function MissionCard({
  meta,
  missionId,
  members,
  working,
  onOpen,
}: {
  meta: Meta | null;
  missionId: string;
  members: Delegation[];
  working: number;
  onOpen: (id: string) => void;
}) {
  const agents = [...new Set(members.map((d) => d.agent))];
  const shown = agents.slice(0, 3);
  const extra = agents.length - shown.length;
  // Lead with a produced packet, not a "Verify:" child, so the card names
  // the actual work.
  const lead = members.find((m) => m.parent_id === null) ?? members[0];
  return (
    <article className="decision-card review-card mission-card">
      <div className="card-agent">
        <div className="mission-badges">
          {shown.map((slug) => (
            <AgentBadge key={slug} slug={slug} color={color(meta, slug)} size={36} />
          ))}
          {extra > 0 && <span className="mission-badge-more">+{extra}</span>}
        </div>
        <div className="card-agent-copy">
          <span className="card-agent-name">{shown.map((a) => name(meta, a).split(" ")[0]).join(", ")}{extra > 0 ? ` and ${extra} more` : ""}</span>
          <span className="card-type">Mission · {members.length} packet{members.length === 1 ? "" : "s"}{working > 0 ? ` · ${working} still working` : ""}</span>
          <p className="card-msg inline-card-msg">{lead ? lead.title : "Mission"}</p>
        </div>
        <span className="chip warn">Review needed</span>
      </div>
      <div className="card-actions review-actions">
        <button className="btn blue" onClick={() => onOpen(missionId)}>Review mission</button>
      </div>
    </article>
  );
}

function AllClearCard() {
  return (
    <article className="decision-card all-clear">
      <div className="all-clear-copy">
        <div className="panel-title">All clear</div>
        <div className="panel-sub">Nothing needs a decision right now. Larry will surface the next one here.</div>
      </div>
    </article>
  );
}

function WorkingStrip({ meta, delegations }: { meta: Meta | null; delegations: DelegationsResponse }) {
  const live = delegations.running;
  if (live.length === 0) {
    return (
      <div className="working-row idle">
        <div className="working-empty">
          No agents running. Hand Marco something above and it will show up here.
        </div>
      </div>
    );
  }
  return (
    <div className="working-row" style={{ gridTemplateColumns: `repeat(${Math.min(live.length, 3)}, minmax(0, 1fr))` }}>
      {live.map((d) => (
        <div key={d.id} className="working-item">
          <AgentBadge slug={d.agent} color={color(meta, d.agent)} size={44} />
          <div>
            <div className="working-name">{name(meta, d.agent)}</div>
            <div className="working-task">{d.title}</div>
            <div className="running"><span className="pulse" /> {d.status === "queued" ? "Queued" : "Running"}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function LaterList({
  meta,
  tasks,
  blocked = [],
  onTakeNow,
  onUnblock,
}: {
  meta: Meta | null;
  tasks: Task[];
  blocked?: Task[];
  onTakeNow: (id: string) => void;
  onUnblock?: (id: string) => void;
}) {
  const items = [
    ...tasks.map((task) => ({
      task,
      subtitle: `Tracked by Larry Ledger${task.snooze_count > 0 ? `, snoozed ${task.snooze_count}x` : ""}`,
      when: task.next_nag_at ? dueLabel(task.next_nag_at) : dueLabel(task.due_at),
      isBlocked: false,
    })),
    ...blocked.map((task) => ({
      task,
      subtitle: `Blocked: ${task.blocked_reason ?? "no reason on file"}`,
      when: task.blocked_recheck_at ? `Recheck ${dueLabel(task.blocked_recheck_at)}` : "Waiting",
      isBlocked: true,
    })),
  ];
  if (items.length === 0) {
    return (
      <ul className="later-list">
        <li className="empty-row">Nothing scheduled to come back. Snoozed and blocked commitments land here.</li>
      </ul>
    );
  }
  return (
    <ul className="later-list">
      {items.map(({ task, subtitle, when, isBlocked }) => (
        <li key={task.id}>
          <AgentBadge slug="larry" color={color(meta, "larry")} size={34} />
          <div>
            <span className="later-title">{task.title}</span>
            <span className={`later-sub ${isBlocked ? "blocked-sub" : ""}`}>{subtitle}</span>
          </div>
          <span className="later-when">{when}</span>
          {isBlocked ? (
            <button className="btn small" onClick={() => onUnblock?.(task.id)}>Unblock</button>
          ) : (
            <button className="btn small blue" onClick={() => onTakeNow(task.id)}>Take now</button>
          )}
        </li>
      ))}
    </ul>
  );
}

function TodayPage({
  meta,
  today,
  inbox,
  tasks,
  delegations,
  selectedTaskId,
  setSelectedTaskId,
  refresh,
  onOpenPacket,
  onOpenMission,
}: {
  meta: Meta | null;
  today: Today | null;
  inbox: InboxResponse;
  tasks: TasksResponse;
  delegations: DelegationsResponse;
  selectedTaskId: string | null;
  setSelectedTaskId: (id: string) => void;
  refresh: () => void;
  onOpenPacket: (id: string) => void;
  onOpenMission: (id: string) => void;
}) {
  const nagIds = new Set(inbox.nags.map((n) => n.task.id));
  const later = tasks.open.filter((t) => !nagIds.has(t.id));
  const decisions = inbox.nags.length + delegations.needs_review.length;
  const working = today?.agents_working ?? delegations.running.length;
  const atRisk = today?.at_risk ?? 0;
  const laterCount = later.length + tasks.blocked.length;

  return (
    <div className="today-page">
      <div className="greeting">
        <h1>{greeting()}</h1>
        <div className="chips">
          <span className={`chip-stat ${decisions > 0 ? "red" : "quiet"}`}>
            {decisions === 0 ? "No decisions waiting." : `${decisions} decision${decisions === 1 ? "" : "s"} need${decisions === 1 ? "s" : ""} you.`}
          </span>
          <span className={`chip-stat ${working > 0 ? "green" : "quiet"}`}>
            {working === 0 ? "Agents are idle." : `${working} agent${working === 1 ? "" : "s"} working.`}
          </span>
          <span className={`chip-stat ${atRisk > 0 ? "amber" : "quiet"}`}>
            {atRisk === 0 ? "Nothing at risk." : `${atRisk} commitment${atRisk === 1 ? "" : "s"} at risk.`}
          </span>
        </div>
      </div>

      <MarcoCapture meta={meta} onRouted={refresh} />

      <h2>Needs your decision {decisions > 0 && <span className="count red-bg">{decisions}</span>}</h2>
      <div className="card-grid">
        {decisions === 0 && <AllClearCard />}
        {inbox.nags.map(({ task, message, forced }, index) => (
          <TaskDecisionCard
            key={task.id}
            meta={meta}
            task={task}
            message={message}
            forced={forced}
            featured={index === 0}
            selected={selectedTaskId === task.id}
            snoozeCap={meta?.snooze_cap ?? 3}
            onSelect={() => setSelectedTaskId(task.id)}
            onDone={refresh}
          />
        ))}
        {groupMissions(delegations).map((entry) =>
          entry.kind === "mission" ? (
            <MissionCard
              key={entry.missionId}
              meta={meta}
              missionId={entry.missionId}
              members={entry.members}
              working={entry.working}
              onOpen={onOpenMission}
            />
          ) : (
            <DelegationReviewCard key={entry.d.id} meta={meta} d={entry.d} onDone={refresh} onOpen={onOpenPacket} />
          ),
        )}
      </div>

      <h2>Working in the background {delegations.running.length > 0 && <span className="count">{delegations.running.length}</span>}</h2>
      <WorkingStrip meta={meta} delegations={delegations} />

      <h2>Coming back later {laterCount > 0 && <span className="count">{laterCount}</span>}</h2>
      <LaterList
        meta={meta}
        tasks={later}
        blocked={tasks.blocked}
        onTakeNow={(id) =>
          api
            .takeNow(id)
            .then(refresh)
            .then(() => {
              // The task moves to the decision grid at the top; without this
              // the click looks like it did nothing from down here.
              document.querySelector(".card-grid")?.scrollIntoView({ behavior: "smooth" });
            })
            .catch((e) => alert((e as Error).message))
        }
        onUnblock={(id) => api.unblock(id).then(refresh)}
      />
    </div>
  );
}

function SessionsPage({ meta, onOpenPacket }: { meta: Meta | null; onOpenPacket: (id: string) => void }) {
  const [log, setLog] = useState<MarcoLogEntry[]>([]);
  const [dels, setDels] = useState<Delegation[]>([]);

  useEffect(() => {
    const load = () => {
      api.marcoLog().then((r) => setLog(r.log)).catch(() => {});
      api.delegations().then((r) => setDels([...r.running, ...r.needs_review, ...r.recent])).catch(() => {});
    };
    load();
    const id = setInterval(load, 10_000);
    return () => clearInterval(id);
  }, []);

  const openOnActivate = (id: string, title: string) => (e: React.KeyboardEvent | React.MouseEvent) => {
    if ("key" in e) {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
    }
    onOpenPacket(id);
  };

  return (
    <section className="simple-page">
      <h1>Sessions</h1>
      {dels.length === 0 && <div className="empty">No delegations yet.</div>}
      {dels.map((d) => (
        <article
          key={d.id}
          className="session-card clickable"
          role="button"
          tabIndex={0}
          aria-label={`Open session: ${d.title}`}
          onClick={openOnActivate(d.id, d.title)}
          onKeyDown={openOnActivate(d.id, d.title)}
        >
          <AgentBadge slug={d.agent} color={color(meta, d.agent)} size={40} />
          <div>
            <div className="session-title">{d.title}</div>
            <div className="card-meta">{name(meta, d.agent)} · {d.status}{d.runtime ? ` · ${d.runtime}` : ""}</div>
            {d.result && <p className="card-meta">{previewText(d.result, 160)}</p>}
          </div>
          <span className="session-open" aria-hidden="true">Open</span>
        </article>
      ))}
      <h2>Marco's routing log</h2>
      {log.map((entry) => (
        <article key={entry.id} className="session-card">
          <AgentBadge slug="marco" color={color(meta, "marco")} size={40} />
          <div>
            <div className="session-title">{entry.user_text}</div>
            <div className="card-meta">{entry.reply}</div>
          </div>
        </article>
      ))}
    </section>
  );
}

function PlaceholderPage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="simple-page">
      <h1>{title}</h1>
      {children}
    </section>
  );
}

const TIMEZONE_OPTIONS = [
  "UTC",
  "America/New_York",
  "America/Los_Angeles",
  "America/Denver",
  "Europe/London",
  "Europe/Paris",
  "Asia/Tokyo",
  "Asia/Singapore",
  "Australia/Sydney",
  "Australia/Melbourne",
  "Australia/Perth",
  "Pacific/Auckland",
];

function timezoneOptions(current: string): string[] {
  const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return [...new Set([current, browserTimezone, ...TIMEZONE_OPTIONS].filter(Boolean))];
}

function SettingsPage({ onSaved }: { onSaved: () => void }) {
  const [settings, setSettings] = useState<ReminderSettings | null>(null);
  const [defaults, setDefaults] = useState<ReminderSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const availableTimezones = useMemo(
    () => timezoneOptions(settings?.timezone ?? "UTC"),
    [settings?.timezone],
  );

  useEffect(() => {
    api.reminderSettings()
      .then((res) => {
        setSettings(res.settings);
        setDefaults(res.defaults);
      })
      .catch((err) => setError((err as Error).message));
  }, []);

  const update = (patch: Partial<ReminderSettings>) => {
    setSettings((current) => (current ? { ...current, ...patch } : current));
    setSaved(null);
  };
  const updateQuiet = (patch: Partial<ReminderSettings["quiet_hours"]>) => {
    setSettings((current) =>
      current ? { ...current, quiet_hours: { ...current.quiet_hours, ...patch } } : current,
    );
    setSaved(null);
  };
  const save = (next: ReminderSettings | null = settings) => {
    if (!next) return;
    setSaving(true);
    setError(null);
    api.updateReminderSettings(next)
      .then((res) => {
        setSettings(res.settings);
        setSaved("Saved");
        onSaved();
      })
      .catch((err) => setError((err as Error).message))
      .finally(() => setSaving(false));
  };

  return (
    <section className="simple-page settings-page">
      <h1>Settings</h1>
      {!settings ? (
        <div className="empty">Loading settings...</div>
      ) : (
        <>
          <div className="settings-grid">
            <article className="settings-card">
              <div className="settings-card-head">
                <div>
                  <div className="settings-title">Reminder Timezone</div>
                  <div className="settings-value">{settings.timezone}</div>
                </div>
              </div>
              <label className="settings-field">
                <span>Timezone</span>
                <select
                  value={settings.timezone}
                  onChange={(event) => update({ timezone: event.target.value })}
                >
                  {availableTimezones.map((timezone) => (
                    <option key={timezone} value={timezone}>{timezone}</option>
                  ))}
                </select>
              </label>
            </article>

            <article className="settings-card">
              <div className="settings-card-head">
                <div>
                  <div className="settings-title">Quiet Hours</div>
                  <div className="settings-value">
                    {settings.quiet_hours.start} to {settings.quiet_hours.end}
                  </div>
                </div>
              </div>
              <div className="settings-two">
                <label className="settings-field">
                  <span>Start</span>
                  <input
                    type="time"
                    value={settings.quiet_hours.start}
                    onChange={(event) => updateQuiet({ start: event.target.value })}
                  />
                </label>
                <label className="settings-field">
                  <span>End</span>
                  <input
                    type="time"
                    value={settings.quiet_hours.end}
                    onChange={(event) => updateQuiet({ end: event.target.value })}
                  />
                </label>
              </div>
            </article>

            <article className="settings-card">
              <div className="settings-card-head">
                <div>
                  <div className="settings-title">Daily Rhythm</div>
                  <div className="settings-value">
                    {settings.morning_brief} brief, {settings.evening_reckoning} reckoning
                  </div>
                </div>
              </div>
              <div className="settings-two">
                <label className="settings-field">
                  <span>Morning brief</span>
                  <input
                    type="time"
                    value={settings.morning_brief}
                    onChange={(event) => update({ morning_brief: event.target.value })}
                  />
                </label>
                <label className="settings-field">
                  <span>Evening reckoning</span>
                  <input
                    type="time"
                    value={settings.evening_reckoning}
                    onChange={(event) => update({ evening_reckoning: event.target.value })}
                  />
                </label>
              </div>
            </article>
          </div>

          <div className="settings-actions">
            <button className="btn primary" disabled={saving} onClick={() => save()}>
              {saving ? "Saving" : "Save changes"}
            </button>
            {defaults && (
              <button
                className="btn ghost"
                disabled={saving}
                onClick={() => {
                  setSettings(defaults);
                  save(defaults);
                }}
              >
                Reset defaults
              </button>
            )}
            {saved && <span className="settings-saved">{saved}</span>}
            {error && <span className="settings-error">{error}</span>}
          </div>
        </>
      )}
    </section>
  );
}

function EnsemblePanel({
  meta,
  delegations,
}: {
  meta: Meta | null;
  delegations: DelegationsResponse;
}) {
  if (!meta) return null;
  const ordered = ["marco", "larry", "sam", "paige", "penny", "dex"].filter((slug) => meta.personas[slug]);
  const workingBy = new Set(delegations.running.map((d) => d.agent));
  return (
    <aside className="right-rail">
      <section className="rail-panel ensemble-panel">
        <div className="ensemble-head">
          <span className="panel-title">Ensemble</span>
          <span className={"chip " + (meta.runtimes.length > 0 ? "ready" : "risk")}>
            {meta.runtimes.length > 0 ? "All systems go" : "No runtime"}
          </span>
        </div>
        <div className="ensemble-list">
          {ordered.map((slug) => {
            const p = meta.personas[slug]!;
            const on = workingBy.has(slug);
            const offline = slug === "dex" && meta.dex_mode === "remote" && !meta.dex_online;
            return (
              <div key={slug} className="ensemble-item">
                <AgentBadge slug={slug} color={p.color} size={78} />
                <div>
                  <div className="ensemble-name">{p.name}</div>
                  <div className="ensemble-role">{p.role}</div>
                </div>
                <div className={`rail-status ${on ? "on" : ""} ${offline ? "off" : ""}`}>
                  <span className={"status-dot " + (on ? "on" : "")} />{" "}
                  {offline ? "Offline" : on ? "Working" : "Ready"}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </aside>
  );
}

function Sidebar({
  view,
  setView,
  meta,
  decisions,
  running,
  open,
  reviews,
}: {
  view: View;
  setView: (view: View) => void;
  meta: Meta | null;
  decisions: number;
  running: number;
  open: number;
  reviews: number;
}) {
  return (
    <nav className="sidebar">
      <div className="logo">
        <span className="logo-mark">S</span>
        <span className="logo-text">SembleOps</span>
      </div>
      <div className="nav-list">
        {navItems.map((item) => {
          const count = statusCount(item.id, decisions, running, open, reviews);
          return (
            <button
              key={item.id}
              className={`nav-item ${view === item.id ? "active" : ""}`}
              onClick={() => setView(item.id)}
              aria-label={item.label}
              aria-current={view === item.id ? "page" : undefined}
            >
              <span className="nav-icon"><Icon name={item.icon} /></span>
              <span>{item.label}</span>
              {count > 0 && <span className="nav-count">{count}</span>}
            </button>
          );
        })}
      </div>
      <div className="sidebar-foot">
        <div className="avatar profile-avatar">
          <Icon name="user" />
        </div>
        <div className="foot-copy">
          <div className="sidebar-user">Local operator</div>
          <div className="sidebar-node">
            <span className={`node-dot ${meta ? "on" : ""}`} />
            {meta ? `${meta.node.charAt(0).toUpperCase() + meta.node.slice(1)} node` : "Connecting"}
          </div>
        </div>
      </div>
    </nav>
  );
}

function TopBar({
  notifications,
  permission,
  onPermissionChange,
  onRead,
  onReadAll,
}: {
  notifications: NotificationEvent[];
  permission: NotificationPermission | "unsupported";
  onPermissionChange: (permission: NotificationPermission | "unsupported") => void;
  onRead: (id: number) => void;
  onReadAll: () => void;
}) {
  return (
    <div className="topbar">
      <label className="search-box">
        <Icon name="search" />
        <input placeholder="Search anything..." />
        <span>⌘ K</span>
      </label>
      <div className="topbar-actions">
        <NotificationBell
          notifications={notifications}
          permission={permission}
          onPermissionChange={onPermissionChange}
          onRead={onRead}
          onReadAll={onReadAll}
        />
      </div>
    </div>
  );
}

export default function App() {
  const [view, setView] = useState<View>("today");
  const [meta, setMeta] = useState<Meta | null>(null);
  const [today, setToday] = useState<Today | null>(null);
  const [inbox, setInbox] = useState<InboxResponse>({ nags: [], rechecks: [] });
  const [tasks, setTasks] = useState<TasksResponse>({ open: [], blocked: [], closed: [] });
  const [notifications, setNotifications] = useState<NotificationEvent[]>([]);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">(notificationPermission());
  const [delegations, setDelegations] = useState<DelegationsResponse>({
    running: [],
    needs_review: [],
    recent: [],
  });
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [authNeeded, setAuthNeeded] = useState(false);
  const [packetId, setPacketId] = useState<string | null>(null);
  const [packetReturn, setPacketReturn] = useState<View>("today");

  const openPacket = useCallback(
    (id: string) => {
      setPacketId(id);
      if (view !== "packet" && view !== "mission") setPacketReturn(view);
      setView("packet");
    },
    [view],
  );

  const [missionId, setMissionId] = useState<string | null>(null);
  const openMission = useCallback(
    (id: string) => {
      setMissionId(id);
      if (view !== "packet" && view !== "mission") setPacketReturn(view);
      setView("mission");
    },
    [view],
  );

  const refresh = useCallback(async () => {
    try {
      const [m, t, i, ts, d, n] = await Promise.all([
        api.meta(),
        api.today(),
        api.inbox(),
        api.tasks(),
        api.delegations(),
        api.notifications(),
      ]);
      setMeta(m);
      setToday(t);
      setInbox(i);
      setTasks(ts);
      setDelegations(d);
      setNotifications(n.notifications);
      setError(null);
      setAuthNeeded(false);
      if (!selectedTaskId && i.nags[0]) setSelectedTaskId(i.nags[0].task.id);
    } catch (err) {
      if ((err as Error).message === "unauthorized") setAuthNeeded(true);
      else setError((err as Error).message);
    }
  }, [selectedTaskId]);

  useEffect(() => {
    api.meta().then(setMeta).catch(() => {});
    refresh();
    const id = setInterval(refresh, 10_000);
    return () => clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    if (permission !== "granted" || !("Notification" in window)) return;
    const pending = notifications.filter((n) => n.browser_notified_at === null).slice().reverse();
    for (const event of pending) {
      const native = new Notification(event.title, { body: event.body, tag: `sembleops-${event.id}` });
      native.onclick = () => {
        window.focus();
        api.markNotificationRead(event.id).then(() => refresh()).catch(() => {});
        native.close();
      };
      api.markNotificationNotified(event.id).then(() => refresh()).catch(() => {});
    }
  }, [notifications, permission, refresh]);

  const decisions = inbox.nags.length + delegations.needs_review.length;
  const selected = useMemo(
    () => inbox.nags.find((n) => n.task.id === selectedTaskId) ?? inbox.nags[0] ?? null,
    [inbox.nags, selectedTaskId],
  );
  if (authNeeded) return <TokenGate />;
  return (
    <div className={`shell ${view === "content" ? "content-shell" : ""}`}>
      <Sidebar
        view={view}
        setView={setView}
        meta={meta}
        decisions={decisions}
        running={delegations.running.length}
        open={tasks.open.length}
        reviews={delegations.needs_review.length}
      />
      <main className="main">
        <TopBar
          notifications={notifications}
          permission={permission}
          onPermissionChange={setPermission}
          onRead={(id) => api.markNotificationRead(id).then(refresh)}
          onReadAll={() => api.markAllNotificationsRead().then(refresh)}
        />
        {error && <div className="error">Hub unreachable: {error}</div>}
        {view === "today" && (
          <TodayPage
            meta={meta}
            today={today}
            inbox={inbox}
            tasks={tasks}
            delegations={delegations}
            selectedTaskId={selected?.task.id ?? null}
            setSelectedTaskId={setSelectedTaskId}
            refresh={refresh}
            onOpenPacket={openPacket}
            onOpenMission={openMission}
          />
        )}
        {view === "content" && (
          <ContentStudio meta={meta} onOpenPacket={openPacket} onOpenMission={openMission} />
        )}
        {view === "packet" && packetId && (
          <PacketView
            meta={meta}
            packetId={packetId}
            onBack={() => setView(packetReturn)}
            onResolved={refresh}
            onOpenPacket={openPacket}
          />
        )}
        {view === "mission" && missionId && (
          <MissionView
            meta={meta}
            missionId={missionId}
            onBack={() => setView(packetReturn)}
            onResolved={refresh}
            onOpenPacket={openPacket}
          />
        )}
        {view === "sessions" && <SessionsPage meta={meta} onOpenPacket={openPacket} />}
        {view === "ensemble" && (
          <PlaceholderPage title="Ensemble">
            <div className="ensemble-grid">
              {meta &&
                Object.entries(meta.personas).map(([slug, p]) => (
                  <article key={slug} className="session-card">
                    <AgentBadge slug={slug} color={p.color} size={52} />
                    <div>
                      <div className="session-title">{p.name}</div>
                      <div className="card-meta">{p.role} · {p.promise}</div>
                    </div>
                  </article>
                ))}
            </div>
          </PlaceholderPage>
        )}
        {view === "commitments" && (
          <PlaceholderPage title="Commitments">
            <LaterList
              meta={meta}
              tasks={tasks.open}
              blocked={tasks.blocked}
              onTakeNow={(id) =>
                api
                  .takeNow(id)
                  .then(refresh)
                  .then(() => setView("today")) // the decision card lives on Today
                  .catch((e) => alert((e as Error).message))
              }
              onUnblock={(id) => api.unblock(id).then(refresh)}
            />
          </PlaceholderPage>
        )}
        {view === "approvals" && (
          <PlaceholderPage title="Approvals">
            {delegations.needs_review.map((d) => <DelegationReviewCard key={d.id} meta={meta} d={d} onDone={refresh} onOpen={openPacket} />)}
          </PlaceholderPage>
        )}
        {view === "calendar" && <PlaceholderPage title="Calendar"><div className="empty">Calendar drafting will land with Larry's block-time bridge.</div></PlaceholderPage>}
        {view === "settings" && (
          <SettingsPage onSaved={() => api.meta().then(setMeta).catch(() => {})} />
        )}
      </main>
      {view !== "content" && (
        <EnsemblePanel
          meta={meta}
          delegations={delegations}
        />
      )}
    </div>
  );
}
