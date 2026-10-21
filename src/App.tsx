import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ArrowRightIcon,
  ArrowLeftIcon,
  MicrophoneIcon,
  CheckIcon,
  FlagIcon,
  UsersThreeIcon,
  TimerIcon,
  ChartBarIcon,
  GearSixIcon,
  DownloadSimpleIcon,
  UploadSimpleIcon,
  PlayIcon,
  PauseIcon,
  SignOutIcon,
  WarningCircleIcon,
  CheckCircleIcon,
  ArrowsClockwiseIcon,
  ClipboardTextIcon,
  SpeakerHighIcon,
  ShieldCheckIcon,
} from "@phosphor-icons/react";
import { api, setCsrf, setTransport, getTransport } from "./api";
import { SpeechCapture, speechAvailable } from "./speech";
import { GoogleButton, useAuthConfig } from "./google";
import type {
  AdminState,
  Exam,
  Provider,
  StudentState,
  RatingTask,
  Person,
  Settings,
} from "./types";

const competence = [
  "seems to be a true expert on the topic",
  "knows exactly what they are talking about",
  "displays an impressive level of understanding",
];
const presentation = [
  "was well spoken, polished, and articulate",
  "was stylish, well put together, and attractive",
];
const scale = [
  "Strongly disagree",
  "Disagree",
  "Neither agree nor disagree",
  "Agree",
  "Strongly agree",
];
const defaultSettings: Settings = {
  roundSeconds: 900,
  transitionSeconds: 300,
  invitationSeconds: 12,
  rounds: 3,
  weights: { ai: 50, peer: 30, willingness: 20 },
};
const formatNumber = (v: number) =>
  v.toLocaleString(undefined, { maximumFractionDigits: 1 });
function Button({
  children,
  onClick,
  variant = "primary",
  disabled = false,
  type = "button",
  className = "",
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: string;
  disabled?: boolean;
  type?: "button" | "submit";
  className?: string;
  title?: string;
}) {
  return (
    <button
      title={title}
      className={`button ${variant} ${className}`}
      type={type}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
function Notice({
  children,
  kind = "error",
}: {
  children: ReactNode;
  kind?: string;
}) {
  return (
    <div
      className={`notice ${kind}`}
      role={kind === "error" ? "alert" : "status"}
    >
      {kind === "error" ? (
        <WarningCircleIcon size={20} />
      ) : (
        <CheckCircleIcon size={20} />
      )}
      <span>{children}</span>
    </div>
  );
}
function Brand() {
  return (
    <a className="brand" href="/" aria-label="cquiz home">
      cquiz
      <span className="brand-dot" />
    </a>
  );
}
function Countdown({
  deadline,
  remaining,
  paused,
  offset = 0,
}: {
  deadline: number | null;
  remaining?: number | null;
  paused?: boolean;
  offset?: number;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);
  const seconds = Math.max(
    0,
    Math.ceil(
      (paused ? (remaining ?? 0) : (deadline ?? now) - now - offset) / 1000,
    ),
  );
  return (
    <span className="countdown">
      <TimerIcon size={18} />
      {Math.floor(seconds / 60)
        .toString()
        .padStart(2, "0")}
      :{(seconds % 60).toString().padStart(2, "0")}
      {paused ? " paused" : ""}
    </span>
  );
}
function useRemote<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState("");
  const loading = useRef<string | null>(null),
    mounted = useRef(true),
    currentPath = useRef(path);
  currentPath.current = path;
  const refresh = useCallback(async () => {
    if (!path || loading.current === path) return;
    loading.current = path;
    try {
      const next = await api<T>(path);
      if (mounted.current && currentPath.current === path) {
        setData(next);
        setError("");
      }
    } catch (e) {
      if (mounted.current && currentPath.current === path)
        setError((e as Error).message);
    } finally {
      if (loading.current === path) loading.current = null;
    }
  }, [path]);
  useEffect(() => {
    mounted.current = true;
    setData(null);
    void refresh();
    const polling = getTransport() === "poll";
    const timer = setInterval(
      () => void refresh(),
      polling && path !== "/admin/state" ? 2500 : 10000,
    );
    const events = path && !polling ? new EventSource("/api/events") : null;
    events?.addEventListener("change", refresh);
    events?.addEventListener("ready", refresh);
    return () => {
      mounted.current = false;
      clearInterval(timer);
      events?.close();
    };
  }, [path, refresh]);
  return { data, error, refresh, setData };
}
function useAction() {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, setError, run };
}
function Field({
  label,
  id,
  value,
  onChange,
  type = "text",
  autoComplete,
  inputMode,
  required = true,
  hint,
  list,
}: {
  label: string;
  id: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  autoComplete?: string;
  inputMode?: "numeric" | "email" | "text";
  required?: boolean;
  hint?: string;
  list?: string;
}) {
  const [error, setError] = useState("");
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        name={id}
        list={list}
        type={type}
        value={value}
        spellCheck={type !== "email" && inputMode !== "numeric"}
        onChange={(e) => {
          onChange(e.target.value);
          setError("");
        }}
        onBlur={(e) =>
          setError(
            !e.target.checkValidity()
              ? "Check this field before continuing."
              : "",
          )
        }
        required={required}
        autoComplete={autoComplete || "off"}
        inputMode={inputMode}
        aria-describedby={hint ? `${id}-hint` : undefined}
        aria-invalid={!!error}
      />
      {hint && <small id={`${id}-hint`}>{hint}</small>}
      {error && <small className="field-error">{error}</small>}
    </div>
  );
}
function RatingForm({
  person,
  statements,
  onSubmit,
  busy,
}: {
  person: Person;
  statements: string[];
  onSubmit: (v: number[]) => void;
  busy: boolean;
}) {
  const [values, setValues] = useState<number[]>(statements.map(() => 0));
  return (
    <form
      className="rating-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(values);
      }}
    >
      {statements.map((statement, i) => (
        <fieldset className="likert" key={statement}>
          <legend>
            <strong>{person.name}</strong> {statement}
          </legend>
          <div className="likert-options">
            {scale.map((label, j) => (
              <label
                key={label}
                className={values[i] === j + 1 ? "chosen" : ""}
              >
                <input
                  type="radio"
                  aria-label={label}
                  name={`rating-${person.id}-${i}`}
                  value={j + 1}
                  checked={values[i] === j + 1}
                  onChange={() =>
                    setValues((old) => old.map((v, k) => (k === i ? j + 1 : v)))
                  }
                />
                <span>{j + 1}</span>
                <span className="sr-only">{label}</span>
              </label>
            ))}
          </div>
          <div className="scale-labels" aria-hidden="true">
            <span>Strongly disagree</span>
            <span>Strongly agree</span>
          </div>
        </fieldset>
      ))}
      <Button
        type="submit"
        disabled={values.some((v) => !v) || busy}
        className="wide"
      >
        <CheckIcon />
        {busy ? "Saving ratings…" : "Save ratings"}
      </Button>
    </form>
  );
}
function RatingCard({
  task,
  onSave,
  busy,
}: {
  task: RatingTask;
  onSave: (v: number[]) => void;
  busy: boolean;
}) {
  return (
    <section className="student-section">
      <div className="section-heading">
        <h2>Your impression</h2>
        {task.speaking && <span className="badge">Speaking now</span>}
      </div>
      <p className="muted">
        Complete all three statements to unlock your next contribution.
      </p>
      <RatingForm
        person={task.speaker}
        statements={competence}
        onSubmit={onSave}
        busy={busy}
      />
    </section>
  );
}

function VoicePanel({
  prefix = "",
  onFinish,
  onDraft,
  label = "Your Key Insight / Top Idea",
  preflight = false,
  paused = false,
}: {
  prefix?: string;
  onFinish: (text: string) => Promise<void>;
  onDraft?: (text: string) => void;
  label?: string;
  preflight?: boolean;
  paused?: boolean;
}) {
  const [text, setText] = useState(prefix),
    [status, setStatus] = useState<"listening" | "stopped">("stopped"),
    [error, setError] = useState(""),
    [finishing, setFinishing] = useState(false);
  const capture = useRef<SpeechCapture | null>(null),
    textRef = useRef(prefix),
    draftCallback = useRef(onDraft);
  draftCallback.current = onDraft;
  useEffect(() => {
    capture.current = new SpeechCapture(
      (value) => {
        textRef.current = value;
        setText(value);
      },
      setStatus,
      setError,
      prefix,
    );
    return () => capture.current?.abort();
  }, []);
  useEffect(() => {
    if (paused)
      void capture.current?.finish().then((value) => {
        textRef.current = value;
        setText(value);
        draftCallback.current?.(value);
      });
  }, [paused]);
  useEffect(() => {
    if (!onDraft) return;
    let last = prefix;
    const interval = setInterval(() => {
      if (textRef.current && textRef.current !== last) {
        last = textRef.current;
        draftCallback.current?.(last);
      }
    }, 1800);
    return () => clearInterval(interval);
  }, [!!onDraft, prefix]);
  async function finish() {
    setFinishing(true);
    setError("");
    try {
      const value = await capture.current!.finish();
      textRef.current = value;
      setText(value);
      if (!value.trim())
        throw new Error(
          "No words were collected. Resume voice input and try again.",
        );
      await onFinish(value);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setFinishing(false);
    }
  }
  function start() {
    setError("");
    capture.current?.start(textRef.current);
  }
  return (
    <section
      className={`voice-panel ${status === "listening" ? "listening" : ""}`}
    >
      <label id="transcript-label">{label}</label>
      <div
        role="textbox"
        aria-readonly="true"
        aria-labelledby="transcript-label"
        aria-live="polite"
        aria-atomic="true"
        className="transcript"
      >
        {text || (
          <span>
            {preflight
              ? "Say a few words to check your microphone."
              : "Speak one idea. Your words will appear here."}
          </span>
        )}
      </div>
      <div className="voice-status" role="status">
        {status === "listening" ? (
          <>
            <span className="live-dot" />
            Listening
          </>
        ) : (
          <>
            <MicrophoneIcon size={18} />
            {text ? "Voice input stopped" : "Ready for your voice"}
          </>
        )}
      </div>
      {error && <Notice>{error}</Notice>}
      <div className="voice-actions">
        {status !== "listening" && (
          <Button
            onClick={start}
            disabled={paused || finishing || !speechAvailable()}
            variant="accent"
          >
            <MicrophoneIcon />
            {text ? "Resume voice input" : "Start voice input"}
          </Button>
        )}
        <Button
          onClick={() => void finish()}
          disabled={paused || !text.trim() || finishing}
          variant={status === "listening" ? "accent" : "secondary"}
        >
          {finishing
            ? "Finishing transcript…"
            : preflight
              ? "Microphone check complete"
              : "Finish contribution"}
          <CheckIcon />
        </Button>
      </div>
      {!speechAvailable() && (
        <Notice>
          Voice input is unavailable here. Open the exam over HTTPS in Safari on
          iPhone or Chrome on Android. On iPhone, check that Siri is enabled.
        </Notice>
      )}
      {!preflight && (
        <small className="muted">
          Your text submits as spoken. You can flag a transcription error
          afterward.
        </small>
      )}
    </section>
  );
}
function Student({ logout }: { logout: () => void }) {
  const { data: s, error, refresh } = useRemote<StudentState>("/student/state"),
    action = useAction();
  const [selectedFlag, setSelectedFlag] = useState<string | null>(null);
  const requestId = useRef(crypto.randomUUID()),
    draftSequence = useRef(0);
  useEffect(() => {
    requestId.current = crypto.randomUUID();
    draftSequence.current = s?.currentOwn?.draftVersion ?? 0;
  }, [s?.currentOwn?.id]);
  const post = (path: string, body: unknown) =>
    action.run(async () => {
      await api(path, body);
      await refresh();
    });
  if (!s)
    return (
      <main className="student-shell">
        <Brand />
        {error ? <Notice>{error}</Notice> : <div className="skeleton large" />}
        <Button onClick={logout} variant="ghost">
          Return to sign in
        </Button>
      </main>
    );
  const ownTurn =
    s.table?.speaker?.id === s.person.id && s.table.phase === "speaking";
  const latest = s.ownResponses.filter((r) => r.submitted).at(-1);
  return (
    <div className="student-page">
      <header className="student-header">
        <Brand />
        <button className="icon-button" onClick={logout} aria-label="Sign out">
          <SignOutIcon size={22} />
        </button>
      </header>
      <main id="main" className="student-shell">
        <div className="student-context">
          <span>
            {s.round ? `Round ${s.round} of 3` : "Before the exam"}
            {s.table ? ` / Table ${s.table.number}` : ""}
          </span>
          {s.deadline && (
            <Countdown
              deadline={s.deadline}
              remaining={s.remaining}
              paused={s.paused}
              offset={s.serverTime - Date.now()}
            />
          )}
        </div>
        {s.mode === "rehearsal" && (
          <div className="rehearsal-strip">
            Rehearsal · Scores are illustrative
          </div>
        )}
        {(error || action.error) && <Notice>{error || action.error}</Notice>}
        {!s.person.preflight ? (
          <>
            <h1>Make sure we hear you.</h1>
            <p className="muted">
              Hi {s.person.name}. Check that your phone turns your voice into
              text before joining the conversation. cquiz stores text, not
              audio.
            </p>
            <VoicePanel
              preflight
              onFinish={async () => {
                await api("/student/preflight", { passed: true });
                await refresh();
              }}
            />
          </>
        ) : s.status === "lobby" ? (
          <section className="waiting-stage">
            <UsersThreeIcon size={56} weight="light" />
            <h1>You’re ready.</h1>
            <p>
              Your instructor will start <strong>{s.name}</strong>. Keep this
              page open and your phone awake.
            </p>
            <span className="badge success">
              <CheckCircleIcon />
              Microphone checked
            </span>
          </section>
        ) : s.phase === "transition" ? (
          <>
            <h1>Time to mingle.</h1>
            <p className="muted">
              Give your impressions, then head to your next table.
            </p>
            {s.diagnostics[0] ? (
              <section className="student-section">
                <h2>Thinking about {s.diagnostics[0].name}</h2>
                <RatingForm
                  key={`${s.diagnostics[0].round}-${s.diagnostics[0].id}`}
                  person={s.diagnostics[0]}
                  statements={presentation}
                  busy={action.busy}
                  onSubmit={(values) =>
                    void post("/student/diagnostics", {
                      targetId: s.diagnostics[0].id,
                      round: s.diagnostics[0].round,
                      values,
                    })
                  }
                />
              </section>
            ) : (
              <Notice kind="success">Presentation ratings saved.</Notice>
            )}
            {s.nextTable && (
              <section className="next-table">
                <h2>Next: Table {s.nextTable.number}</h2>
                <p>
                  {s.nextTable.members
                    .filter((p) => p.id !== s.person.id)
                    .map((p) => p.name)
                    .join(", ")}
                </p>
              </section>
            )}
          </>
        ) : s.status === "completed" ? (
          <>
            <h1>That’s your exam.</h1>
            <p className="muted">
              Your contributions are saved. Complete any remaining impressions
              before leaving.
            </p>
            {s.diagnostics[0] && (
              <section className="student-section">
                <RatingForm
                  key={`final-${s.diagnostics[0].round}-${s.diagnostics[0].id}`}
                  person={s.diagnostics[0]}
                  statements={presentation}
                  busy={action.busy}
                  onSubmit={(values) =>
                    void post("/student/diagnostics", {
                      targetId: s.diagnostics[0].id,
                      round: s.diagnostics[0].round,
                      values,
                    })
                  }
                />
              </section>
            )}
            {!s.diagnostics.length && !s.ratings.length && (
              <Notice kind="success">
                You’re finished. Thank you for contributing.
              </Notice>
            )}
          </>
        ) : (
          <>
            {s.paused && (
              <Notice kind="info">
                Your instructor has paused the exam. Your collected text is
                preserved.
              </Notice>
            )}
            {s.question ? (
              <section className="question-stage">
                <h1>{s.question.prompt}</h1>
                <p className="prompt-cue">
                  Give your top insider tip. One insight at a time.
                </p>
              </section>
            ) : (
              <section className="question-stage">
                <h1>Waiting for the next question.</h1>
                <p className="muted">
                  Your instructor can see your table’s status.
                </p>
              </section>
            )}
            {s.table?.speaker && (
              <div className={`speaker-strip ${ownTurn ? "your-turn" : ""}`}>
                <div className="avatar">
                  {s.table.speaker.name
                    .split(" ")
                    .map((w) => w[0])
                    .slice(0, 2)
                    .join("")}
                </div>
                <div>
                  <strong>
                    {ownTurn ? "Your turn" : s.table.speaker.name}
                  </strong>
                  <span>
                    {ownTurn ? "Share your key insight." : "has the floor"}
                  </span>
                </div>
                {ownTurn ? (
                  <MicrophoneIcon size={28} />
                ) : (
                  <SpeakerHighIcon size={24} />
                )}
              </div>
            )}
            {ownTurn && (
              <VoicePanel
                key={s.currentOwn?.id}
                paused={s.paused}
                prefix={s.currentOwn?.text || ""}
                onDraft={(text) => {
                  void api("/student/draft", {
                    text,
                    responseId: s.currentOwn?.id,
                    version: ++draftSequence.current,
                  }).catch(() => {});
                }}
                onFinish={async (text) => {
                  await api("/student/finish", {
                    text,
                    requestId: requestId.current,
                    responseId: s.currentOwn?.id,
                  });
                  requestId.current = crypto.randomUUID();
                  await refresh();
                }}
              />
            )}
            {s.invitation && !s.ratings.length && (
              <section className="volunteer-stage">
                <p>
                  {s.invitation.volunteered
                    ? "You’re in the pool. The host will select a speaker."
                    : "Have something to contribute?"}
                </p>
                <Button
                  variant="accent"
                  className="wide"
                  disabled={
                    !s.invitation.eligible ||
                    s.invitation.volunteered ||
                    s.paused ||
                    action.busy
                  }
                  onClick={() => void post("/student/volunteer", {})}
                >
                  {s.invitation.volunteered ? (
                    <>
                      <CheckIcon />
                      Ready to contribute
                    </>
                  ) : (
                    <>
                      I have something to add
                      <ArrowRightIcon />
                    </>
                  )}
                </Button>
                <small>
                  Everyone has the same invitation window. Speed doesn’t matter.
                </small>
              </section>
            )}
            {s.table?.phase === "rating" && !s.ratings.length && !ownTurn && (
              <p className="muted centered">
                Your ratings are saved. Waiting for the next invitation.
              </p>
            )}
          </>
        )}
        {s.ratings[0] && !s.paused && (
          <RatingCard
            key={s.ratings[0].responseId}
            task={s.ratings[0]}
            busy={action.busy}
            onSave={(values) =>
              void post("/student/rate", {
                responseId: s.ratings[0].responseId,
                values,
              })
            }
          />
        )}
        {latest && !latest.flagged && (
          <div className="flag-control">
            <Button
              variant="ghost"
              onClick={() => setSelectedFlag(selectedFlag ? null : latest.id)}
            >
              <FlagIcon />
              Flag a transcription error
            </Button>
            {selectedFlag === latest.id && (
              <div className="flag-details">
                <p className="transcript-preview">{latest.text}</p>
                <p className="muted">
                  A flag records your concern. This response still counts in the
                  evaluation.
                </p>
                <Button
                  variant="secondary"
                  disabled={action.busy}
                  onClick={() => {
                    void post("/student/flag", { responseId: latest.id });
                    setSelectedFlag(null);
                  }}
                >
                  Flag this response
                </Button>
              </div>
            )}
          </div>
        )}
        {latest?.flagged && (
          <small className="flag-saved">
            <FlagIcon />
            Transcription concern recorded. Evaluation remains included.
          </small>
        )}
      </main>
      <footer className="student-footer">
        {s.person.name}
        <span>Keep this page open</span>
      </footer>
    </div>
  );
}
function Join({ onAuth }: { onAuth: (role: string, csrf: string) => void }) {
  const [exams, setExams] = useState<
      { id: string; name: string; mode: string }[]
    >([]),
    [examId, setExamId] = useState(""),
    [email, setEmail] = useState(""),
    [studentId, setStudentId] = useState("");
  const action = useAction();
  const config = useAuthConfig();
  const selected = exams.find((e) => e.id === examId);
  // Live exams use school Google sign-in when it is configured; rehearsals
  // keep email + student ID so fictional students can join.
  const useGoogle = !!config?.googleClientId && selected?.mode !== "rehearsal";
  function googleJoin(credential: string) {
    void action.run(async () => {
      const r = await api<{ role: string; csrf: string }>("/student/google", {
        examId,
        credential,
      });
      onAuth(r.role, r.csrf);
    });
  }
  useEffect(() => {
    void api<{ exams: typeof exams }>("/public")
      .then((r) => {
        setExams(r.exams);
        setExamId(r.exams[0]?.id || "");
      })
      .catch((e) => action.setError(e.message));
  }, []);
  return (
    <div className="join-layout">
      <header>
        <Brand />
      </header>
      <main id="main" className="join-main">
        <div className="join-mark" aria-hidden="true">
          <MicrophoneIcon size={40} weight="light" />
        </div>
        <h1>
          Bring your
          <br />
          best insight.
        </h1>
        <p className="join-intro">
          A conversation. A chance to show what you know.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void action.run(async () => {
              const r = await api<{ role: string; csrf: string }>(
                "/student/join",
                { examId, email, studentId },
              );
              onAuth(r.role, r.csrf);
            });
          }}
        >
          {exams.length > 1 && (
            <div className="field">
              <label htmlFor="exam-select">Your exam</label>
              <select
                id="exam-select"
                value={examId}
                onChange={(e) => setExamId(e.target.value)}
              >
                {exams.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                    {e.mode === "rehearsal" ? " (rehearsal)" : ""}
                  </option>
                ))}
              </select>
            </div>
          )}
          {exams.length === 1 && (
            <div className="join-exam">
              <span className="status-dot" />
              {exams[0].name}
              {exams[0].mode === "rehearsal" && (
                <span className="badge">Rehearsal</span>
              )}
            </div>
          )}
          {useGoogle ? (
            examId && (
              <GoogleButton
                key={examId}
                clientId={config!.googleClientId!}
                onCredential={googleJoin}
                onError={action.setError}
                text="continue_with"
              />
            )
          ) : (
            <>
              <Field
                label="School email"
                id="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                value={email}
                onChange={setEmail}
              />
              <Field
                label="Student ID number"
                id="student-id"
                inputMode="numeric"
                autoComplete="off"
                value={studentId}
                onChange={setStudentId}
              />
              <Button
                type="submit"
                className="wide"
                variant="accent"
                disabled={action.busy || !examId}
              >
                {action.busy ? "Joining…" : "Join your exam"}
                <ArrowRightIcon />
              </Button>
            </>
          )}
          {action.error && <Notice>{action.error}</Notice>}
          {useGoogle && action.busy && (
            <Notice kind="info">Joining your exam…</Notice>
          )}
          {!exams.length && (
            <Notice kind="info">
              No exam is open yet. Your instructor needs to create one before
              you can join.
            </Notice>
          )}
        </form>
        <p className="join-note">
          {useGoogle
            ? "Use the school Google account on your instructor’s roster. You’ll check your microphone next."
            : "Use the email and ID on your instructor’s roster. You’ll check your microphone next."}
        </p>
      </main>
      <footer className="join-footer">
        <a href="/admin">Instructor workspace</a>
        <a href="/privacy">Data and privacy</a>
      </footer>
    </div>
  );
}
function AdminLogin({
  onAuth,
}: {
  onAuth: (role: string, csrf: string) => void;
}) {
  const [password, setPassword] = useState("");
  const action = useAction();
  const config = useAuthConfig();
  return (
    <div className="admin-login">
      <Brand />
      <main id="main">
        <div className="login-symbol">
          <ShieldCheckIcon size={36} />
        </div>
        <h1>
          Your exam,
          <br />
          under control.
        </h1>
        <p>Sign in to prepare questions, manage tables, and inspect results.</p>
        {config?.googleClientId && config.googleAdmin && (
          <>
            <GoogleButton
              clientId={config.googleClientId}
              onError={action.setError}
              onCredential={(credential) =>
                void action.run(async () => {
                  const r = await api<{ role: string; csrf: string }>(
                    "/admin/google",
                    { credential },
                  );
                  onAuth(r.role, r.csrf);
                })
              }
            />
            <p className="login-divider">or use the instructor password</p>
          </>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void action.run(async () => {
              const r = await api<{ role: string; csrf: string }>(
                "/admin/login",
                { password },
              );
              onAuth(r.role, r.csrf);
            });
          }}
        >
          <Field
            label="Instructor password"
            id="admin-password"
            type="password"
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
          />
          {action.error && <Notice>{action.error}</Notice>}
          <Button className="wide" type="submit" disabled={action.busy}>
            {action.busy ? "Signing in…" : "Open instructor workspace"}
            <ArrowRightIcon />
          </Button>
        </form>
        <a className="back-link" href="/">
          <ArrowLeftIcon />
          Student sign in
        </a>
      </main>
    </div>
  );
}

function UploadBlock({
  kind,
  count,
  onUpload,
  busy,
}: {
  kind: "bank" | "roster";
  count: number;
  onUpload: (file: File) => void;
  busy: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <section className="upload-block">
      <div className="upload-title">
        <div className="file-symbol">
          <ClipboardTextIcon size={26} />
        </div>
        <div>
          <h3>{kind === "bank" ? "Question bank" : "Student roster"}</h3>
          <p>
            {count
              ? `${count} ${kind === "bank" ? "questions" : "students"} loaded`
              : "Upload a CSV or Excel file"}
          </p>
        </div>
        {count > 0 && <CheckCircleIcon className="success-text" size={24} />}
      </div>
      <p className="muted">
        {kind === "bank"
          ? "One row per weighted insight, with grading guidance and source references."
          : "School email, student ID as text, and the name shown at the table."}
      </p>
      <div className="upload-actions">
        <input
          ref={ref}
          type="file"
          accept=".csv,.xlsx"
          className="sr-only"
          aria-label={`Upload ${kind}`}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onUpload(file);
            e.target.value = "";
          }}
        />
        <Button
          variant="secondary"
          onClick={() => ref.current?.click()}
          disabled={busy}
        >
          <UploadSimpleIcon />
          {count ? "Replace file" : "Upload file"}
        </Button>
        <a
          className="text-link"
          href={`/api/admin/template/${kind}?format=xlsx`}
          download
        >
          Excel template
        </a>
        <a className="text-link" href={`/api/admin/template/${kind}`} download>
          CSV
        </a>
      </div>
    </section>
  );
}
function ProviderForm({
  provider,
  onSave,
  onTest,
  busy,
}: {
  provider: Provider;
  onSave: (body: unknown) => void;
  onTest: () => void;
  busy: boolean;
}) {
  const [model, setModel] = useState(provider.model),
    [key, setKey] = useState(""),
    [zdr, setZdr] = useState(provider.zdr);
  const [models, setModels] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    let active = true;
    void api<{ models: { id: string; name: string }[] }>("/admin/models")
      .then((r) => {
        if (active) setModels(r.models);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => setModel(provider.model), [provider.model]);
  return (
    <section className="setup-section">
      <div className="section-heading">
        <h2>AI connection</h2>
        <span className={`badge ${provider.testedAt ? "success" : ""}`}>
          {provider.testedAt ? "Connection checked" : "Not verified"}
        </span>
      </div>
      <p className="muted">
        OpenRouter evaluates answer text against your uploaded rubric. Names,
        emails and IDs are not sent for grading.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave({ model, key, zdr });
          setKey("");
        }}
      >
        <div className="two-fields">
          <Field
            label="OpenRouter model ID"
            id="model"
            value={model}
            onChange={setModel}
            autoComplete="off"
            list="openrouter-models"
            hint="Choose a structured-output model from the suggestions, or paste its OpenRouter model ID."
          />
          <datalist id="openrouter-models">
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </datalist>
          <Field
            label={
              provider.hasKey
                ? "API key (leave blank to keep saved key)"
                : "OpenRouter API key"
            }
            id="api-key"
            type="password"
            value={key}
            onChange={setKey}
            autoComplete="new-password"
            required={!provider.hasKey}
          />
        </div>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={zdr}
            onChange={(e) => setZdr(e.target.checked)}
          />
          Require providers with zero data retention
        </label>
        <div className="button-row">
          <Button type="submit" variant="secondary" disabled={busy}>
            Save connection
          </Button>
          <Button
            variant="primary"
            disabled={busy || !provider.hasKey || !provider.model}
            onClick={onTest}
          >
            {busy ? "Checking…" : "Test AI connection"}
            <ArrowsClockwiseIcon />
          </Button>
        </div>
      </form>
      <small className="muted">
        Keys stay encrypted on the server. The connection test makes a small
        synthetic API request.
      </small>
    </section>
  );
}
function Setup({
  state,
  onRefresh,
  onCreated,
}: {
  state: AdminState;
  onRefresh: () => Promise<void>;
  onCreated: (id: string) => void;
}) {
  const action = useAction();
  const [name, setName] = useState("AI tools & techniques"),
    [mode, setMode] = useState("rehearsal"),
    [settings, setSettings] = useState(defaultSettings),
    [success, setSuccess] = useState("");
  async function upload(kind: string, file: File) {
    const form = new FormData();
    form.append("file", file);
    await api(`/admin/import/${kind}`, form);
    await onRefresh();
    setSuccess(
      `${kind === "bank" ? "Question bank" : "Roster"} validated and saved.`,
    );
  }
  function setting(field: keyof Settings, value: number) {
    setSettings((old) => ({ ...old, [field]: value }));
  }
  return (
    <div className="setup-layout">
      <div>
        <div className="page-heading">
          <div>
            <h1>Prepare the conversation.</h1>
            <p>Bring the content. cquiz keeps the exam moving.</p>
          </div>
          <a className="button secondary" href="/content-prompt.txt" download>
            <DownloadSimpleIcon />
            Content preparation prompt
          </a>
        </div>
        {action.error && <Notice>{action.error}</Notice>}
        {success && <Notice kind="success">{success}</Notice>}
        <div className="import-grid">
          <UploadBlock
            kind="bank"
            count={state.bank.length}
            busy={action.busy}
            onUpload={(file) => void action.run(() => upload("bank", file))}
          />
          <UploadBlock
            kind="roster"
            count={state.roster.length}
            busy={action.busy}
            onUpload={(file) => void action.run(() => upload("roster", file))}
          />
        </div>
        <details className="rehearsal-details">
          <summary>Try a synthetic rehearsal first</summary>
          <p>
            The sample bank is a workflow fixture, not an approved course exam.
            The roster contains four fictional students.
          </p>
          <Button
            variant="secondary"
            disabled={action.busy}
            onClick={() =>
              void action.run(async () => {
                for (const kind of ["bank", "roster"]) {
                  const response = await fetch(`/sample-${kind}.csv`);
                  await upload(
                    kind,
                    new File([await response.blob()], `${kind}.csv`, {
                      type: "text/csv",
                    }),
                  );
                }
                setSuccess("Synthetic rehearsal kit loaded.");
              })
            }
          >
            Load rehearsal kit
          </Button>
          <a href="/sample-roster.csv" download className="text-link">
            View sample login pairs
          </a>
        </details>
        <ProviderForm
          provider={state.provider}
          busy={action.busy}
          onSave={(body) =>
            void action.run(async () => {
              await api("/admin/provider", body);
              await onRefresh();
              setSuccess(
                "Connection settings saved. Test the connection before a live exam.",
              );
            })
          }
          onTest={() =>
            void action.run(async () => {
              await api("/admin/provider/test", {});
              await onRefresh();
              setSuccess("AI connection passed its rubric evaluation probe.");
            })
          }
        />
        {state.bank.length > 0 && (
          <details className="bank-preview">
            <summary>
              Inspect uploaded question bank ({state.bank.length})
            </summary>
            {state.bank.map((q) => (
              <article key={q.id}>
                <h3>{q.prompt}</h3>
                <p className="muted">
                  {q.topic} · Difficulty {q.difficulty}
                </p>
                <ul>
                  {q.insights.map((i) => (
                    <li key={i.id}>
                      <strong>{i.weight} points</strong> {i.text}
                      <small>{i.source}</small>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </details>
        )}
      </div>
      <aside className="exam-config">
        <h2>New exam</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void action.run(async () => {
              const r = await api<{ id: string }>("/admin/exams", {
                name,
                mode,
                settings,
              });
              onCreated(r.id);
              await onRefresh();
            });
          }}
        >
          <Field
            label="Exam name"
            id="exam-name"
            value={name}
            onChange={setName}
          />
          <fieldset className="mode-select">
            <legend>Run mode</legend>
            <label className={mode === "rehearsal" ? "chosen" : ""}>
              <input
                type="radio"
                name="mode"
                value="rehearsal"
                checked={mode === "rehearsal"}
                onChange={() => setMode("rehearsal")}
              />
              <strong>Rehearsal</strong>
              <small>Illustrative scoring for workflow checks</small>
            </label>
            <label className={mode === "live" ? "chosen" : ""}>
              <input
                type="radio"
                name="mode"
                value="live"
                checked={mode === "live"}
                onChange={() => setMode("live")}
              />
              <strong>Live exam</strong>
              <small>Verified AI connection and HTTPS required</small>
            </label>
          </fieldset>
          <h3>Assessment weights</h3>
          <div className="weight-fields">
            {(["ai", "peer", "willingness"] as const).map((k, i) => (
              <div className="field" key={k}>
                <label htmlFor={`weight-${k}`}>
                  {["AI mastery", "Peer competence", "Willingness"][i]}
                </label>
                <div className="number-suffix">
                  <input
                    type="number"
                    id={`weight-${k}`}
                    min={0}
                    max={100}
                    value={settings.weights[k]}
                    onChange={(e) =>
                      setSettings((old) => ({
                        ...old,
                        weights: {
                          ...old.weights,
                          [k]: Number(e.target.value),
                        },
                      }))
                    }
                  />
                  <span>%</span>
                </div>
              </div>
            ))}
          </div>
          <p
            className={
              Object.values(settings.weights).reduce((a, b) => a + b, 0) === 100
                ? "muted"
                : "field-error"
            }
          >
            Total: {Object.values(settings.weights).reduce((a, b) => a + b, 0)}
            %. Settings lock at the start.
          </p>
          <h3>Timing</h3>
          <div className="two-fields">
            <div className="field">
              <label htmlFor="round-time">Round minutes</label>
              <input
                id="round-time"
                type="number"
                min={0.5}
                max={60}
                step={0.5}
                value={settings.roundSeconds / 60}
                onChange={(e) =>
                  setting(
                    "roundSeconds",
                    Math.round(Number(e.target.value) * 60),
                  )
                }
              />
            </div>
            <div className="field">
              <label htmlFor="transition-time">Mingle minutes</label>
              <input
                id="transition-time"
                type="number"
                min={1 / 6}
                max={15}
                step={1 / 6}
                value={settings.transitionSeconds / 60}
                onChange={(e) =>
                  setting(
                    "transitionSeconds",
                    Math.round(Number(e.target.value) * 60),
                  )
                }
              />
            </div>
          </div>
          <div className="field">
            <label htmlFor="invitation-time">Invitation seconds</label>
            <input
              id="invitation-time"
              type="number"
              min={5}
              max={60}
              value={settings.invitationSeconds}
              onChange={(e) =>
                setting("invitationSeconds", Number(e.target.value))
              }
            />
          </div>
          <div className="schedule-preview">
            <span>Three rounds, two mingles</span>
            <strong>
              {formatNumber(
                (3 * settings.roundSeconds + 2 * settings.transitionSeconds) /
                  60,
              )}{" "}
              minutes
            </strong>
          </div>
          <Button
            className="wide"
            type="submit"
            disabled={
              action.busy ||
              state.bank.length < 3 ||
              state.roster.length < 3 ||
              Object.values(settings.weights).reduce((a, b) => a + b, 0) !== 100
            }
          >
            Create exam lobby
            <ArrowRightIcon />
          </Button>
        </form>
      </aside>
    </div>
  );
}

function Standings({ exam }: { exam: Exam }) {
  const [query, setQuery] = useState("");
  const rows = exam.ranking.filter((r) =>
    r.name.toLowerCase().includes(query.toLowerCase()),
  );
  const values = exam.ranking.map((r) => r.points),
    max = Math.max(1, ...values);
  const bins = Array(5).fill(0);
  for (const value of values)
    bins[Math.min(4, Math.floor((value / max) * 5))]++;
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Knowledge, in perspective.</h1>
          <p>Ranking leads. Points preserve the distance between students.</p>
        </div>
        <div className="button-row">
          <a
            className="button secondary"
            href={`/api/admin/exams/${exam.id}/export?format=csv`}
            download
          >
            <DownloadSimpleIcon />
            Scores CSV
          </a>
          <a
            className="button secondary"
            href={`/api/admin/exams/${exam.id}/export`}
            download
          >
            Full evidence
          </a>
        </div>
      </div>
      {exam.mode === "rehearsal" && (
        <Notice kind="info">
          Rehearsal results use keyword matching. They are not real AI
          assessments.
        </Notice>
      )}
      {(!exam.rankingMeta.converged ||
        exam.responses.some((r) =>
          ["pending", "grading", "error"].includes(r.evaluation.status),
        ) ||
        exam.pendingRatings > 0) && (
        <Notice kind="info">
          Standings are provisional: assessment or peer evidence is still
          incomplete
          {!exam.rankingMeta.converged
            ? ", or peer weights have not stabilized"
            : ""}
          .
        </Notice>
      )}
      <section className="distribution">
        <div>
          <h2>Insight point distribution</h2>
          <p className="muted">Students in each point range.</p>
        </div>
        <div
          className="histogram"
          role="img"
          aria-label={`Students by insight point range: ${bins.map((count, i) => `${formatNumber((i * max) / 5)} to ${formatNumber(((i + 1) * max) / 5)} points: ${count} students`).join("; ")}`}
        >
          {bins.map((count, i) => (
            <div key={i}>
              <small className="bin-count">{count}</small>
              <span
                style={{ height: `${(count / Math.max(1, ...bins)) * 80}px` }}
              />
              <small>
                {formatNumber((i * max) / 5)}–
                {formatNumber(((i + 1) * max) / 5)}
                <br />
                points
              </small>
            </div>
          ))}
        </div>
      </section>
      <div className="table-toolbar">
        <label htmlFor="standings-search">Find a student</label>
        <input
          id="standings-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search names…"
        />
      </div>
      <div
        className="data-table-wrap"
        tabIndex={0}
        role="region"
        aria-label="Class standings"
      >
        <table className="data-table">
          <thead>
            <tr>
              {[
                "Rank",
                "Student",
                "Composite",
                "Points",
                "AI mastery",
                "Peer",
                "Willingness",
                "Evidence",
              ].map((h) => (
                <th key={h} scope="col">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="rank-number">{r.rank}</td>
                <th scope="row">
                  {r.name}
                  <small>
                    {r.answers} answers / {r.topics} topics
                  </small>
                </th>
                <td>
                  <strong>{formatNumber(r.score)}</strong>
                </td>
                <td>{formatNumber(r.points)}</td>
                <td>{formatNumber(r.ai)}</td>
                <td>{formatNumber(r.peer)}</td>
                <td>
                  {formatNumber(r.willingness)}%
                  <small>
                    {r.volunteered} / {r.eligible}
                  </small>
                </td>
                <td>
                  <span
                    className={`badge ${r.evidence === "Established" ? "success" : ""}`}
                  >
                    {r.evidence}
                  </span>
                  {r.flags > 0 && <small>{r.flags} flagged</small>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">
        Composite weights: {exam.settings.weights.ai}% AI,{" "}
        {exam.settings.weights.peer}% peers, {exam.settings.weights.willingness}
        % willingness. Ties share a rank. Evidence labels are coverage
        indicators, not statistical confidence intervals.
      </p>
    </>
  );
}
function Evidence({
  exam,
  onAction,
  busy,
}: {
  exam: Exam;
  onAction: (action: string, body?: unknown) => void;
  busy: boolean;
}) {
  const [filter, setFilter] = useState("all"),
    [selected, setSelected] = useState<string | null>(null);
  const name = (id: string) => exam.roster.find((s) => s.id === id)?.name ?? id;
  const rows = exam.responses.filter(
    (r) =>
      r.submittedAt &&
      (filter === "all" ||
        (filter === "flagged" && r.flagged) ||
        (filter === "errors" && r.evaluation.status === "error")),
  );
  const response = exam.responses.find((r) => r.id === selected);
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>The evidence behind it.</h1>
          <p>Original transcripts, assessment rationale, and peer judgments.</p>
        </div>
        <a
          className="button secondary"
          href={`/api/admin/exams/${exam.id}/export`}
          download
        >
          <DownloadSimpleIcon />
          Export evidence
        </a>
      </div>
      <div className="filter-tabs">
        {["all", "flagged", "errors"].map((f) => (
          <button
            key={f}
            className={filter === f ? "active" : ""}
            onClick={() => setFilter(f)}
          >
            {f === "all"
              ? "All responses"
              : f === "flagged"
                ? "Transcription flags"
                : "Evaluation errors"}
          </button>
        ))}
      </div>
      <div className="evidence-layout">
        <section className="response-list">
          {rows.length ? (
            rows
              .slice()
              .reverse()
              .map((r) => (
                <button
                  key={r.id}
                  className={`response-item ${selected === r.id ? "selected" : ""}`}
                  onClick={() => setSelected(r.id)}
                >
                  <div>
                    <strong>{name(r.studentId)}</strong>
                    <span>
                      Round {r.round}
                      {r.flagged ? " / Flagged" : ""}
                    </span>
                  </div>
                  <p>{r.text}</p>
                  <span
                    className={`badge ${r.evaluation.status === "done" ? "success" : ""}`}
                  >
                    {r.evaluation.status === "done"
                      ? `${formatNumber(r.points)} insight points`
                      : r.evaluation.status}
                  </span>
                </button>
              ))
          ) : (
            <div className="empty-state">
              <ClipboardTextIcon size={44} />
              <h2>No responses here yet.</h2>
              <p>
                Submitted contributions will appear with their original text.
              </p>
            </div>
          )}
        </section>
        <aside className="evidence-detail">
          {response ? (
            <>
              <h2>{name(response.studentId)}</h2>
              <p className="muted">
                {exam.bank.find((q) => q.id === response.questionId)?.prompt}
              </p>
              <blockquote>{response.text}</blockquote>
              {response.flagged && (
                <Notice kind="info">
                  Student flagged a transcription concern. This answer remains
                  included.
                </Notice>
              )}
              <h3>AI assessment</h3>
              {response.evaluation.error ? (
                <>
                  <Notice>{response.evaluation.error}</Notice>
                  <Button
                    disabled={busy}
                    onClick={() =>
                      onAction("retry", { responseId: response.id })
                    }
                  >
                    Retry evaluation
                  </Button>
                </>
              ) : (
                <p>
                  {response.evaluation.explanation || "Assessment pending."}
                </p>
              )}
              {response.creditedInsights.map((i) => (
                <div key={i.id} className="insight-result">
                  <strong>
                    {formatNumber(i.credit * i.weight)} / {i.weight}
                  </strong>
                  <p>{i.reason}</p>
                </div>
              ))}
              <h3>Peer evidence</h3>
              {exam.ratings
                .filter((p) => p.responseId === response.id)
                .map((p) => (
                  <div key={p.id} className="peer-evidence">
                    <strong>{name(p.raterId)}</strong>
                    <span>
                      {p.values.join(" / ")} · Current influence{" "}
                      {p.currentWeight.toFixed(2)}×
                    </span>
                    <small>
                      At submission: rank {p.rankSnapshot.rank}, AI{" "}
                      {formatNumber(p.rankSnapshot.ai)}, peer{" "}
                      {formatNumber(p.rankSnapshot.peer)}
                    </small>
                  </div>
                ))}
            </>
          ) : (
            <div className="empty-state">
              <h2>Inspect a contribution.</h2>
              <p>
                Select a response to see its assessment and original peer
                evidence.
              </p>
            </div>
          )}
        </aside>
      </div>
    </>
  );
}
function ExamRoom({
  exam,
  onAction,
  busy,
}: {
  exam: Exam;
  onAction: (action: string, body?: unknown) => void;
  busy: boolean;
}) {
  const [confirmEnd, setConfirmEnd] = useState(false);
  const online = new Set(exam.online),
    ready = exam.roster.filter((s) => s.preflight && online.has(s.id));
  const name = (id: string) => exam.roster.find((s) => s.id === id)?.name ?? id;
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>
            {exam.status === "lobby"
              ? "Ready when your class is."
              : exam.phase === "transition"
                ? "A new conversation awaits."
                : exam.status === "completed"
                  ? "Every contribution, preserved."
                  : "The room is in conversation."}
          </h1>
          <p>
            {exam.name}
            {exam.round ? ` / Round ${exam.round} of 3` : ""}
          </p>
        </div>
        {exam.deadline && (
          <Countdown
            deadline={exam.deadline}
            paused={exam.paused}
            remaining={exam.remaining}
          />
        )}
      </div>
      {exam.mode === "rehearsal" && (
        <Notice kind="info">
          Rehearsal exam. The AI assessment is a synthetic fixture.
        </Notice>
      )}
      <div className="room-summary">
        <div>
          <UsersThreeIcon />
          <strong>{online.size}</strong>
          <span>connected</span>
        </div>
        <div>
          <MicrophoneIcon />
          <strong>{ready.length}</strong>
          <span>microphones checked</span>
        </div>
        <div>
          <ClipboardTextIcon />
          <strong>{exam.responses.filter((r) => r.submittedAt).length}</strong>
          <span>contributions</span>
        </div>
        <div>
          <FlagIcon />
          <strong>{exam.responses.filter((r) => r.flagged).length}</strong>
          <span>transcription flags</span>
        </div>
      </div>
      {exam.status === "lobby" ? (
        <div className="lobby-layout">
          <section className="roster-list">
            <div className="section-heading">
              <h2>Attendance</h2>
              <span className="badge">
                {ready.length} ready / {exam.roster.length} on roster
              </span>
            </div>
            <p className="muted">
              Students join at <strong>{window.location.origin}/</strong>.
              Verify who is present before starting.
            </p>
            {exam.roster.map((s) => (
              <div className="roster-row" key={s.id}>
                <div>
                  <strong>{s.name}</strong>
                  <small>{s.email}</small>
                </div>
                <span
                  className={`badge ${s.preflight && online.has(s.id) ? "success" : ""}`}
                >
                  {!online.has(s.id)
                    ? "Not connected"
                    : s.preflight
                      ? "Ready"
                      : "Checking microphone"}
                </span>
                {s.joined && (
                  <button
                    className="text-button"
                    onClick={() => onAction("release", { studentId: s.id })}
                    disabled={busy}
                  >
                    Release session
                  </button>
                )}
              </div>
            ))}
          </section>
          <aside className="readiness-panel">
            <h2>Before you start</h2>
            <ul className="readiness-list">
              <li>
                <CheckCircleIcon />
                {exam.bank.length} questions frozen in this exam
              </li>
              <li>
                <CheckCircleIcon />
                Weights total 100%
              </li>
              <li className={ready.length >= 3 ? "" : "not-ready"}>
                {ready.length >= 3 ? (
                  <CheckCircleIcon />
                ) : (
                  <WarningCircleIcon />
                )}
                At least three connected students checked
              </li>
              <li>
                <ShieldCheckIcon />
                Confirm each student’s identity in the room
              </li>
            </ul>
            <p>
              Only connected students who passed the microphone check enter the
              first grouping.
            </p>
            <Button
              className="wide"
              disabled={busy || ready.length < 3}
              onClick={() => onAction("start")}
            >
              <PlayIcon />
              Start {exam.mode === "live" ? "live exam" : "rehearsal"}
            </Button>
            <small>All settings lock when the exam begins.</small>
          </aside>
        </div>
      ) : (
        <>
          <div className="exam-controls">
            {exam.status === "running" && (
              <>
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => onAction(exam.paused ? "resume" : "pause")}
                >
                  {exam.paused ? <PlayIcon /> : <PauseIcon />}
                  {exam.paused ? "Resume exam" : "Pause exam"}
                </Button>
                <Button
                  variant="secondary"
                  disabled={busy || exam.paused}
                  onClick={() => onAction("next")}
                >
                  {exam.phase === "transition"
                    ? "Start next round"
                    : "End round & mingle"}
                  <ArrowRightIcon />
                </Button>
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => onAction("extend")}
                >
                  Add one minute
                </Button>
              </>
            )}
            <span>{exam.pendingRatings} competence ratings pending</span>
          </div>
          {exam.phase === "transition" && exam.nextGroups && (
            <section className="mingle-grid">
              {exam.nextGroups.map((g) => (
                <article className="mingle-table" key={g.id}>
                  <h2>Next table {g.number}</h2>
                  <ul>
                    {g.members.map((id) => (
                      <li key={id}>{name(id)}</li>
                    ))}
                  </ul>
                  <small>{g.reason}</small>
                </article>
              ))}
            </section>
          )}
          {exam.phase !== "transition" && (
            <section className="table-grid">
              {exam.tables.map((t) => (
                <article
                  className={`table-card ${t.phase === "speaking" ? "active-turn" : ""}`}
                  key={t.id}
                >
                  <div className="section-heading">
                    <h2>Table {t.number}</h2>
                    <span
                      className={`badge ${t.phase === "speaking" ? "accent-badge" : ""}`}
                    >
                      {t.phase === "invitation"
                        ? "Inviting contributions"
                        : t.phase === "speaking"
                          ? "Speaking"
                          : t.phase === "rating"
                            ? "Assessing / rating"
                            : t.phase === "exhausted"
                              ? "Bank exhausted"
                              : t.phase}
                    </span>
                  </div>
                  <p className="table-question">
                    {exam.bank.find((q) => q.id === t.questionId)?.prompt ||
                      "No unseen questions remain for this group."}
                  </p>
                  <ul className="table-members">
                    {t.members.map((id) => (
                      <li
                        key={id}
                        className={t.speakerId === id ? "selected-speaker" : ""}
                      >
                        <span
                          className={`status-dot ${online.has(id) ? "" : "offline"}`}
                        />
                        {name(id)}
                        {t.speakerId === id && <MicrophoneIcon />}
                      </li>
                    ))}
                  </ul>
                  {t.phase === "speaking" && (
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={() => onAction("skip", { tableId: t.id })}
                    >
                      Release stalled turn
                    </Button>
                  )}
                </article>
              ))}
            </section>
          )}
          <details className="attendance-details">
            <summary>Connections and session recovery</summary>
            {exam.roster
              .filter((s) => s.active)
              .map((s) => (
                <div className="roster-row" key={s.id}>
                  <strong>{s.name}</strong>
                  <span>{online.has(s.id) ? "Connected" : "Disconnected"}</span>
                  <button
                    className="text-button"
                    onClick={() => onAction("release", { studentId: s.id })}
                  >
                    Release session
                  </button>
                </div>
              ))}
          </details>
          {exam.status === "running" && (
            <details className="end-exam">
              <summary>End the exam early</summary>
              <p>
                All accepted responses remain saved. Active text received by the
                server is submitted for assessment.
              </p>
              {!confirmEnd ? (
                <Button
                  variant="danger"
                  disabled={busy}
                  onClick={() => setConfirmEnd(true)}
                >
                  End exam…
                </Button>
              ) : (
                <div className="button-row">
                  <Button
                    variant="danger"
                    disabled={busy}
                    onClick={() => {
                      onAction("stop");
                      setConfirmEnd(false);
                    }}
                  >
                    Confirm end exam
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() => setConfirmEnd(false)}
                  >
                    Keep exam running
                  </Button>
                </div>
              )}
            </details>
          )}
          {exam.status === "completed" && (
            <Notice kind="success">
              The exam is closed. Remaining ratings and failed evaluations can
              still be resolved before exporting.
            </Notice>
          )}
        </>
      )}
    </>
  );
}
function Admin({ logout }: { logout: () => void }) {
  const { data: state, error, refresh } = useRemote<AdminState>("/admin/state");
  const [examId, setExamId] = useState<string | null>(null),
    [view, setView] = useState("setup");
  const remote = useRemote<Exam>(examId ? `/admin/exams/${examId}` : null);
  const action = useAction();
  function examAction(actionName: string, body: unknown = {}) {
    void action.run(async () => {
      await api(`/admin/exams/${examId}/action`, {
        action: actionName,
        ...(body as object),
      });
      await remote.refresh();
      await refresh();
    });
  }
  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <Brand />
        <div className="workspace-label">Instructor workspace</div>
        <nav aria-label="Instructor navigation">
          {[
            { id: "setup", label: "Preparation", icon: GearSixIcon },
            { id: "room", label: "Exam room", icon: UsersThreeIcon },
            { id: "standings", label: "Standings", icon: ChartBarIcon },
            { id: "evidence", label: "Evidence", icon: ClipboardTextIcon },
          ].map((item) => (
            <button
              key={item.id}
              className={view === item.id ? "active" : ""}
              disabled={item.id !== "setup" && !examId}
              onClick={() => setView(item.id)}
            >
              <item.icon size={22} />
              {item.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <p>Conversation reveals knowledge.</p>
          <a href="/privacy">Data and privacy</a>
          <Button variant="ghost" onClick={logout}>
            <SignOutIcon />
            Sign out
          </Button>
        </div>
      </aside>
      <div className="admin-workspace">
        <header className="admin-topbar">
          <div className="exam-switcher">
            <label htmlFor="current-exam">Exam</label>
            <select
              id="current-exam"
              value={examId || ""}
              onChange={(e) => {
                setExamId(e.target.value || null);
                if (e.target.value) setView("room");
              }}
            >
              <option value="">Select an exam</option>
              {state?.exams
                .slice()
                .reverse()
                .map((e) => (
                  <option value={e.id} key={e.id}>
                    {e.name} / {e.mode} / {e.status}
                  </option>
                ))}
            </select>
          </div>
          <a className="student-link" href="/" target="_blank" rel="noreferrer">
            Student entry
            <ArrowRightIcon />
          </a>
        </header>
        <main id="main" className="admin-main">
          {(error || remote.error || action.error) && (
            <Notice>{error || remote.error || action.error}</Notice>
          )}
          {!state ? (
            <div className="skeleton large" />
          ) : view === "setup" ? (
            <Setup
              state={state}
              onRefresh={refresh}
              onCreated={(id) => {
                setExamId(id);
                setView("room");
              }}
            />
          ) : !remote.data ? (
            <div className="skeleton large" />
          ) : view === "room" ? (
            <ExamRoom
              exam={remote.data}
              onAction={examAction}
              busy={action.busy}
            />
          ) : view === "standings" ? (
            <Standings exam={remote.data} />
          ) : (
            <Evidence
              exam={remote.data}
              onAction={examAction}
              busy={action.busy}
            />
          )}
        </main>
      </div>
    </div>
  );
}
function Privacy() {
  return (
    <main id="main" className="privacy-page">
      <Brand />
      <h1>Data and privacy</h1>
      <p>
        cquiz retains exam text, roster identity fields, volunteering events,
        private peer ratings, assessment results, and calculation history on the
        instructor’s server. It does not record, upload, or store audio.
      </p>
      <p>
        Your browser’s speech recognition service may process microphone audio
        externally. Answer text and question rubrics are sent through the
        instructor’s configured OpenRouter service for live assessment; student
        names, school emails, and ID numbers are not included in those grading
        requests. Providers have their own data policies. Instructors control
        server access, exports, and retention.
      </p>
      <p>
        Presentation ratings are private diagnostic data and do not affect
        grades, standings, or grouping. A transcription flag remains part of the
        record; it does not exclude an answer from evaluation.
      </p>
      <p>
        Student entry matches a roster pair. Instructors verify attendance in
        the room. No advertising, third-party analytics, or public ranking is
        included.
      </p>
      <a className="button secondary" href="/">
        <ArrowLeftIcon />
        Back to cquiz
      </a>
    </main>
  );
}
export default function App() {
  const [role, setRole] = useState<string | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  useEffect(() => {
    void api<{ role: string | null; csrf?: string; transport?: string }>("/me")
      .then((r) => {
        setRole(r.role);
        setCsrf(r.csrf || "");
        setTransport(r.transport || "sse");
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  function auth(next: string, csrf: string) {
    setCsrf(csrf);
    setRole(next);
  }
  async function logout() {
    try {
      await api("/logout", {});
      setCsrf("");
      setRole(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const known = ["/", "/admin", "/privacy"].includes(window.location.pathname);
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      {error && <Notice>{error}</Notice>}
      {!known ? (
        <main id="main" className="privacy-page">
          <Brand />
          <h1>This page isn’t here.</h1>
          <a className="button primary" href="/">
            Return to cquiz
          </a>
        </main>
      ) : window.location.pathname === "/privacy" ? (
        <Privacy />
      ) : loading ? (
        <main id="main" className="student-shell">
          <Brand />
          <div className="skeleton large" />
        </main>
      ) : role === "student" ? (
        <Student logout={() => void logout()} />
      ) : role === "admin" ? (
        <Admin logout={() => void logout()} />
      ) : window.location.pathname === "/admin" ? (
        <AdminLogin onAuth={auth} />
      ) : (
        <Join onAuth={auth} />
      )}
    </>
  );
}
