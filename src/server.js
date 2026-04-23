import express from "express";
import cors from "cors";
import morgan from "morgan";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";
import { handleUpload } from "@vercel/blob/client";
import { prisma } from "./db.js";
import { config } from "./config.js";
import { createMotionTask, getMotionTask } from "./freepik.js";
import { listCandidateKeys, markKeyFailure, markKeySuccess, testAllKeys, testSingleKey } from "./pool.js";
import {
  decryptText,
  encryptText,
  extractResultUrl,
  extractTaskId,
  generateLabel,
  hashText,
  keyStatusFromHttp,
  maskApiKey,
  normalizeRemoteStatus,
  normalizeTaskStatus,
  parseCookies,
  sanitizeFilename,
  sanitizeTask,
  safeJsonParse,
  serializeCookie,
  signSessionToken,
  verifySessionToken
} from "./utils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "..", "public");
const indexFile = path.join(publicDir, "index.html");

const ACTIVE_TASK_STATUSES = ["PENDING", "SUBMITTED", "PROCESSING"];
const MAINTENANCE_LOCK_ID = 73140217;
const loginAttempts = new Map();

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({
  limit: "2mb",
  verify: (req, _res, buf) => {
    req.rawBody = buf.toString("utf8");
  }
}));
app.use(morgan("tiny"));

if (!config.isVercel) {
  app.use(express.static(publicDir));
}

function normalizePublicUrl(url) {
  const value = String(url || "").trim();
  if (!value) return value;
  if (value.startsWith("http://tmpfiles.org/")) return value.replace("http://", "https://");
  return value;
}

function parseOptionalDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function isUserAccessActive(user, now = new Date()) {
  if (!user?.isEnabled) return false;
  if (user.accessStartsAt && new Date(user.accessStartsAt).getTime() > now.getTime()) return false;
  if (user.accessEndsAt && new Date(user.accessEndsAt).getTime() < now.getTime()) return false;
  return true;
}

function resultExpiryFromNow() {
  return new Date(Date.now() + config.resultUrlTtlMs);
}

function extractExpiryFromResultUrl(url) {
  const value = String(url || "");
  const match = value.match(/exp=(\d{10,})/);
  if (!match) return null;
  const timestamp = Number(match[1]);
  if (!Number.isFinite(timestamp)) return null;
  return new Date(timestamp * 1000);
}

function deriveResultInfo(task) {
  const fallbackUrl = normalizePublicUrl(
    task?.resultUrl ||
    extractResultUrl(task?.syncResponsePayload) ||
    extractResultUrl(task?.createResponsePayload)
  );
  const expiresAt = task?.resultExpiresAt || extractExpiryFromResultUrl(fallbackUrl);
  return { fallbackUrl, expiresAt };
}

function serializeKey(key) {
  if (!key) return null;
  return {
    id: key.id,
    label: key.label,
    apiKeyMasked: key.apiKeyMasked,
    isEnabled: key.isEnabled,
    status: key.status,
    lastCheckedAt: key.lastCheckedAt,
    lastSuccessAt: key.lastSuccessAt,
    lastFailureAt: key.lastFailureAt,
    failureStreak: key.failureStreak,
    successCount: key.successCount,
    cooldownUntil: key.cooldownUntil,
    notes: key.notes,
    lastError: key.lastError,
    createdAt: key.createdAt,
    updatedAt: key.updatedAt,
    activeTaskCount: key.activeTaskCount ?? 0
  };
}

function serializeUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    accessKeyMasked: user.accessKeyMasked,
    isEnabled: user.isEnabled,
    accessStartsAt: user.accessStartsAt,
    accessEndsAt: user.accessEndsAt,
    notes: user.notes,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    taskCount: user._count?.tasks ?? user.taskCount ?? 0,
    isActiveNow: isUserAccessActive(user)
  };
}

function serializeTaskForAuth(task, auth) {
  const clean = sanitizeTask(task);
  const now = Date.now();
  const derived = deriveResultInfo(clean);
  const effectiveResultUrl = derived.fallbackUrl;
  const effectiveExpiry = derived.expiresAt;
  const expired = effectiveExpiry ? new Date(effectiveExpiry).getTime() <= now : false;

  const serialized = {
    id: clean.id,
    title: clean.title,
    tier: clean.tier,
    freepikTaskId: auth?.isAdmin ? clean.freepikTaskId : null,
    status: clean.status,
    remoteStatus: clean.remoteStatus,
    imageUrl: auth?.isAdmin ? clean.imageUrl : null,
    videoUrl: auth?.isAdmin ? clean.videoUrl : null,
    prompt: auth?.isAdmin ? clean.prompt : clean.prompt,
    characterOrientation: clean.characterOrientation,
    cfgScale: clean.cfgScale,
    webhookEnabled: auth?.isAdmin ? clean.webhookEnabled : undefined,
    requestPayload: auth?.isAdmin ? clean.requestPayload : undefined,
    createResponsePayload: auth?.isAdmin ? clean.createResponsePayload : undefined,
    syncResponsePayload: auth?.isAdmin ? clean.syncResponsePayload : undefined,
    errorMessage: clean.errorMessage,
    selectedKey: auth?.isAdmin ? serializeKey(clean.selectedKey) : undefined,
    owner: auth?.isAdmin ? serializeUser(clean.owner) : undefined,
    createdAt: clean.createdAt,
    updatedAt: clean.updatedAt,
    completedAt: clean.completedAt,
    resultUrl: expired ? null : effectiveResultUrl,
    resultExpiresAt: effectiveExpiry,
    resultExpired: Boolean(clean.resultDeletedAt || expired),
    resultAvailable: Boolean(effectiveResultUrl && !expired)
  };

  return Object.fromEntries(Object.entries(serialized).filter(([, value]) => value !== undefined));
}

function resolveAppBaseUrl(req) {
  if (config.appBaseUrl) return config.appBaseUrl;

  const known = [config.vercelProductionUrl, config.vercelBranchUrl, config.vercelUrl]
    .map((value) => String(value || "").trim())
    .filter(Boolean);

  if (known.length) return `https://${known[0].replace(/^https?:\/\//, "")}`;

  const host = req?.headers?.host;
  if (!host) return "";
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const protocol = forwardedProto || (req.secure ? "https" : "http");
  return `${protocol}://${host}`;
}

function buildWebhookUrl(req) {
  const base = resolveAppBaseUrl(req);
  if (!base) return null;
  return `${base}/api/webhooks/freepik`;
}

function classifyCreateError(error) {
  const status = error?.status || 500;
  const bodyText = error?.bodyText || error?.message || "Task create failed";
  const keyStatus = keyStatusFromHttp({ statusCode: status, bodyText });
  const lowered = bodyText.toLowerCase();
  const nonRetriable =
    /invalid_params|only https urls are allowed|body\.image_url|body\.video_url|must be a valid url|required/.test(lowered);

  return { status, bodyText, keyStatus, nonRetriable };
}

function getClientIp(req) {
  const header = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return header || req.ip || req.socket?.remoteAddress || "unknown";
}

function cleanupLoginAttempts(now = Date.now()) {
  for (const [ip, record] of loginAttempts.entries()) {
    if (record.resetAt <= now) loginAttempts.delete(ip);
  }
}

function getLoginAttemptState(ip) {
  const now = Date.now();
  cleanupLoginAttempts(now);
  const record = loginAttempts.get(ip);
  if (!record || record.resetAt <= now) {
    const fresh = {
      count: 0,
      resetAt: now + config.loginRateLimitWindowMs
    };
    loginAttempts.set(ip, fresh);
    return fresh;
  }
  return record;
}

function isRateLimited(ip) {
  const record = getLoginAttemptState(ip);
  return record.count >= config.loginRateLimitMaxAttempts;
}

function noteFailedLogin(ip) {
  const record = getLoginAttemptState(ip);
  record.count += 1;
}

function resetLoginAttempts(ip) {
  loginAttempts.delete(ip);
}

function isSecureRequest(req) {
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  return req.secure || forwardedProto === "https" || config.isVercel || config.nodeEnv === "production";
}

function createSessionToken(session) {
  if (!config.sessionSecret) {
    throw new Error("SESSION_SECRET wajib diisi.");
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const payload = {
    v: 1,
    role: session.role,
    userId: session.user?.id || null,
    exp: nowSeconds + Math.max(1, Math.floor(config.sessionTtlHours * 3600))
  };

  return signSessionToken(payload, config.sessionSecret);
}

function sessionCookieOptions(req) {
  return {
    path: "/",
    httpOnly: true,
    secure: isSecureRequest(req),
    sameSite: "Lax",
    maxAge: Math.max(60, Math.floor(config.sessionTtlHours * 3600))
  };
}

function clearSessionCookieOptions(req) {
  return {
    path: "/",
    httpOnly: true,
    secure: isSecureRequest(req),
    sameSite: "Lax",
    maxAge: 0
  };
}

async function findSessionByKey(key, { touchLogin = false } = {}) {
  const value = String(key || "").trim();
  if (!value) return null;

  if ((config.adminKey && value === config.adminKey) || (config.adminPass && value === config.adminPass)) {
    return {
      role: "admin",
      isAdmin: true,
      name: "Administrator",
      user: null
    };
  }

  const accessKeyHash = hashText(value);
  const user = await prisma.panelUser.findUnique({ where: { accessKeyHash } });
  if (!user || !isUserAccessActive(user)) return null;

  if (touchLogin) {
    await prisma.panelUser.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() }
    });
  }

  return {
    role: "user",
    isAdmin: false,
    name: user.name,
    user
  };
}

async function findSessionFromCookie(req) {
  if (!config.sessionSecret) return null;
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[config.sessionCookieName];
  if (!token) return null;
  const payload = verifySessionToken(token, config.sessionSecret);
  if (!payload) return null;

  if (payload.role === "admin") {
    return {
      role: "admin",
      isAdmin: true,
      name: "Administrator",
      user: null
    };
  }

  if (!payload.userId) return null;
  const user = await prisma.panelUser.findUnique({ where: { id: payload.userId } });
  if (!user || !isUserAccessActive(user)) return null;

  return {
    role: "user",
    isAdmin: false,
    name: user.name,
    user
  };
}

async function resolveRequestAuth(req) {
  const cookieSession = await findSessionFromCookie(req);
  if (cookieSession) return cookieSession;

  const headerKey = req.headers["x-access-key"] || "";
  if (headerKey) {
    return findSessionByKey(headerKey, { touchLogin: false });
  }

  return null;
}

async function requireApiAuth(req, res, next) {
  try {
    const session = await resolveRequestAuth(req);
    if (!session) return res.status(401).json({ ok: false, error: "Invalid or expired session" });
    req.auth = session;
    next();
  } catch (error) {
    next(error);
  }
}

function requireAdmin(req, res, next) {
  if (!req.auth?.isAdmin) return res.status(403).json({ ok: false, error: "Admin access required" });
  next();
}

function taskAccessWhere(auth) {
  if (auth?.isAdmin) return {};
  return { ownerId: auth?.user?.id || "__no_user__" };
}

async function findTaskForAuth(id, auth) {
  return prisma.videoTask.findFirst({
    where: { id, ...taskAccessWhere(auth) },
    include: { selectedKey: true, owner: true }
  });
}

async function tryAcquireAdvisoryLock(lockId) {
  try {
    const numericLockId = Number(lockId);
    const rows = await prisma.$queryRawUnsafe(`SELECT pg_try_advisory_lock(${numericLockId}) AS locked`);
    return Boolean(rows?.[0]?.locked);
  } catch (error) {
    console.warn("[WARN] advisory lock unavailable, continuing without lock", error.message);
    return true;
  }
}

async function releaseAdvisoryLock(lockId) {
  try {
    const numericLockId = Number(lockId);
    await prisma.$queryRawUnsafe(`SELECT pg_advisory_unlock(${numericLockId})`);
  } catch {
    // ignore unlock errors
  }
}

async function withAdvisoryLock(lockId, fn) {
  const acquired = await tryAcquireAdvisoryLock(lockId);
  if (!acquired) return { skipped: true };
  try {
    return await fn();
  } finally {
    await releaseAdvisoryLock(lockId);
  }
}

async function syncSingleTask(task) {
  if (!task?.freepikTaskId || !task?.selectedKeyId) return task;
  const key = await prisma.apiKey.findUnique({ where: { id: task.selectedKeyId } });
  if (!key) return task;

  const apiKey = decryptText(key.apiKeyCiphertext);
  try {
    const response = await getMotionTask({ apiKey, tier: task.tier, taskId: task.freepikTaskId });
    const payload = response.data;
    const remoteStatus = normalizeRemoteStatus(payload);
    const status = normalizeTaskStatus(remoteStatus);
    const resultUrl = normalizePublicUrl(extractResultUrl(payload));
    const completedAt = status === "COMPLETED" ? (task.completedAt || new Date()) : task.completedAt;
    const resultExpiresAt = resultUrl ? resultExpiryFromNow() : task.resultExpiresAt;

    await markKeySuccess(key.id);

    return prisma.videoTask.update({
      where: { id: task.id },
      data: {
        remoteStatus: remoteStatus || task.remoteStatus,
        status,
        resultUrl: resultUrl || task.resultUrl,
        resultExpiresAt,
        resultDeletedAt: resultUrl ? null : task.resultDeletedAt,
        syncResponsePayload: payload,
        errorMessage: status === "FAILED" ? JSON.stringify(payload).slice(0, 2000) : null,
        completedAt
      },
      include: { selectedKey: true, owner: true }
    });
  } catch (error) {
    const bodyText = error.bodyText || error.message || "Sync failed";
    await markKeyFailure(key.id, error.status || 500, bodyText);
    return prisma.videoTask.update({
      where: { id: task.id },
      data: { errorMessage: bodyText.slice(0, 2000) },
      include: { selectedKey: true, owner: true }
    });
  }
}

async function syncPendingTasks() {
  const tasks = await prisma.videoTask.findMany({
    where: {
      status: { in: ACTIVE_TASK_STATUSES },
      freepikTaskId: { not: null }
    },
    orderBy: { updatedAt: "asc" },
    take: config.syncBatchSize,
    include: { selectedKey: true, owner: true }
  });

  let processed = 0;
  for (const task of tasks) {
    await syncSingleTask(task);
    processed += 1;
  }

  return { processed };
}

async function purgeExpiredResults() {
  const expired = await prisma.videoTask.findMany({
    where: {
      resultUrl: { not: null },
      resultExpiresAt: { lte: new Date() }
    },
    select: { id: true }
  });

  for (const task of expired) {
    await prisma.videoTask.update({
      where: { id: task.id },
      data: {
        resultUrl: null,
        syncResponsePayload: null,
        resultDeletedAt: new Date()
      }
    });
  }

  return { purged: expired.length };
}

async function backfillStoredResultUrls() {
  const candidates = await prisma.videoTask.findMany({
    where: {
      status: "COMPLETED",
      resultUrl: null,
      syncResponsePayload: { not: null }
    },
    take: 25
  });

  let restored = 0;
  for (const task of candidates) {
    const derived = deriveResultInfo(task);
    if (!derived.fallbackUrl) continue;
    await prisma.videoTask.update({
      where: { id: task.id },
      data: {
        resultUrl: derived.fallbackUrl,
        resultExpiresAt: derived.expiresAt || resultExpiryFromNow(),
        resultDeletedAt: null
      }
    });
    restored += 1;
  }

  return { restored };
}

async function runMaintenance() {
  return withAdvisoryLock(MAINTENANCE_LOCK_ID, async () => {
    const [sync, purge, backfill] = await Promise.all([
      syncPendingTasks(),
      purgeExpiredResults(),
      backfillStoredResultUrls()
    ]);
    return { skipped: false, sync, purge, backfill, ranAt: new Date().toISOString() };
  });
}

function assertCronSecret(req, res) {
  if (!config.cronSecret) {
    res.status(503).json({ ok: false, error: "CRON_SECRET belum dikonfigurasi." });
    return false;
  }

  const authHeader = String(req.headers.authorization || "");
  if (authHeader !== `Bearer ${config.cronSecret}`) {
    res.status(401).json({ ok: false, error: "Unauthorized cron request" });
    return false;
  }

  return true;
}

app.post("/api/auth/validate", async (req, res, next) => {
  try {
    const { key } = req.body || {};
    if (!key) return res.status(400).json({ ok: false, error: "Key required" });

    const ip = getClientIp(req);
    if (isRateLimited(ip)) {
      return res.status(429).json({ ok: false, error: "Terlalu banyak percobaan login. Coba lagi nanti." });
    }

    const session = await findSessionByKey(key, { touchLogin: true });
    if (!session) {
      noteFailedLogin(ip);
      return res.status(401).json({ ok: false, error: "Invalid or expired access key" });
    }

    resetLoginAttempts(ip);
    const token = createSessionToken(session);
    res.setHeader("Set-Cookie", serializeCookie(config.sessionCookieName, token, sessionCookieOptions(req)));

    res.json({
      ok: true,
      role: session.role,
      name: session.name,
      user: serializeUser(session.user),
      adminUnlocked: session.isAdmin
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/logout", (req, res) => {
  res.setHeader("Set-Cookie", serializeCookie(config.sessionCookieName, "", clearSessionCookieOptions(req)));
  res.json({ ok: true });
});

app.post("/api/uploads/blob", async (req, res) => {
  if (!config.blobReadWriteToken) {
    return res.status(503).json({ ok: false, error: "BLOB_READ_WRITE_TOKEN belum diisi." });
  }

  try {
    const body = req.body || {};
    const jsonResponse = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (_pathname, clientPayload) => {
        const auth = await resolveRequestAuth(req);
        if (!auth) {
          throw new Error("Unauthorized");
        }

        const payload = typeof clientPayload === "string" ? safeJsonParse(clientPayload) : clientPayload || {};
        const kind = String(payload?.kind || "").toLowerCase() === "video" ? "video" : "image";
        const allowedContentTypes = kind === "video"
          ? ["video/mp4", "video/quicktime", "video/webm"]
          : ["image/jpeg", "image/png", "image/webp"];

        return {
          allowedContentTypes,
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({
            kind,
            role: auth.role,
            ownerId: auth.user?.id || null
          })
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        console.log("[blob-upload-completed]", blob?.pathname || blob?.url, tokenPayload || "");
      }
    });

    return res.json(jsonResponse);
  } catch (error) {
    return res.status(400).json({ ok: false, error: error.message });
  }
});

app.get("/api/internal/maintenance", async (req, res, next) => {
  try {
    if (!assertCronSecret(req, res)) return;
    const result = await runMaintenance();
    if (result?.skipped) return res.status(202).json({ ok: true, skipped: true });
    return res.json({ ok: true, ...result });
  } catch (error) {
    next(error);
  }
});

app.post("/api/webhooks/freepik", async (req, res) => {
  try {
    if (config.webhookSecret) {
      const webhookId = req.headers["webhook-id"];
      const webhookTimestamp = req.headers["webhook-timestamp"];
      const signatureHeader = String(req.headers["webhook-signature"] || "");
      const contentToSign = `${webhookId}.${webhookTimestamp}.${req.rawBody || ""}`;
      const generatedSignature = crypto
        .createHmac("sha256", Buffer.from(config.webhookSecret, "utf8"))
        .update(contentToSign)
        .digest("base64");
      const signatures = signatureHeader.split(" ").filter(Boolean);
      const valid = signatures.some((part) => part.split(",")[1] === generatedSignature);
      if (!valid) return res.status(401).json({ ok: false, error: "Invalid webhook signature" });
    }

    const payload = req.body || {};
    const freepikTaskId = extractTaskId(payload);
    if (!freepikTaskId) return res.json({ ok: true, ignored: true, reason: "No task id found" });

    const task = await prisma.videoTask.findFirst({
      where: { freepikTaskId },
      include: { selectedKey: true, owner: true }
    });
    if (!task) return res.json({ ok: true, ignored: true, reason: "Task not found in database" });

    const remoteStatus = normalizeRemoteStatus(payload);
    const status = normalizeTaskStatus(remoteStatus);
    const resultUrl = normalizePublicUrl(extractResultUrl(payload));

    await prisma.videoTask.update({
      where: { id: task.id },
      data: {
        remoteStatus: remoteStatus || task.remoteStatus,
        status,
        syncResponsePayload: payload,
        resultUrl: resultUrl || task.resultUrl,
        resultExpiresAt: resultUrl ? resultExpiryFromNow() : task.resultExpiresAt,
        resultDeletedAt: resultUrl ? null : task.resultDeletedAt,
        completedAt: status === "COMPLETED" ? (task.completedAt || new Date()) : task.completedAt,
        errorMessage: status === "FAILED" ? JSON.stringify(payload).slice(0, 2000) : task.errorMessage
      }
    });

    res.json({ ok: true });
  } catch (error) {
    console.error("[webhook]", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.use("/api", requireApiAuth);

app.get("/api/session", async (req, res) => {
  res.json({
    ok: true,
    session: {
      role: req.auth.role,
      name: req.auth.name,
      user: serializeUser(req.auth.user)
    }
  });
});

app.get("/api/health", async (_req, res) => {
  const [keyCount, taskCount, userCount] = await Promise.all([
    prisma.apiKey.count(),
    prisma.videoTask.count(),
    prisma.panelUser.count()
  ]);

  res.json({ ok: true, now: new Date().toISOString(), keyCount, taskCount, userCount });
});

app.get("/api/dashboard", async (req, res) => {
  if (req.auth.isAdmin) {
    const [keys, tasks, users] = await Promise.all([
      prisma.apiKey.findMany({ orderBy: { createdAt: "desc" } }),
      prisma.videoTask.findMany({ include: { selectedKey: true, owner: true }, orderBy: { createdAt: "desc" }, take: 100 }),
      prisma.panelUser.findMany({ include: { _count: { select: { tasks: true } } }, orderBy: { createdAt: "desc" } })
    ]);

    const summary = {
      keys: {
        total: keys.length,
        healthy: keys.filter((k) => k.status === "HEALTHY").length,
        cooldown: keys.filter((k) => k.status === "COOLDOWN").length,
        invalid: keys.filter((k) => k.status === "INVALID").length,
        likelyExhausted: keys.filter((k) => k.status === "LIKELY_EXHAUSTED").length,
        unknown: keys.filter((k) => k.status === "UNKNOWN").length,
        rateLimited: keys.filter((k) => k.status === "RATE_LIMITED").length
      },
      tasks: {
        total: tasks.length,
        active: tasks.filter((t) => ACTIVE_TASK_STATUSES.includes(t.status)).length,
        completed: tasks.filter((t) => t.status === "COMPLETED").length,
        failed: tasks.filter((t) => t.status === "FAILED").length
      },
      users: {
        total: users.length,
        active: users.filter((user) => isUserAccessActive(user)).length
      }
    };

    return res.json({
      session: { role: "admin", name: req.auth.name, user: null },
      summary,
      keys: keys.map(serializeKey),
      users: users.map(serializeUser),
      tasks: tasks.map((task) => serializeTaskForAuth(task, req.auth))
    });
  }

  const tasks = await prisma.videoTask.findMany({
    where: { ownerId: req.auth.user.id },
    include: { selectedKey: true, owner: true },
    orderBy: { createdAt: "desc" },
    take: 100
  });

  const summary = {
    tasks: {
      total: tasks.length,
      active: tasks.filter((t) => ACTIVE_TASK_STATUSES.includes(t.status)).length,
      completed: tasks.filter((t) => t.status === "COMPLETED").length,
      failed: tasks.filter((t) => t.status === "FAILED").length
    }
  };

  res.json({
    session: { role: "user", name: req.auth.name, user: serializeUser(req.auth.user) },
    summary,
    tasks: tasks.map((task) => serializeTaskForAuth(task, req.auth)),
    resultUrlTtlMs: config.resultUrlTtlMs
  });
});

app.get("/api/tasks", async (req, res) => {
  const tasks = await prisma.videoTask.findMany({
    where: taskAccessWhere(req.auth),
    include: { selectedKey: true, owner: true },
    orderBy: { createdAt: "desc" },
    take: 100
  });
  res.json(tasks.map((task) => serializeTaskForAuth(task, req.auth)));
});

app.post("/api/tasks", async (req, res) => {
  const {
    title,
    tier = "PRO",
    image_url,
    video_url,
    prompt = "",
    character_orientation = "VIDEO",
    cfg_scale = 0.5
  } = req.body || {};

  const normalizedImageUrl = normalizePublicUrl(image_url);
  const normalizedVideoUrl = normalizePublicUrl(video_url);
  if (!normalizedImageUrl || !normalizedVideoUrl) {
    return res.status(400).json({ ok: false, error: "image_url dan video_url wajib diisi." });
  }
  if (!/^https:\/\//i.test(normalizedImageUrl) || !/^https:\/\//i.test(normalizedVideoUrl)) {
    return res.status(400).json({ ok: false, error: "image_url dan video_url harus memakai HTTPS public URL." });
  }

  const candidates = await listCandidateKeys();
  if (!candidates.length) {
    return res.status(400).json({ ok: false, error: "Tidak ada API key aktif yang siap dipakai." });
  }

  const payload = {
    image_url: normalizedImageUrl,
    video_url: normalizedVideoUrl,
    prompt: prompt || undefined,
    character_orientation: String(character_orientation).toLowerCase() === "image" ? "image" : "video",
    cfg_scale: Number(cfg_scale)
  };

  const webhookUrl = buildWebhookUrl(req);
  if (webhookUrl) payload.webhook_url = webhookUrl;

  const task = await prisma.videoTask.create({
    data: {
      title: title || null,
      tier: String(tier).toUpperCase() === "STD" ? "STD" : "PRO",
      imageUrl: normalizedImageUrl,
      videoUrl: normalizedVideoUrl,
      prompt: prompt || null,
      characterOrientation: String(character_orientation).toUpperCase() === "IMAGE" ? "IMAGE" : "VIDEO",
      cfgScale: Number(cfg_scale),
      webhookEnabled: Boolean(webhookUrl),
      ownerId: req.auth.user?.id || null,
      requestPayload: payload,
      status: "PENDING"
    },
    include: { selectedKey: true, owner: true }
  });

  let lastFailure = "Task create failed";
  const attemptErrors = [];

  for (const candidate of candidates) {
    await prisma.videoTask.update({
      where: { id: task.id },
      data: { selectedKeyId: candidate.id }
    });

    try {
      const response = await createMotionTask({ apiKey: candidate.plainApiKey, tier: task.tier, payload });
      const data = response.data;
      const freepikTaskId = extractTaskId(data);
      const remoteStatus = normalizeRemoteStatus(data);
      const status = freepikTaskId ? "SUBMITTED" : "PROCESSING";
      await markKeySuccess(candidate.id);

      const updated = await prisma.videoTask.update({
        where: { id: task.id },
        data: {
          selectedKeyId: candidate.id,
          freepikTaskId,
          remoteStatus: remoteStatus || "submitted",
          status,
          createResponsePayload: data,
          errorMessage: null
        },
        include: { selectedKey: true, owner: true }
      });

      return res.json({ ok: true, task: serializeTaskForAuth(updated, req.auth) });
    } catch (error) {
      const details = classifyCreateError(error);
      lastFailure = details.bodyText;
      attemptErrors.push(`${candidate.label || candidate.apiKeyMasked}: ${details.bodyText.slice(0, 200)}`);
      await markKeyFailure(candidate.id, details.status, details.bodyText);

      if (details.nonRetriable) {
        break;
      }
    }
  }

  const updated = await prisma.videoTask.update({
    where: { id: task.id },
    data: {
      status: "FAILED",
      errorMessage: attemptErrors.length > 1 ? attemptErrors.join(" | ").slice(0, 2000) : lastFailure.slice(0, 2000)
    },
    include: { selectedKey: true, owner: true }
  });

  return res.status(500).json({ ok: false, error: lastFailure, task: serializeTaskForAuth(updated, req.auth) });
});

app.post("/api/tasks/:id/sync", async (req, res) => {
  const task = await findTaskForAuth(req.params.id, req.auth);
  if (!task) return res.status(404).json({ ok: false, error: "Task not found" });

  const updated = await syncSingleTask(task);
  res.json({ ok: true, task: serializeTaskForAuth(updated, req.auth) });
});

app.post("/api/tasks/sync-all", requireAdmin, async (_req, res) => {
  const result = await runMaintenance();
  if (result?.skipped) return res.status(202).json({ ok: true, skipped: true });
  res.json({ ok: true, ...result });
});

app.get("/api/keys", requireAdmin, async (_req, res) => {
  const keys = await prisma.apiKey.findMany({ orderBy: { createdAt: "desc" } });
  res.json(keys.map(serializeKey));
});

app.post("/api/keys/import", requireAdmin, async (req, res) => {
  const raw = String(req.body.rawKeys || "");
  const labels = String(req.body.labels || "");
  const rows = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const labelRows = labels.split(/\r?\n/).map((line) => line.trim());
  const created = [];
  let baseIndex = (await prisma.apiKey.count()) + 1;

  for (let i = 0; i < rows.length; i++) {
    const apiKey = rows[i];
    const apiKeyHash = hashText(apiKey);
    const masked = maskApiKey(apiKey);
    const label = labelRows[i] || generateLabel(baseIndex++);
    const encrypted = encryptText(apiKey);
    const existing = await prisma.apiKey.findFirst({ where: { apiKeyHash } });
    if (existing) continue;
    const item = await prisma.apiKey.create({
      data: { label, apiKeyHash, apiKeyMasked: masked, apiKeyCiphertext: encrypted }
    });
    created.push(serializeKey(item));
  }

  res.json({ ok: true, createdCount: created.length, created });
});

app.post("/api/keys/test-all", requireAdmin, async (_req, res) => {
  const results = await testAllKeys({ concurrency: 5, tier: "PRO" });
  res.json({ ok: true, results });
});

app.post("/api/keys/:id/test", requireAdmin, async (req, res) => {
  const key = await prisma.apiKey.findUnique({ where: { id: req.params.id } });
  if (!key) return res.status(404).json({ ok: false, error: "Key not found" });
  const result = await testSingleKey(key, "PRO");
  res.json({ ok: true, result });
});

app.patch("/api/keys/:id/toggle", requireAdmin, async (req, res) => {
  const key = await prisma.apiKey.findUnique({ where: { id: req.params.id } });
  if (!key) return res.status(404).json({ ok: false, error: "Key not found" });

  const updated = await prisma.apiKey.update({
    where: { id: req.params.id },
    data: { isEnabled: !key.isEnabled }
  });
  res.json({ ok: true, key: serializeKey(updated) });
});

app.delete("/api/keys/:id", requireAdmin, async (req, res) => {
  await prisma.apiKey.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

app.get("/api/admin/users", requireAdmin, async (_req, res) => {
  const users = await prisma.panelUser.findMany({
    include: { _count: { select: { tasks: true } } },
    orderBy: { createdAt: "desc" }
  });
  res.json(users.map(serializeUser));
});

app.post("/api/admin/users", requireAdmin, async (req, res) => {
  const { name, accessKey, accessStartsAt, accessEndsAt, notes = "", isEnabled = true } = req.body || {};
  if (!name || !accessKey) {
    return res.status(400).json({ ok: false, error: "name dan accessKey wajib diisi." });
  }

  const accessKeyHash = hashText(accessKey);
  const existing = await prisma.panelUser.findUnique({ where: { accessKeyHash } });
  if (existing) {
    return res.status(409).json({ ok: false, error: "Access key sudah dipakai user lain." });
  }

  const created = await prisma.panelUser.create({
    data: {
      name: String(name).trim(),
      accessKeyHash,
      accessKeyMasked: maskApiKey(accessKey),
      accessKeyCiphertext: null,
      accessStartsAt: parseOptionalDate(accessStartsAt),
      accessEndsAt: parseOptionalDate(accessEndsAt),
      notes: String(notes || "").trim() || null,
      isEnabled: Boolean(isEnabled)
    }
  });

  res.json({ ok: true, user: serializeUser(created) });
});

app.patch("/api/admin/users/:id", requireAdmin, async (req, res) => {
  const existing = await prisma.panelUser.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ ok: false, error: "User not found" });

  const { name, accessKey, accessStartsAt, accessEndsAt, notes, isEnabled } = req.body || {};
  const data = {};

  if (name != null) data.name = String(name).trim() || existing.name;
  if (notes != null) data.notes = String(notes).trim() || null;
  if (typeof isEnabled === "boolean") data.isEnabled = isEnabled;
  if (accessStartsAt !== undefined) data.accessStartsAt = parseOptionalDate(accessStartsAt);
  if (accessEndsAt !== undefined) data.accessEndsAt = parseOptionalDate(accessEndsAt);

  if (accessKey) {
    const accessKeyHash = hashText(accessKey);
    const duplicate = await prisma.panelUser.findUnique({ where: { accessKeyHash } });
    if (duplicate && duplicate.id !== existing.id) {
      return res.status(409).json({ ok: false, error: "Access key sudah dipakai user lain." });
    }
    data.accessKeyHash = accessKeyHash;
    data.accessKeyMasked = maskApiKey(accessKey);
    data.accessKeyCiphertext = null;
  }

  const updated = await prisma.panelUser.update({
    where: { id: req.params.id },
    data
  });

  res.json({ ok: true, user: serializeUser(updated) });
});

app.delete("/api/admin/users/:id", requireAdmin, async (req, res) => {
  await prisma.panelUser.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

app.use("/api", (_req, res) => {
  res.status(404).json({ ok: false, error: "API route not found" });
});

if (config.isVercel) {
  app.get("/favicon.ico", (_req, res) => res.status(204).end());
  app.get("/favicon.png", (_req, res) => res.status(204).end());
  app.get("/", (_req, res) => res.redirect("/index.html"));
  app.get("*", (_req, res) => res.status(404).end());
} else {
  app.get("*", (_req, res) => res.sendFile(indexFile));
}

app.use((error, _req, res, _next) => {
  console.error("[unhandled]", error);
  if (res.headersSent) return;
  res.status(500).json({ ok: false, error: error.message || "Internal Server Error" });
});

if (!config.isVercel) {
  app.listen(config.port, async () => {
    console.log(`[freepik-kling-panel] running on http://0.0.0.0:${config.port}`);
  });
}

export default app;
