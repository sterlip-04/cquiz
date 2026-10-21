import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT } from "jose";
import { createApp } from "../server/index.mjs";
import { normalizeEmail } from "../server/google.mjs";
import { bank, roster } from "./fixtures.mjs";

const origin = "https://exam.test";
const clientId = "test-client.apps.googleusercontent.com";
const { publicKey, privateKey } = await generateKeyPair("RS256");
const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256" };
const googleKeys = createLocalJWKSet({ keys: [jwk] });
const other = await generateKeyPair("RS256");

async function token(claims = {}, opts = {}) {
  return new SignJWT({ email_verified: true, ...claims })
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuer(opts.iss ?? "https://accounts.google.com")
    .setAudience(opts.aud ?? clientId)
    .setSubject("123")
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? "5m")
    .sign(opts.key ?? privateKey);
}
function client(base) {
  let cookie = "",
    csrf = "";
  return {
    async call(path, body) {
      const res = await fetch(base + path, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          Origin: origin,
          ...(cookie ? { Cookie: cookie } : {}),
          ...(body !== undefined
            ? { "X-CSRF-Token": csrf, "Content-Type": "application/json" }
            : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const set = res.headers.get("set-cookie");
      if (set) cookie = set.split(";")[0];
      const data = await res.json();
      if (data.csrf) csrf = data.csrf;
      return { status: res.status, data, headers: res.headers };
    },
  };
}
async function running(options = {}) {
  const service = await createApp({
    dataDir: ":memory:",
    password: "test-password-long-enough",
    origin,
    secure: true,
    timers: false,
    googleClientId: clientId,
    googleKeys,
    adminEmails: ["teacher@example.edu"],
    ...options,
  });
  const server = service.app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  return {
    service,
    base: `http://127.0.0.1:${server.address().port}`,
    async close() {
      await new Promise((r) => server.close(r));
      await service.close();
    },
  };
}
async function withExam(run, mode) {
  run.service.store.setConfig("bank", bank());
  run.service.store.setConfig("roster", roster());
  const admin = client(run.base);
  await admin.call("/api/admin/login", {
    password: "test-password-long-enough",
  });
  const created = await admin.call("/api/admin/exams", { name: "Exam", mode });
  assert.equal(created.status, 201);
  return created.data.id;
}

test("email normalization applies school domain aliases", () => {
  const aliases = new Map([["g.clemson.edu", "clemson.edu"]]);
  assert.equal(
    normalizeEmail(" Pat@G.Clemson.edu ", aliases),
    "pat@clemson.edu",
  );
  assert.equal(normalizeEmail("pat@clemson.edu", aliases), "pat@clemson.edu");
});

test("auth config and security headers reflect Google sign-in", async () => {
  const off = await running({ googleClientId: "" });
  const on = await running();
  try {
    const a = await client(off.base).call("/api/auth/config");
    assert.deepEqual(a.data, { googleClientId: null, googleAdmin: false });
    assert.equal(a.headers.get("referrer-policy"), "no-referrer");
    assert.ok(!a.headers.get("content-security-policy").includes("google"));
    const b = await client(on.base).call("/api/auth/config");
    assert.deepEqual(b.data, { googleClientId: clientId, googleAdmin: true });
    assert.match(
      b.headers.get("content-security-policy"),
      /script-src 'self' https:\/\/accounts\.google\.com\/gsi\/client/,
    );
    assert.equal(
      (await client(off.base).call("/api/admin/google", { credential: "x" }))
        .status,
      404,
    );
  } finally {
    await off.close();
    await on.close();
  }
});

test("instructors sign in with Google only when on the instructor list", async () => {
  const run = await running();
  try {
    const ok = client(run.base);
    const r = await ok.call("/api/admin/google", {
      credential: await token({ email: "Teacher@example.edu" }),
    });
    assert.equal(r.status, 200);
    assert.equal(r.data.role, "admin");
    assert.equal((await ok.call("/api/admin/state")).status, 200);
    assert.equal(
      (
        await client(run.base).call("/api/admin/google", {
          credential: await token({ email: "student01@example.edu" }),
        })
      ).status,
      403,
    );
    // Password login still works alongside Google.
    assert.equal(
      (
        await client(run.base).call("/api/admin/login", {
          password: "test-password-long-enough",
        })
      ).status,
      200,
    );
  } finally {
    await run.close();
  }
});

test("Google tokens are rejected when forged, expired, unverified or for another app", async () => {
  const run = await running();
  try {
    const bad = [
      await token({ email: "teacher@example.edu" }, { key: other.privateKey }),
      await token({ email: "teacher@example.edu" }, { aud: "someone-else" }),
      await token(
        { email: "teacher@example.edu" },
        { iss: "https://evil.test" },
      ),
      await token(
        { email: "teacher@example.edu" },
        { exp: Math.floor(Date.now() / 1000) - 600 },
      ),
      "not-a-token",
    ];
    for (const credential of bad)
      assert.equal(
        (await client(run.base).call("/api/admin/google", { credential }))
          .status,
        401,
      );
    assert.equal(
      (
        await client(run.base).call("/api/admin/google", {
          credential: await token({
            email: "teacher@example.edu",
            email_verified: false,
          }),
        })
      ).status,
      401,
    );
  } finally {
    await run.close();
  }
});

test("live exams require Google for students; rehearsals keep email + ID", async () => {
  const run = await running();
  try {
    const live = await withExam(run, "live");
    const s = roster()[0];
    const byId = await client(run.base).call("/api/student/join", {
      examId: live,
      email: s.email,
      studentId: s.id,
    });
    assert.equal(byId.status, 403);
    const stranger = await client(run.base).call("/api/student/google", {
      examId: live,
      credential: await token({ email: "stranger@example.edu" }),
    });
    assert.equal(stranger.status, 401);
    const alice = client(run.base);
    const joined = await alice.call("/api/student/google", {
      examId: live,
      credential: await token({ email: s.email.toUpperCase() }),
    });
    assert.equal(joined.status, 200);
    assert.equal(joined.data.role, "student");
    const me = await alice.call("/api/me");
    assert.equal(me.data.role, "student");
    assert.equal(me.data.examId, live);

    const rehearsal = await withExam(run, "rehearsal");
    assert.equal(
      (
        await client(run.base).call("/api/student/join", {
          examId: rehearsal,
          email: roster()[1].email,
          studentId: roster()[1].id,
        })
      ).status,
      200,
    );
  } finally {
    await run.close();
  }
});

test("domain restrictions and aliases match school accounts to the roster", async () => {
  const run = await running({
    googleDomains: ["g.example.edu"],
    emailAliases: ["g.example.edu=example.edu"],
  });
  try {
    const live = await withExam(run, "live");
    const outside = await client(run.base).call("/api/student/google", {
      examId: live,
      credential: await token({ email: "student01@gmail.com" }),
    });
    assert.equal(outside.status, 403);
    const inside = await client(run.base).call("/api/student/google", {
      examId: live,
      credential: await token({
        email: "student01@g.example.edu",
        hd: "g.example.edu",
      }),
    });
    assert.equal(inside.status, 200);
  } finally {
    await run.close();
  }
});
