import { prisma } from "./db.js";
import { config } from "./config.js";
import { decryptText, keyStatusFromHttp, nowPlusMs } from "./utils.js";
import { listMotionTasks } from "./freepik.js";

function isCooling(key) {
  return key.cooldownUntil && new Date(key.cooldownUntil).getTime() > Date.now();
}

function priority(status) {
  switch (status) {
    case "HEALTHY":
      return 1;
    case "UNKNOWN":
      return 2;
    case "COOLDOWN":
      return 3;
    case "RATE_LIMITED":
      return 4;
    case "LIKELY_EXHAUSTED":
      return 5;
    case "INVALID":
      return 6;
    default:
      return 99;
  }
}

function sortCandidates(keys) {
  return [...keys].sort((a, b) => {
    const p1 = priority(a.status);
    const p2 = priority(b.status);
    if (p1 !== p2) return p1 - p2;

    const aActive = a.activeTaskCount || 0;
    const bActive = b.activeTaskCount || 0;
    if (aActive !== bActive) return aActive - bActive;

    if ((a.failureStreak || 0) !== (b.failureStreak || 0)) {
      return (a.failureStreak || 0) - (b.failureStreak || 0);
    }

    const aTime = a.lastSuccessAt ? new Date(a.lastSuccessAt).getTime() : 0;
    const bTime = b.lastSuccessAt ? new Date(b.lastSuccessAt).getTime() : 0;
    return aTime - bTime;
  });
}

async function getActiveTaskCountMap() {
  const rows = await prisma.videoTask.groupBy({
    by: ["selectedKeyId"],
    where: {
      selectedKeyId: { not: null },
      status: { in: ["PENDING", "SUBMITTED", "PROCESSING"] }
    },
    _count: { selectedKeyId: true }
  });

  return new Map(rows.map((row) => [row.selectedKeyId, row._count.selectedKeyId]));
}

export async function listCandidateKeys() {
  const [keys, activeTaskCountMap] = await Promise.all([
    prisma.apiKey.findMany({
      where: {
        isEnabled: true,
        status: {
          not: "INVALID"
        }
      },
      orderBy: [{ updatedAt: "asc" }]
    }),
    getActiveTaskCountMap()
  ]);

  const enriched = keys.map((key) => ({
    ...key,
    activeTaskCount: activeTaskCountMap.get(key.id) || 0
  }));

  const filtered = enriched.filter((key) => !isCooling(key) && key.status !== "LIKELY_EXHAUSTED");
  const candidates = filtered.length ? filtered : enriched.filter((key) => !isCooling(key));

  return sortCandidates(candidates).map((key) => ({
    ...key,
    plainApiKey: decryptText(key.apiKeyCiphertext)
  }));
}

export async function selectBestKey() {
  const candidates = await listCandidateKeys();
  return candidates[0] || null;
}

export async function markKeySuccess(keyId) {
  return prisma.apiKey.update({
    where: { id: keyId },
    data: {
      status: "HEALTHY",
      lastCheckedAt: new Date(),
      lastSuccessAt: new Date(),
      lastError: null,
      failureStreak: 0,
      successCount: { increment: 1 },
      cooldownUntil: null
    }
  });
}

export async function markKeyFailure(keyId, statusCode, bodyText) {
  const nextStatus = keyStatusFromHttp({ statusCode, bodyText });
  return prisma.apiKey.update({
    where: { id: keyId },
    data: {
      status: nextStatus === "RATE_LIMITED" ? "COOLDOWN" : nextStatus,
      lastCheckedAt: new Date(),
      lastFailureAt: new Date(),
      lastError: bodyText?.slice(0, 2000) || `HTTP ${statusCode}`,
      failureStreak: { increment: 1 },
      cooldownUntil: nextStatus === "RATE_LIMITED" ? nowPlusMs(config.keyCooldownMs) : null
    }
  });
}

export async function testSingleKey(dbKey, tier = "PRO") {
  const apiKey = decryptText(dbKey.apiKeyCiphertext);

  try {
    await listMotionTasks({ apiKey, tier });
    await prisma.apiKey.update({
      where: { id: dbKey.id },
      data: {
        status: "HEALTHY",
        lastCheckedAt: new Date(),
        lastSuccessAt: new Date(),
        lastError: null,
        cooldownUntil: null
      }
    });
    return { id: dbKey.id, ok: true, status: "HEALTHY" };
  } catch (error) {
    const bodyText = error.bodyText || error.message || "Unknown error";
    const status = keyStatusFromHttp({ statusCode: error.status || 500, bodyText });
    await prisma.apiKey.update({
      where: { id: dbKey.id },
      data: {
        status: status === "RATE_LIMITED" ? "COOLDOWN" : status,
        lastCheckedAt: new Date(),
        lastFailureAt: new Date(),
        lastError: bodyText.slice(0, 2000),
        cooldownUntil: status === "RATE_LIMITED" ? nowPlusMs(config.keyCooldownMs) : null
      }
    });
    return { id: dbKey.id, ok: false, status, error: bodyText };
  }
}

export async function testAllKeys({ concurrency = 5, tier = "PRO" } = {}) {
  const keys = await prisma.apiKey.findMany({ orderBy: { createdAt: "asc" } });
  const results = [];
  let index = 0;

  async function worker() {
    while (index < keys.length) {
      const current = keys[index++];
      const result = await testSingleKey(current, tier);
      results.push(result);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, keys.length || 1) }, () => worker());
  await Promise.all(workers);
  return results;
}
