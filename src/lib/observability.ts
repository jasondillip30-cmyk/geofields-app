const debugChannels = new Set(
  (process.env.GEOFIELDS_DEBUG_CHANNELS || "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
);

function shouldDebug(channel?: string) {
  if (process.env.NODE_ENV === "production") {
    return false;
  }
  if (process.env.GEOFIELDS_DEBUG_LOGS === "1") {
    return true;
  }
  if (!channel) {
    return false;
  }
  return debugChannels.has(channel.trim().toLowerCase());
}

export function debugLog(scope: string, payload?: unknown, options?: { channel?: string }) {
  if (!shouldDebug(options?.channel)) {
    return;
  }
  if (payload === undefined) {
    console.info(scope);
    return;
  }
  console.info(scope, payload);
}

