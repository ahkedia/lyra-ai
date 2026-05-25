/**
 * Lockfile utilities for preventing concurrent script runs
 */

import { existsSync, writeFileSync, unlinkSync, readFileSync } from "fs";

/**
 * @param {string} raw
 * @returns {number | null} numeric pid or null if empty / invalid
 */
export function parseLockPid(raw) {
  const t = String(raw ?? "").trim();
  if (!t || !/^\d+$/.test(t)) return null;
  return parseInt(t, 10);
}

/**
 * @param {number} pid
 * @returns {boolean}
 */
export function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid < 1) return false;
  // PID 1 is init: never treat as stale. Unprivileged Node may get EPERM on kill(1, 0).
  if (pid === 1) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {string} lockPath
 * @returns {boolean} true if this process holds the lock
 */
export function acquireLock(lockPath) {
  if (!existsSync(lockPath)) {
    writeFileSync(lockPath, process.pid.toString());
    return true;
  }

  const raw = readFileSync(lockPath, "utf8");
  const pid = parseLockPid(raw);

  if (pid === null) {
    console.log(
      `Lock exists but PID invalid or empty (removing stale lock): ${JSON.stringify(raw)}`,
    );
    unlinkSync(lockPath);
    writeFileSync(lockPath, process.pid.toString());
    return true;
  }

  if (pid === process.pid) {
    writeFileSync(lockPath, process.pid.toString());
    return true;
  }

  if (!isPidAlive(pid)) {
    console.log(`Lock held by dead PID ${pid} (removing stale lock)`);
    unlinkSync(lockPath);
    writeFileSync(lockPath, process.pid.toString());
    return true;
  }

  console.log(`Lock exists (PID ${pid}), exiting`);
  return false;
}

export function releaseLock(lockPath) {
  if (existsSync(lockPath)) {
    unlinkSync(lockPath);
  }
}

export function withLock(lockPath, fn) {
  return async () => {
    if (!acquireLock(lockPath)) {
      process.exit(0);
    }
    try {
      await fn();
    } finally {
      releaseLock(lockPath);
    }
  };
}
