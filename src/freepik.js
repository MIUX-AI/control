import { config } from "./config.js";
import { safeJsonParse } from "./utils.js";

const BASE_URL = "https://api.freepik.com";

export function getMotionPathForTier(tier) {
  return tier === "PRO"
    ? "/v1/ai/video/kling-v3-motion-control-pro"
    : "/v1/ai/video/kling-v3-motion-control-std";
}

export async function freepikRequest({
  apiKey,
  path,
  method = "GET",
  body,
  raw = false
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);

  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        "x-freepik-api-key": apiKey
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal
    });

    const text = await res.text();
    const json = safeJsonParse(text);

    if (raw) {
      return { ok: res.ok, status: res.status, headers: Object.fromEntries(res.headers.entries()), text, json };
    }

    if (!res.ok) {
      const error = new Error(`Freepik error ${res.status}`);
      error.status = res.status;
      error.bodyText = text;
      error.bodyJson = json;
      throw error;
    }

    return { status: res.status, data: json ?? text, rawText: text };
  } finally {
    clearTimeout(timeout);
  }
}

export async function createMotionTask({ apiKey, tier, payload }) {
  return freepikRequest({
    apiKey,
    path: getMotionPathForTier(tier),
    method: "POST",
    body: payload
  });
}

export async function getMotionTask({ apiKey, tier, taskId }) {
  return freepikRequest({
    apiKey,
    path: `${getMotionPathForTier(tier)}/${taskId}`,
    method: "GET"
  });
}

export async function listMotionTasks({ apiKey, tier }) {
  return freepikRequest({
    apiKey,
    path: getMotionPathForTier(tier),
    method: "GET"
  });
}
