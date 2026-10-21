import { createRemoteJWKSet, jwtVerify } from "jose";
import { AppError } from "./imports.mjs";

// Google sign-in support. Google Identity Services gives the browser a signed
// ID token; the server checks Google's signature, audience, issuer, expiry and
// verified email before trusting the address it contains.

const ISSUERS = ["accounts.google.com", "https://accounts.google.com"];
const list = (value) =>
  (value ?? "")
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);

export function googleConfig(options = {}, env = process.env) {
  const clientId = (
    options.googleClientId ??
    env.GOOGLE_CLIENT_ID ??
    ""
  ).trim();
  return {
    clientId,
    enabled: !!clientId,
    adminEmails: new Set(options.adminEmails ?? list(env.ADMIN_EMAILS)),
    // Optional: only accept accounts from these Google Workspace domains.
    domains: options.googleDomains ?? list(env.GOOGLE_ALLOWED_DOMAINS),
    // Optional: treat equivalent school domains as the same mailbox,
    // e.g. "g.clemson.edu=clemson.edu".
    aliases: new Map(
      (options.emailAliases ?? list(env.GOOGLE_EMAIL_ALIASES)).map((pair) =>
        pair.split("=").map((s) => s.trim()),
      ),
    ),
  };
}

export function normalizeEmail(email, aliases = new Map()) {
  const clean = String(email ?? "")
    .trim()
    .toLowerCase();
  const at = clean.lastIndexOf("@");
  if (at < 0) return clean;
  const domain = clean.slice(at + 1);
  return `${clean.slice(0, at)}@${aliases.get(domain) ?? domain}`;
}

export function createGoogleVerifier(config, options = {}) {
  if (options.verifyGoogleToken) return options.verifyGoogleToken;
  const keys =
    options.googleKeys ??
    createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
  return async (credential) => {
    const { payload } = await jwtVerify(credential, keys, {
      issuer: ISSUERS,
      audience: config.clientId,
      algorithms: ["RS256"],
      clockTolerance: 30,
    });
    return payload;
  };
}

// Returns the verified, normalized email for a Google credential or throws.
export async function verifiedGoogleEmail(config, verify, credential) {
  if (!config.enabled)
    throw new AppError("Google sign-in is not configured.", 404);
  if (typeof credential !== "string" || credential.length > 4096)
    throw new AppError("Google sign-in failed. Try again.", 400);
  let payload;
  try {
    payload = await verify(credential);
  } catch {
    throw new AppError("Google sign-in could not be verified. Try again.", 401);
  }
  if (payload.email_verified !== true || typeof payload.email !== "string")
    throw new AppError("Your Google account email is not verified.", 401);
  if (
    config.domains.length &&
    !config.domains.includes(String(payload.hd ?? "").toLowerCase())
  )
    throw new AppError("Sign in with your school Google account.", 403);
  return normalizeEmail(payload.email, config.aliases);
}
