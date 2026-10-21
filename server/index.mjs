import express from "express";
import { ipAddress } from "@vercel/functions";
import multer from "multer";
import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { Store, hash } from "./store.mjs";
import {
  AppError,
  assert,
  parseUpload,
  validateBank,
  validateRoster,
  template,
  toCSV,
} from "./imports.mjs";
import * as engine from "./engine.mjs";
import { recalculate, snapshot } from "./scoring.mjs";
import { evaluate, rehearsalEvaluate } from "./provider.mjs";
import {
  googleConfig,
  createGoogleVerifier,
  verifiedGoogleEmail,
  normalizeEmail,
} from "./google.mjs";
export async function createApp(options = {}) {
  const serverless = options.serverless === true;
  assert(
    !serverless || options.store,
    "A shared PostgreSQL store is required on Vercel.",
    500,
  );
  const dataDir =
    options.dataDir ??
    (serverless ? ":memory:" : resolve(process.env.DATA_DIR || "./data"));
  const store = options.store ?? new Store(dataDir),
    app = express();
  const password = options.password ?? process.env.ADMIN_PASSWORD;
  assert(
    password && password.length >= 12,
    "Set ADMIN_PASSWORD to at least 12 characters. Run npm run setup first.",
    500,
  );
  const salt = randomBytes(16),
    passwordHash = scryptSync(password, salt, 32);
  const google = googleConfig(options),
    verifyGoogle = google.enabled
      ? createGoogleVerifier(google, options)
      : null;
  const googleCSP = google.enabled
    ? {
        script: " https://accounts.google.com/gsi/client",
        style: " https://accounts.google.com/gsi/style",
        frame: "; frame-src https://accounts.google.com/gsi/",
        connect: " https://accounts.google.com/gsi/",
      }
    : { script: "", style: "", frame: "", connect: "" };
  const origin =
    options.origin ??
    process.env.PUBLIC_ORIGIN ??
    (serverless
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:4318");
  const secure =
    options.secure ?? (serverless || process.env.SECURE_COOKIES === "true");
  const allowed = new Set([
    origin,
    ...(serverless
      ? [
          process.env.VERCEL_PROJECT_PRODUCTION_URL,
          process.env.VERCEL_BRANCH_URL,
        ]
          .filter(Boolean)
          .map((host) => `https://${host}`)
      : []),
    ...(process.env.NODE_ENV !== "production"
      ? ["http://localhost:5173", "http://127.0.0.1:5173"]
      : []),
  ]);
  if (dataDir !== ":memory:") mkdirSync(dataDir, { recursive: true });
  const keyFile = dataDir === ":memory:" ? null : join(dataDir, "server.key");
  const configuredKey =
    options.encryptionKey ?? process.env.CQUIZ_ENCRYPTION_KEY;
  assert(
    !serverless || /^[a-f0-9]{64}$/i.test(configuredKey ?? ""),
    "CQUIZ_ENCRYPTION_KEY must contain 64 hexadecimal characters on Vercel.",
    500,
  );
  const encryptionKey = configuredKey
    ? Buffer.from(configuredKey, "hex")
    : keyFile && existsSync(keyFile)
      ? readFileSync(keyFile)
      : randomBytes(32);
  assert(encryptionKey.length === 32, "Invalid encryption key.", 500);
  if (keyFile && !existsSync(keyFile))
    writeFileSync(keyFile, encryptionKey, { mode: 0o600 });
  function encrypt(value) {
    const iv = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", encryptionKey, iv),
      content = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return [
      iv.toString("hex"),
      cipher.getAuthTag().toString("hex"),
      content.toString("hex"),
    ].join(":");
  }
  function decrypt(value) {
    const [iv, tag, content] = value
        .split(":")
        .map((v) => Buffer.from(v, "hex")),
      decipher = createDecipheriv("aes-256-gcm", encryptionKey, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(content), decipher.final()]).toString(
      "utf8",
    );
  }
  const providerFingerprint = (p) =>
    hash(JSON.stringify({ model: p.model, key: p.key, zdr: p.zdr }));
  async function providerConfig() {
    const p = await store.config("provider", {}),
      config = {
        model: p.model ?? process.env.OPENROUTER_MODEL ?? "",
        key: p.encryptedKey
          ? decrypt(p.encryptedKey)
          : (process.env.OPENROUTER_API_KEY ?? ""),
        zdr: p.zdr ?? process.env.OPENROUTER_ZDR !== "false",
        testedAt: null,
      };
    config.testedAt =
      p.testedFingerprint === providerFingerprint(config)
        ? (p.testedAt ?? null)
        : null;
    return config;
  }
  async function publicProvider() {
    const p = await providerConfig();
    return {
      model: p.model,
      hasKey: !!p.key,
      zdr: p.zdr,
      testedAt: p.testedAt,
    };
  }
  const clients = new Set(),
    jobs = new Set(),
    attempts = new Map(),
    notificationTimers = new Map();
  let workers = 0,
    timer,
    stopping = false;
  function notify(id) {
    if (serverless || stopping || notificationTimers.has(id)) return;
    notificationTimers.set(
      id,
      setTimeout(() => {
        notificationTimers.delete(id);
        for (const c of clients)
          if (c.role === "admin" || c.examId === id)
            c.res.write(
              `event: change\ndata: ${JSON.stringify({ examId: id })}\n\n`,
            );
      }, 350),
    );
  }
  async function update(id, type, fn) {
    const e = await store.update(id, type, fn);
    if (e) notify(id);
    return e;
  }
  async function throttle(key, max) {
    await store.throttle(key, max);
  }
  const clientIP = (req) =>
    serverless && process.env.VERCEL
      ? (ipAddress({ get: (name) => req.get(name) ?? null }) ?? req.ip)
      : req.ip;
  app.disable("x-powered-by");
  app.set("trust proxy", process.env.TRUST_PROXY || false);
  app.use(async (req, res, next) => {
    await ready;
    if (stopping && !["GET", "HEAD"].includes(req.method))
      return next(
        new AppError(
          "Server is restarting. Your accepted exam data is saved. Retry after reconnecting.",
          503,
        ),
      );
    res.set({
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      // Google's sign-in button checks the page origin, so share only the
      // origin (never the path) when Google sign-in is enabled.
      "Referrer-Policy": google.enabled
        ? "strict-origin-when-cross-origin"
        : "no-referrer",
      "X-Frame-Options": "DENY",
      "Permissions-Policy": "microphone=(self), camera=()",
      "Content-Security-Policy": `default-src 'self'; script-src 'self'${googleCSP.script}; style-src 'self' 'unsafe-inline'${googleCSP.style}; font-src 'self'; img-src 'self' data:; connect-src 'self'${googleCSP.connect}${googleCSP.frame}; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`,
    });
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      !allowed.has(req.headers.origin)
    )
      return next(
        new AppError("This request must come from the cquiz application.", 403),
      );
    next();
  });
  app.use(express.json({ limit: "24kb" }));
  app.use("/api", async (req, res, next) => {
    const token = (req.headers.cookie ?? "")
      .split(";")
      .map((p) => p.trim())
      .find((p) => p.startsWith("cquiz_session="))
      ?.slice(14);
    req.session = await store.authenticate(token);
    if (req.session) {
      await store.touch(req.session.token);
      if (
        !["GET", "HEAD"].includes(req.method) &&
        !["/logout"].includes(req.path) &&
        req.headers["x-csrf-token"] !== req.session.csrf
      )
        return next(
          new AppError("Session check failed. Refresh and try again.", 403),
        );
    }
    if (serverless && req.session?.role === "student")
      await advanceClock(req.session.exam_id);
    next();
  });
  const admin = (req, res, next) =>
    req.session?.role === "admin"
      ? next()
      : next(new AppError("Instructor sign in required.", 401));
  const student = (req, res, next) =>
    req.session?.role === "student"
      ? next()
      : next(new AppError("Join the exam first.", 401));
  function setCookie(res, token) {
    res.cookie("cquiz_session", token, {
      httpOnly: true,
      sameSite: "strict",
      secure,
      path: "/",
      maxAge: 8 * 3600000,
    });
  }
  app.get("/api/health", (req, res) =>
    res.json({ ok: true, service: "cquiz" }),
  );
  app.get("/api/public", async (req, res) =>
    res.json({
      exams: (await store.list())
        .filter((e) => e.status === "lobby" || e.status === "running")
        .map((e) => ({
          id: e.id,
          name: e.name,
          mode: e.mode,
          status: e.status,
        })),
    }),
  );
  app.post("/api/admin/login", async (req, res) => {
    await throttle(`admin:${clientIP(req)}`, 8);
    assert(
      typeof req.body.password === "string" && req.body.password.length <= 200,
      "Incorrect instructor password.",
      401,
    );
    const candidate = scryptSync(req.body.password, salt, 32);
    assert(
      timingSafeEqual(candidate, passwordHash),
      "Incorrect instructor password.",
      401,
    );
    if (req.session) await store.revoke(req.session.token);
    const s = await store.session("admin");
    setCookie(res, s.token);
    res.json({ role: "admin", csrf: s.csrf });
  });
  app.get("/api/auth/config", (req, res) =>
    res.json({
      googleClientId: google.enabled ? google.clientId : null,
      googleAdmin: google.enabled && google.adminEmails.size > 0,
    }),
  );
  app.post("/api/admin/google", async (req, res) => {
    await throttle(`admin:${clientIP(req)}`, 8);
    const email = await verifiedGoogleEmail(
      google,
      verifyGoogle,
      req.body.credential,
    );
    assert(
      [...google.adminEmails].some(
        (a) => normalizeEmail(a, google.aliases) === email,
      ),
      "This Google account is not on the instructor list.",
      403,
    );
    if (req.session) await store.revoke(req.session.token);
    const s = await store.session("admin");
    setCookie(res, s.token);
    res.json({ role: "admin", csrf: s.csrf });
  });
  app.post("/api/logout", async (req, res) => {
    assert(
      !req.session || req.headers["x-csrf-token"] === req.session.csrf,
      "Session check failed.",
      403,
    );
    if (req.session) await store.revoke(req.session.token);
    res.clearCookie("cquiz_session", { path: "/", secure, sameSite: "strict" });
    res.json({ ok: true });
  });
  app.get("/api/me", (req, res) =>
    res.json({
      transport: serverless ? "poll" : "sse",
      ...(req.session
        ? {
            role: req.session.role,
            csrf: req.session.csrf,
            examId: req.session.exam_id,
          }
        : { role: null }),
    }),
  );
  app.use("/api/admin", admin);
  let catalogCache = null,
    catalogPending = null;
  app.get("/api/admin/models", async (req, res) => {
    if (!catalogCache || catalogCache.at < Date.now() - 300000) {
      if (!catalogPending)
        catalogPending = (async () => {
          const response = await fetch("https://openrouter.ai/api/v1/models", {
            signal: AbortSignal.timeout(8000),
          });
          assert(
            response.ok,
            "Model catalog is unavailable. You can enter a model ID directly.",
            502,
          );
          const body = await response.json();
          const models = (body.data ?? [])
            .filter(
              (m) =>
                m.supported_parameters?.includes("structured_outputs") &&
                !m.id.includes(":batch") &&
                m.architecture?.output_modalities?.includes("text"),
            )
            .map((m) => ({ id: m.id, name: m.name }))
            .sort((a, b) => a.name.localeCompare(b.name));
          catalogCache = { at: Date.now(), models };
        })().finally(() => {
          catalogPending = null;
        });
      try {
        await catalogPending;
      } catch {
        throw new AppError(
          "Model catalog is unavailable. Enter a model ID directly or retry later.",
          502,
        );
      }
    }
    res.json({ models: catalogCache.models });
  });
  app.get("/api/admin/state", async (req, res) => {
    const exams = (await store.list()).map((e) => ({
      id: e.id,
      name: e.name,
      status: e.status,
      phase: e.phase,
      mode: e.mode,
      round: e.round,
      participants: e.roster.filter((s) => s.joined).length,
      createdAt: e.createdAt,
    }));
    res.json({
      provider: await publicProvider(),
      bank: await store.config("bank", []),
      roster: await store.config("roster", []),
      exams,
    });
  });
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 2 * 1024 * 1024, files: 1, fields: 0 },
  });
  app.post(
    "/api/admin/import/:kind",
    upload.single("file"),
    async (req, res) => {
      assert(
        ["bank", "roster"].includes(req.params.kind),
        "Unknown import type.",
      );
      assert(req.file, "Choose a file.");
      const rows = await parseUpload(req.file.buffer, req.file.originalname),
        data =
          req.params.kind === "bank"
            ? validateBank(rows)
            : validateRoster(rows);
      await store.setConfig(req.params.kind, data);
      res.json({ count: data.length, data });
    },
  );
  app.get("/api/admin/template/:kind", async (req, res) => {
    assert(["bank", "roster"].includes(req.params.kind), "Unknown template.");
    const format = req.query.format === "xlsx" ? "xlsx" : "csv";
    res
      .set({
        "Content-Disposition": `attachment; filename="cquiz-${req.params.kind}.${format}"`,
        "Content-Type":
          format === "xlsx"
            ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            : "text/csv; charset=utf-8",
      })
      .send(await template(req.params.kind, format));
  });
  app.post("/api/admin/provider", async (req, res) => {
    assert(
      !(await store.list()).some(
        (e) => e.mode === "live" && e.status === "running",
      ),
      "Provider settings are locked during a live exam.",
      409,
    );
    const { model, key, zdr } = req.body;
    assert(
      typeof model === "string" && /^[\w./:-]{3,160}$/.test(model),
      "Enter a valid OpenRouter model ID.",
    );
    assert(typeof zdr === "boolean", "Choose the privacy routing setting.");
    const p = await store.config("provider", {});
    if (key) {
      assert(
        typeof key === "string" && key.length >= 10 && key.length <= 500,
        "Enter a valid API key.",
      );
      p.encryptedKey = encrypt(key.trim());
    }
    p.model = model;
    p.zdr = zdr;
    p.testedAt = null;
    await store.setConfig("provider", p);
    res.json(await publicProvider());
  });
  app.post("/api/admin/provider/test", async (req, res) => {
    await throttle("provider-test", 5);
    const before = await store.config("provider", {});
    const q = {
      id: "preflight",
      topic: "Connection check",
      prompt: "What is two plus two?",
      insights: [
        {
          id: "sum",
          text: "The answer is four.",
          weight: 1,
          guidance: "Accept 4 or four.",
          source: "Arithmetic connection probe",
        },
      ],
    };
    const config = await providerConfig(),
      result = await (options.evaluator ?? evaluate)(config, q, "Four.", []);
    assert(
      result.correctness >= 0.5 &&
        result.insights.some((i) => i.id === "sum" && i.credit > 0.5),
      "Model connected but did not pass the evaluation probe.",
      502,
    );
    assert(
      providerFingerprint(await providerConfig()) ===
        providerFingerprint(config),
      "Connection settings changed during the test. Test the saved settings again.",
      409,
    );
    const p = structuredClone(before);
    p.testedAt = Date.now();
    p.testedFingerprint = providerFingerprint(config);
    p.model = config.model;
    assert(
      await store.compareSetConfig("provider", before, p),
      "Connection settings changed during the test. Test the saved settings again.",
      409,
    );
    res.json({ ok: true, provider: await publicProvider() });
  });
  app.post("/api/admin/exams", async (req, res) => {
    const { name, mode, settings } = req.body;
    assert(
      typeof name === "string" && name.trim().length >= 2 && name.length <= 100,
      "Give the exam a name, 2–100 characters.",
    );
    const e = engine.createExam(
      name.trim(),
      mode,
      await store.config("bank", []),
      await store.config("roster", []),
      settings ?? engine.defaultSettings,
    );
    await store.create(e);
    res.status(201).json({ id: e.id });
  });
  app.get("/api/admin/exams/:id", async (req, res) => {
    if (serverless) await advanceClock(req.params.id);
    const e = await store.get(req.params.id),
      online = await store.online(e.id);
    res.json({
      ...e,
      online: [...online],
      provider: await publicProvider(),
      pendingRatings: e.responses.reduce(
        (sum, r) =>
          sum +
          (r.rateable
            ? r.expectedRaters.filter(
                (id) =>
                  !e.ratings.some(
                    (p) => p.responseId === r.id && p.raterId === id,
                  ),
              ).length
            : 0),
        0,
      ),
      pendingDiagnostics: e.groups.reduce(
        (sum, gs) =>
          sum +
          gs.reduce(
            (n, g) =>
              n +
              g.members.reduce(
                (m, id) =>
                  m +
                  g.members.filter(
                    (t) =>
                      t !== id &&
                      !e.diagnostics.some(
                        (d) =>
                          d.round === g.round &&
                          d.raterId === id &&
                          d.targetId === t,
                      ),
                  ).length,
                0,
              ),
            0,
          ),
        0,
      ),
    });
  });
  app.post("/api/admin/exams/:id/action", async (req, res) => {
    if (serverless) await advanceClock(req.params.id);
    const id = req.params.id,
      { action, studentId, tableId, responseId } = req.body,
      now = Date.now(),
      online = await store.online(id);
    if (action === "release") {
      const e = await store.get(id);
      assert(
        e.roster.some((s) => s.id === studentId),
        "Student not found.",
      );
      await store.release(id, studentId);
      notify(id);
      return res.json({ ok: true });
    }
    const currentProvider = action === "start" ? await providerConfig() : null;
    const e = await update(id, action, (e) => {
      if (action === "start") {
        if (e.mode === "live") {
          const p = currentProvider;
          assert(
            p.key && p.model && p.testedAt && now - p.testedAt < 3600000,
            "Test the OpenRouter connection within the last hour before starting a live exam.",
            409,
          );
          assert(
            origin.startsWith("https://") && secure,
            "Live phone exams require PUBLIC_ORIGIN=https://… and secure cookies.",
            409,
          );
          e.providerSnapshot = {
            model: p.model,
            zdr: p.zdr,
            testedAt: p.testedAt,
            fingerprint: providerFingerprint(p),
          };
        }
        engine.startExam(e, now, online);
      } else if (action === "pause") engine.pause(e, now);
      else if (action === "resume") engine.resume(e, now);
      else if (action === "next") {
        assert(!e.paused, "Resume before advancing.", 409);
        if (e.phase === "round") engine.endRound(e, now);
        else engine.nextRound(e, now, online);
      } else if (action === "extend") {
        assert(e.status === "running", "Exam must be running.", 409);
        if (e.paused) e.remaining += 60000;
        else e.deadline += 60000;
      } else if (action === "stop") {
        assert(e.status === "running", "Exam is not running.", 409);
        if (e.phase === "round") engine.endRound(e, now);
        e.status = "completed";
        e.phase = "completed";
        e.deadline = null;
        e.paused = false;
        e.completedAt = now;
      } else if (action === "skip") {
        const t = e.tables.find((t) => t.id === tableId);
        assert(t, "Table not found.");
        assert(e.phase === "round" && !e.paused, "Round is not active.", 409);
        const r = e.responses.find((r) => r.id === t.currentResponseId);
        if (r?.evaluation.status === "recording") {
          if (r.text.trim()) {
            r.submittedAt = now;
            r.autoSubmitted = true;
            r.evaluation = { status: "pending", attempts: 0 };
          } else {
            r.rateable = false;
            r.evaluation.status = "cancelled";
          }
        }
        for (const i of e.invitations)
          if (i.id === t.invitationId) {
            i.closed = true;
            i.cancelled = true;
          }
        t.phase = r?.evaluation.status === "pending" ? "rating" : "waiting";
        t.speakerId = null;
        t.invitationId = null;
      } else if (action === "retry") {
        const r = e.responses.find((r) => r.id === responseId);
        assert(
          r && ["error", "pending"].includes(r.evaluation.status),
          "This answer does not need a retry.",
        );
        r.evaluation.status = "pending";
        delete r.evaluation.error;
      } else throw new AppError("Unknown exam action.");
      recalculate(e);
      return { action, ...snapshot(e) };
    });
    await scheduleJobs();
    res.json({ ok: true, revision: e.revision });
  });
  app.get("/api/admin/exams/:id/export", async (req, res) => {
    if (serverless) await advanceClock(req.params.id);
    const e = await store.get(req.params.id);
    const unresolved = e.responses.filter((r) =>
      ["error", "pending", "grading", "recording"].includes(
        r.evaluation.status,
      ),
    ).length;
    const missingPeer = e.responses.some(
      (r) =>
        r.rateable &&
        r.expectedRaters.some(
          (id) =>
            !e.ratings.some((p) => p.responseId === r.id && p.raterId === id),
        ),
    );
    const resultStatus =
      e.mode === "rehearsal"
        ? "REHEARSAL"
        : e.status !== "completed" ||
            unresolved ||
            missingPeer ||
            !e.rankingMeta.converged
          ? "PROVISIONAL"
          : "ASSESSED";
    if (req.query.format === "csv") {
      const roster = new Map(e.roster.map((s) => [s.id, s]));
      const rows = e.ranking.map((r) => ({
        rank: r.rank,
        name: r.name,
        school_email: roster.get(r.id).email,
        student_id: r.id,
        composite: r.score.toFixed(4),
        insight_points: r.points.toFixed(4),
        ai_mastery: r.ai.toFixed(4),
        peer_competence: r.peer.toFixed(4),
        willingness: r.willingness.toFixed(4),
        eligible_invitations: r.eligible,
        volunteered: r.volunteered,
        assessed_answers: r.answers,
        evidence: r.evidence,
        transcription_flags: r.flags,
        result_status: resultStatus,
      }));
      res
        .set({
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": 'attachment; filename="cquiz-results.csv"',
        })
        .send(toCSV(rows));
    } else
      res
        .set({
          "Content-Type": "application/json",
          "Content-Disposition": 'attachment; filename="cquiz-evidence.json"',
        })
        .send(
          JSON.stringify(
            {
              schemaVersion: 1,
              exportedAt: new Date().toISOString(),
              resultStatus,
              exam: e,
              audit: await store.audit(e.id),
            },
            null,
            2,
          ),
        );
  });
  async function joinAs(req, res, e, person) {
    const examId = e.id;
    if (
      req.session?.role === "student" &&
      req.session.exam_id === examId &&
      req.session.student_id === person.id
    )
      return res.json({ role: "student", csrf: req.session.csrf, examId });
    assert(
      e.status === "lobby" || person.active,
      "You were not in the exam when it started. Ask the instructor.",
      409,
    );
    const s = await store.session("student", examId, person.id);
    setCookie(res, s.token);
    await update(examId, "joined", (e) => {
      e.roster.find((s) => s.id === person.id).joined = true;
      return { studentId: person.id };
    });
    res.json({ role: "student", csrf: s.csrf, examId });
  }
  async function openExam(examId) {
    const e = await store.get(examId);
    assert(
      e.status === "lobby" || e.status === "running",
      "This exam is no longer accepting connections.",
      409,
    );
    return e;
  }
  app.post("/api/student/join", async (req, res) => {
    await throttle(`join:${clientIP(req)}`, 500);
    const { examId, email, studentId } = req.body;
    assert(
      typeof email === "string" &&
        typeof studentId === "string" &&
        email.length <= 254 &&
        studentId.length <= 40,
      "Enter your school email and student ID.",
    );
    await throttle(`join-person:${hash(email.trim().toLowerCase())}`, 12);
    const e = await openExam(examId);
    // With Google sign-in configured, live exams require a verified Google
    // account. Rehearsals keep email + ID so fictional students can join.
    assert(
      !google.enabled || e.mode === "rehearsal",
      "Sign in with your school Google account to join this exam.",
      403,
    );
    const person = e.roster.find(
      (s) =>
        s.email === email.trim().toLowerCase() && s.id === studentId.trim(),
    );
    assert(person, "Email and student ID do not match the roster.", 401);
    await joinAs(req, res, e, person);
  });
  app.post("/api/student/google", async (req, res) => {
    await throttle(`join:${clientIP(req)}`, 500);
    const email = await verifiedGoogleEmail(
      google,
      verifyGoogle,
      req.body.credential,
    );
    await throttle(`join-person:${hash(email)}`, 12);
    const e = await openExam(req.body.examId);
    const person = e.roster.find(
      (s) => normalizeEmail(s.email, google.aliases) === email,
    );
    assert(
      person,
      "This Google account is not on the roster for this exam. Ask your instructor.",
      401,
    );
    await joinAs(req, res, e, person);
  });
  app.use("/api/student", student);
  function studentView(e, id) {
    const person = e.roster.find((s) => s.id === id),
      table = engine.findTable(e, id),
      q = e.bank.find((q) => q.id === table?.questionId);
    const pending = engine.missingRatings(e, id);
    const own = e.responses
      .filter((r) => r.studentId === id)
      .map((r) => ({
        id: r.id,
        text: r.text,
        flagged: r.flagged,
        submitted: !!r.submittedAt,
      }));
    const current = e.responses.find((r) => r.id === table?.currentResponseId);
    const diagnosticTasks = e.groups.flatMap((groups, index) => {
      const round = index + 1;
      if (
        round === e.round &&
        e.phase !== "transition" &&
        e.status !== "completed"
      )
        return [];
      const group = groups.find((g) => g.members.includes(id));
      return group
        ? group.members
            .filter(
              (target) =>
                target !== id &&
                !e.diagnostics.some(
                  (d) =>
                    d.round === round &&
                    d.raterId === id &&
                    d.targetId === target,
                ),
            )
            .map((target) => ({ target, round }))
        : [];
    });
    const next = e.nextGroups?.find((g) => g.members.includes(id));
    const invitation = e.invitations.find((i) => i.id === table?.invitationId);
    const publicId = (id) =>
      e.roster.find((s) => s.id === id).participantId ?? hash(`${e.id}:${id}`);
    const people = (ids) =>
      ids.map((id) => ({
        id: publicId(id),
        name: e.roster.find((s) => s.id === id).name,
      }));
    return {
      id: e.id,
      name: e.name,
      mode: e.mode,
      status: e.status,
      phase: e.phase,
      paused: e.paused,
      round: e.round,
      deadline: e.deadline,
      remaining: e.remaining,
      serverTime: Date.now(),
      revision: e.revision,
      person: {
        id: publicId(person.id),
        name: person.name,
        preflight: person.preflight,
      },
      table: table
        ? {
            id: table.id,
            number: table.number,
            phase: table.phase,
            members: people(table.members),
            speaker: table.speakerId ? people([table.speakerId])[0] : null,
          }
        : null,
      question: q ? { id: q.id, prompt: q.prompt, topic: q.topic } : null,
      invitation:
        invitation && !invitation.closed
          ? {
              id: invitation.id,
              closesAt: invitation.closesAt,
              eligible:
                invitation.eligible.includes(id) && pending.length === 0,
              volunteered: invitation.volunteers.includes(id),
            }
          : null,
      ratings: pending.map((r) => ({
        responseId: r.id,
        speaker: people([r.studentId])[0],
        speaking: r.evaluation.status === "recording",
      })),
      ownResponses: own,
      currentOwn:
        current?.studentId === id
          ? {
              id: current.id,
              text: current.text,
              submitted: !!current.submittedAt,
              draftVersion: current.draftVersion ?? 0,
            }
          : null,
      nextTable: next
        ? { number: next.number, members: people(next.members) }
        : null,
      diagnostics: diagnosticTasks.map((task) => ({
        ...people([task.target])[0],
        round: task.round,
      })),
    };
  }
  app.get("/api/student/state", async (req, res) =>
    res.json(
      studentView(await store.get(req.session.exam_id), req.session.student_id),
    ),
  );
  async function studentMutation(req, res, type, fn) {
    const id = req.session.exam_id,
      who = req.session.student_id;
    const online = serverless ? await store.online(id) : null;
    const e = await update(id, type, (e) => {
      if (serverless) engine.tick(e, Date.now(), online);
      const value = fn(e, who);
      return {
        studentId: who,
        ...value,
        ...(type === "transcript-draft" ? {} : snapshot(e)),
      };
    });
    await scheduleJobs();
    res.json(studentView(e, who));
  }
  app.post(
    "/api/student/preflight",
    async (req, res) =>
      await studentMutation(req, res, "preflight", (e, id) => {
        assert(
          req.body.passed === true,
          "Complete the microphone check first.",
        );
        assert(
          e.status === "lobby" || e.roster.find((s) => s.id === id).active,
          "You are not an active participant.",
        );
        e.roster.find((s) => s.id === id).preflight = true;
        return {};
      }),
  );
  app.post(
    "/api/student/volunteer",
    async (req, res) =>
      await studentMutation(req, res, "volunteered", (e, id) => ({
        invitationId: engine.volunteer(e, id, Date.now()).id,
      })),
  );
  app.post(
    "/api/student/draft",
    async (req, res) =>
      await studentMutation(req, res, "transcript-draft", (e, id) => {
        const t = engine.findTable(e, id);
        assert(
          e.phase === "round" && t?.speakerId === id && t.phase === "speaking",
          "The speaking turn has ended.",
          409,
        );
        const r = e.responses.find((r) => r.id === t.currentResponseId);
        assert(
          req.body.responseId === r.id,
          "This transcript belongs to an earlier turn.",
          409,
        );
        assert(
          Number.isSafeInteger(req.body.version) &&
            req.body.version > 0 &&
            req.body.version <= 1000000,
          "Transcript version required.",
        );
        assert(
          typeof req.body.text === "string" && req.body.text.length <= 8000,
          "Transcript too long.",
        );
        if (req.body.version <= (r.draftVersion ?? 0))
          return { responseId: r.id, stale: true };
        r.text = req.body.text;
        r.draftVersion = req.body.version;
        return { responseId: r.id };
      }),
  );
  app.post(
    "/api/student/finish",
    async (req, res) =>
      await studentMutation(req, res, "contribution", (e, id) => {
        assert(
          typeof req.body.requestId === "string" &&
            /^[\w-]{8,80}$/.test(req.body.requestId),
          "Submission ID required.",
        );
        const existing = e.responses.find(
          (r) => r.requestId === req.body.requestId && r.studentId === id,
        );
        assert(
          existing ||
            req.body.responseId === engine.findTable(e, id)?.currentResponseId,
          "This submission belongs to an earlier turn.",
          409,
        );
        return {
          responseId: engine.prepareResponse(
            e,
            id,
            req.body.text,
            req.body.requestId,
            Date.now(),
          ).id,
        };
      }),
  );
  app.post(
    "/api/student/rate",
    async (req, res) =>
      await studentMutation(req, res, "peer-rating", (e, id) => ({
        ratingId: engine.rate(
          e,
          id,
          req.body.responseId,
          req.body.values,
          Date.now(),
        ).id,
      })),
  );
  app.post(
    "/api/student/flag",
    async (req, res) =>
      await studentMutation(req, res, "transcription-flag", (e, id) => {
        assert(
          !req.body.reason || typeof req.body.reason === "string",
          "Flag reason must be text.",
        );
        engine.flagResponse(
          e,
          id,
          req.body.responseId,
          req.body.reason,
          Date.now(),
        );
        return { responseId: req.body.responseId };
      }),
  );
  app.post(
    "/api/student/diagnostics",
    async (req, res) =>
      await studentMutation(req, res, "presentation-rating", (e, id) => {
        const target = e.roster.find(
          (s) =>
            (s.participantId ?? hash(`${e.id}:${s.id}`)) === req.body.targetId,
        );
        assert(target, "Tablemate not found.", 404);
        return {
          diagnosticId: engine.diagnostic(
            e,
            id,
            target.id,
            req.body.values,
            Date.now(),
            req.body.round ?? e.round,
          ).id,
        };
      }),
  );
  app.get("/api/events", (req, res) => {
    assert(req.session, "Sign in first.", 401);
    if (serverless) return res.status(204).end();
    res.set({
      "Content-Type": "text/event-stream",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();
    res.write("event: ready\ndata: {}\n\n");
    const c = {
      res,
      role: req.session.role,
      examId: req.session.exam_id,
      token: req.session.token,
    };
    clients.add(c);
    const heartbeat = setInterval(async () => {
      const valid = await store.validSessionHash(c.token);
      if (!valid) {
        res.end();
        return;
      }
      res.write(": heartbeat\n\n");
    }, 15000);
    req.on("close", () => {
      clearInterval(heartbeat);
      clients.delete(c);
    });
  });
  const dist = resolve("dist");
  if (existsSync(dist)) app.use(express.static(dist, { index: false }));
  app.get("/{*path}", (req, res) => {
    if (req.path.startsWith("/api/"))
      return res.status(404).json({ error: "Endpoint not found." });
    if (existsSync(join(dist, "index.html")))
      res.sendFile(join(dist, "index.html"));
    else res.status(503).send("Build cquiz with npm run build, then refresh.");
  });
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status =
      error instanceof AppError
        ? error.status
        : error instanceof multer.MulterError
          ? 400
          : 500;
    res.status(status).json({
      error:
        status === 500
          ? "The server could not complete this action. Your accepted exam data is preserved."
          : error.message,
    });
  });
  async function runJob(examId, responseId) {
    const key = `${examId}:${responseId}`;
    if (jobs.has(key)) return;
    jobs.add(key);
    workers++;
    const lease = randomBytes(16).toString("hex");
    try {
      const e = await update(examId, "evaluation-start", (e) => {
        const r = e.responses.find((r) => r.id === responseId);
        if (
          r.evaluation.status !== "pending" &&
          !(
            r.evaluation.status === "grading" &&
            (r.evaluation.leaseUntil ?? 0) < Date.now()
          )
        )
          return false;
        r.evaluation.status = "grading";
        r.evaluation.attempts++;
        r.evaluation.lease = lease;
        r.evaluation.leaseUntil = Date.now() + 90000;
        return { responseId };
      });
      if (!e) return;
      const r = e.responses.find((r) => r.id === responseId),
        q = e.bank.find((q) => q.id === r.questionId),
        previous = e.responses.filter(
          (p) =>
            p.tableId === r.tableId &&
            p.questionId === r.questionId &&
            p.id !== r.id &&
            p.evaluation.status === "done",
        );
      const config = e.mode === "live" ? await providerConfig() : null;
      if (config && e.providerSnapshot?.fingerprint)
        assert(
          providerFingerprint(config) === e.providerSnapshot.fingerprint,
          "The AI configuration changed after this exam started. Restore the verified configuration before retrying.",
          409,
        );
      const result =
        e.mode === "rehearsal"
          ? rehearsalEvaluate(q, r.text)
          : await (options.evaluator ?? evaluate)(
              { ...config, ...e.providerSnapshot },
              q,
              r.text,
              previous,
            );
      await update(examId, "evaluated", (e) => {
        const r = e.responses.find((r) => r.id === responseId);
        if (r.evaluation.lease !== lease || r.evaluation.status !== "grading")
          return false;
        engine.applyEvaluation(e, responseId, result, Date.now());
        return { responseId, ...snapshot(e) };
      });
    } catch (error) {
      await update(examId, "evaluation-error", (e) => {
        const r = e.responses.find((r) => r.id === responseId);
        if (r.evaluation.lease !== lease || r.evaluation.status !== "grading")
          return false;
        r.evaluation.status = "error";
        r.evaluation.error =
          error instanceof AppError
            ? error.message
            : "Evaluation failed. Answer is saved; retry it.";
        return { responseId };
      });
    } finally {
      jobs.delete(key);
      workers--;
      if (!serverless && !stopping)
        queueMicrotask(() => {
          void scheduleJobs().catch(() => {});
        });
    }
  }
  async function scheduleJobs() {
    if (stopping) return;
    const pending = await store.pendingJobs(Math.max(0, 8 - workers));
    for (const job of pending)
      if (!jobs.has(`${job.examId}:${job.responseId}`) && workers < 8) {
        const task = runJob(job.examId, job.responseId);
        if (serverless && options.background) options.background(task);
        else void task.catch(() => {});
      }
  }
  async function advanceClock(id) {
    if (await store.claimTick(id)) {
      const online = await store.online(id);
      await update(id, "exam-clock", (e) =>
        engine.tick(e, Date.now(), online) ? snapshot(e) : false,
      );
    }
    await scheduleJobs();
  }
  const ready = (async () => {
    if (serverless) return;
    // Pause recovered live clocks so an operator can inspect the preserved turn before resuming.
    for (const e of await store.list())
      if (e.status === "running" && !e.paused)
        await update(e.id, "clock-recovery", (e) => {
          engine.pause(e, Date.now());
          return { recovered: true };
        });
    // Recover interrupted jobs; keep all previously accepted answers.
    for (const e of await store.list())
      if (e.responses.some((r) => r.evaluation.status === "grading"))
        await update(e.id, "restart-recovery", (e) => {
          for (const r of e.responses)
            if (r.evaluation.status === "grading")
              r.evaluation.status = "pending";
          return {};
        });
  })();
  await ready;
  if (options.timers !== false && !serverless) {
    let ticking = false;
    timer = setInterval(async () => {
      if (ticking || stopping) return;
      ticking = true;
      try {
        for (const e of await store.list())
          if (e.status === "running" && !e.paused) {
            const online = await store.online(e.id);
            await update(e.id, "exam-clock", (e) =>
              engine.tick(e, Date.now(), online) ? snapshot(e) : false,
            );
          }
        await scheduleJobs();
      } catch {
        console.error(
          "Exam processing could not reach storage. Accepted data remains persistent.",
        );
      } finally {
        ticking = false;
      }
    }, 500);
    timer.unref();
    await scheduleJobs();
  }
  function stopAccepting() {
    stopping = true;
    clearInterval(timer);
    for (const timeout of notificationTimers.values()) clearTimeout(timeout);
    notificationTimers.clear();
    for (const c of clients) c.res.end();
  }
  return {
    app,
    store,
    providerConfig,
    update,
    scheduleJobs,
    stopAccepting,
    async drain() {
      stopAccepting();
      const start = Date.now();
      while (workers && Date.now() - start < 65000)
        await new Promise((r) => setTimeout(r, 100));
    },
    async close() {
      stopAccepting();
      await store.close();
    },
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const persistent = process.env.DATABASE_URL
    ? await (
        await import("./postgres-store.mjs")
      ).PostgresStore.connect(process.env.DATABASE_URL)
    : null;
  const service = await createApp(persistent ? { store: persistent } : {});
  const port = Number(process.env.PORT || 4318),
    host = process.env.HOST || "127.0.0.1";
  const server = service.app.listen(port, host, () =>
    console.log(
      `cquiz is running at ${process.env.PUBLIC_ORIGIN || `http://localhost:${port}`}`,
    ),
  );
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    service.stopAccepting();
    const closed = new Promise((resolve) => server.close(resolve));
    await service.drain();
    await closed;
    await service.close();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
