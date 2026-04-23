const fs = require("fs");

function runningInsideDocker() {
  try {
    return fs.existsSync("/.dockerenv");
  } catch {
    return false;
  }
}

function resolveDatabaseUrl(rawValue, options = {}) {
  const raw = String(rawValue || "").trim();
  if (!raw) return raw;
  const forceLocal = String(process.env.FORCE_LOCAL_DB_FALLBACK || "").trim() === "1";
  const localPort = Number(process.env.LOCAL_DB_PORT || options.localPort || 5433);

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return raw;
  }

  if (!forceLocal && runningInsideDocker()) return raw;

  if (parsed.hostname === "postgres") {
    parsed.hostname = "127.0.0.1";
    if (!parsed.port) parsed.port = String(localPort);
    else if (parsed.port === "5432") parsed.port = String(localPort);
    return parsed.toString();
  }

  return raw;
}

module.exports = {
  resolveDatabaseUrl
};
