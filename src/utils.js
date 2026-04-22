import crypto from "crypto";
import { config } from "./config.js";

export function hashText(input) {
  return crypto.createHash("sha256").update(String(input || "")).digest("hex");
}

export function maskApiKey(apiKey) {
  if (!apiKey) return "";
  const trimmed = apiKey.trim();
  if (trimmed.length <= 8) return `${trimmed.slice(0, 2)}***${trimmed.slice(-2)}`;
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
}

function hashSecret(secret) {
  return crypto.createHash("sha256").update(String(secret || "")).digest();
}

function getPrimaryEncryptionSecret() {
  if (!config.appEncryptionKey) return null;
  return hashSecret(config.appEncryptionKey);
}

function getLegacyEncryptionSecret() {
  if (config.databaseUrl && config.allowLegacyCryptoFallback) return hashSecret(config.databaseUrl);
  if (config.nodeEnv !== "production" && config.allowLegacyCryptoFallback) return hashSecret("local-dev-secret");
  return null;
}

function encodeCiphertext(secret, plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", secret, iv);
  const encrypted = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

function decodeCiphertext(secret, payload) {
  const buf = Buffer.from(payload, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const encrypted = buf.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", secret, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

export function encryptText(plain) {
  const primary = getPrimaryEncryptionSecret();
  if (primary) {
    return `v2:${encodeCiphertext(primary, plain)}`;
  }

  const legacy = getLegacyEncryptionSecret();
  if (legacy) {
    return encodeCiphertext(legacy, plain);
  }

  throw new Error("APP_ENCRYPTION_KEY wajib diisi untuk membuat ciphertext baru.");
}

export function decryptText(ciphertext) {
  if (!ciphertext) return "";
  const value = String(ciphertext);

  if (value.startsWith("v2:")) {
    const primary = getPrimaryEncryptionSecret();
    if (!primary) {
      throw new Error("APP_ENCRYPTION_KEY wajib diisi untuk membaca ciphertext v2.");
    }
    return decodeCiphertext(primary, value.slice(3));
  }

  const legacy = getLegacyEncryptionSecret();
  if (legacy) {
    return decodeCiphertext(legacy, value);
  }

  const primary = getPrimaryEncryptionSecret();
  if (primary) {
    return decodeCiphertext(primary, value);
  }

  throw new Error("Ciphertext legacy tidak bisa dibaca karena secret fallback tidak tersedia.");
}

export function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function nowPlusMs(ms) {
  return new Date(Date.now() + ms);
}

export function pickDeep(input, paths = []) {
  for (const path of paths) {
    const parts = path.split(".");
    let current = input;
    let ok = true;
    for (const part of parts) {
      if (current == null || !(part in current)) {
        ok = false;
        break;
      }
      current = current[part];
    }
    if (ok && current != null) return current;
  }
  return undefined;
}

export function normalizeRemoteStatus(payload) {
  const raw =
    pickDeep(payload, [
      "status",
      "data.status",
      "task_status",
      "data.task_status",
      "task.state",
      "data.task.state",
      "state"
    ]) || "";

  return String(raw).toLowerCase();
}

export function extractTaskId(payload) {
  return (
    pickDeep(payload, [
      "task_id",
      "data.task_id",
      "id",
      "data.id",
      "task.id",
      "data.task.id"
    ]) || null
  );
}

export function extractResultUrl(payload) {
  const direct =
    pickDeep(payload, [
      "result_url",
      "data.result_url",
      "video_url",
      "data.video_url",
      "data.url",
      "url"
    ]) || null;

  if (direct) return direct;

  const assets =
    pickDeep(payload, ["data.assets", "assets", "data.result.assets", "result.assets"]) || [];

  if (Array.isArray(assets)) {
    const found = assets.find((item) => item?.url || item?.video_url || item?.download_url);
    if (found) return found.url || found.video_url || found.download_url || null;
  }

  const generated =
    pickDeep(payload, ["generated", "data.generated", "result.generated", "data.result.generated"]) || [];

  if (Array.isArray(generated)) {
    const first = generated.find((item) => typeof item === "string" || item?.url || item?.video_url || item?.download_url);
    if (typeof first === "string") return first;
    if (first) return first.url || first.video_url || first.download_url || null;
  }

  return null;
}

export function normalizeTaskStatus(remoteStatus) {
  const s = String(remoteStatus || "").toLowerCase();

  if (!s) return "PROCESSING";
  if (["queued", "submitted", "created", "pending", "new"].includes(s)) return "SUBMITTED";
  if (["running", "processing", "in_progress", "working", "progress"].includes(s)) return "PROCESSING";
  if (["completed", "succeeded", "success", "done", "finished"].includes(s)) return "COMPLETED";
  if (["failed", "error", "cancelled", "canceled", "rejected"].includes(s)) return "FAILED";
  return "PROCESSING";
}

export function keyStatusFromHttp({ statusCode, bodyText = "" }) {
  const text = String(bodyText || "").toLowerCase();

  if (statusCode === 401 || statusCode === 403) return "INVALID";
  if (statusCode === 429) return "RATE_LIMITED";
  if (statusCode === 402 || /credit|quota|insufficient|payment required|out of credits/.test(text)) {
    return "LIKELY_EXHAUSTED";
  }
  if (statusCode >= 200 && statusCode < 300) return "HEALTHY";
  return "UNKNOWN";
}

export function generateLabel(index) {
  return `FP-KEY-${String(index).padStart(3, "0")}`;
}

export function sanitizeTask(task) {
  return {
    ...task,
    requestPayload: task?.requestPayload || null,
    createResponsePayload: task?.createResponsePayload || null,
    syncResponsePayload: task?.syncResponsePayload || null,
    resultExpiresAt: task?.resultExpiresAt || null,
    resultDeletedAt: task?.resultDeletedAt || null
  };
}

export function base64UrlEncode(input) {
  return Buffer.from(input).toString("base64url");
}

export function base64UrlDecode(input) {
  return Buffer.from(input, "base64url").toString("utf8");
}

export function signSessionToken(payload, secret) {
  const body = base64UrlEncode(JSON.stringify(payload));
  const sig = crypto.createHmac("sha256", String(secret || "")).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifySessionToken(token, secret) {
  const value = String(token || "");
  const [body, sig] = value.split(".");
  if (!body || !sig) return null;
  const expected = crypto.createHmac("sha256", String(secret || "")).update(body).digest("base64url");
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length) return null;
  if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;
  const payload = safeJsonParse(base64UrlDecode(body));
  if (!payload || typeof payload !== "object") return null;
  if (payload.exp && Number(payload.exp) <= Math.floor(Date.now() / 1000)) return null;
  return payload;
}

export function parseCookies(cookieHeader) {
  const header = String(cookieHeader || "");
  if (!header) return {};

  return header.split(";").reduce((acc, part) => {
    const [rawKey, ...rawValue] = part.trim().split("=");
    if (!rawKey) return acc;
    acc[rawKey] = decodeURIComponent(rawValue.join("=") || "");
    return acc;
  }, {});
}

export function serializeCookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value ?? "")}`];
  if (options.maxAge != null) parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAge))}`);
  if (options.path) parts.push(`Path=${options.path}`);
  if (options.httpOnly) parts.push("HttpOnly");
  if (options.secure) parts.push("Secure");
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
  return parts.join("; ");
}

export function sanitizeFilename(name) {
  return String(name || "file")
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120) || "file";
}
