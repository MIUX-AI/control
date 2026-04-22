import dotenv from "dotenv";

dotenv.config();

function toNumber(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function toBool(value, fallback = false) {
  if (value == null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

export const config = {
  port: toNumber(process.env.PORT, 3000),
  nodeEnv: process.env.NODE_ENV || "development",
  databaseUrl: process.env.DATABASE_URL || "",
  appBaseUrl: String(process.env.APP_BASE_URL || "").trim().replace(/\/$/, ""),
  webhookSecret: process.env.FREEPIK_WEBHOOK_SECRET || "",
  syncBatchSize: toNumber(process.env.SYNC_BATCH_SIZE, 10),
  keyCooldownMs: toNumber(process.env.KEY_COOLDOWN_MS, 300000),
  requestTimeoutMs: toNumber(process.env.REQUEST_TIMEOUT_MS, 120000),
  resultUrlTtlMs: toNumber(process.env.RESULT_URL_TTL_MS, 3600000),
  adminPass: process.env.ADMIN_PASS || "",
  adminKey: process.env.ADMIN_KEY || "",
  appEncryptionKey: process.env.APP_ENCRYPTION_KEY || "",
  sessionSecret: process.env.SESSION_SECRET || process.env.APP_ENCRYPTION_KEY || "",
  sessionCookieName: process.env.SESSION_COOKIE_NAME || "mx_session",
  sessionTtlHours: toNumber(process.env.SESSION_TTL_HOURS, 12),
  loginRateLimitWindowMs: toNumber(process.env.LOGIN_RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
  loginRateLimitMaxAttempts: toNumber(process.env.LOGIN_RATE_LIMIT_MAX_ATTEMPTS, 10),
  cronSecret: process.env.CRON_SECRET || "",
  blobReadWriteToken: process.env.BLOB_READ_WRITE_TOKEN || "",
  allowLegacyCryptoFallback: toBool(process.env.ALLOW_LEGACY_DATABASE_URL_CRYPTO, true),
  isVercel: process.env.VERCEL === "1" || Boolean(process.env.VERCEL_ENV),
  vercelEnv: process.env.VERCEL_ENV || "",
  vercelUrl: process.env.VERCEL_URL || "",
  vercelBranchUrl: process.env.VERCEL_BRANCH_URL || "",
  vercelProductionUrl: process.env.VERCEL_PROJECT_PRODUCTION_URL || ""
};

if (!config.databaseUrl) {
  console.warn("[WARN] DATABASE_URL belum diisi.");
}

if (!config.appEncryptionKey) {
  console.warn("[WARN] APP_ENCRYPTION_KEY belum diisi. Ciphertext baru di production akan gagal dibuat.");
}

if (!config.sessionSecret) {
  console.warn("[WARN] SESSION_SECRET belum diisi. Login session di production akan gagal.");
}
