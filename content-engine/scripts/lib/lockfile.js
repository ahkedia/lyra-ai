/**
 * Lockfile utilities for preventing concurrent script runs
 */

import { existsSync, writeFileSync, unlinkSync, readFileSync } from "fs";

export function acquireLock(lockPath) {
  if (existsSync(lockPath)) {
    const pid = readFileSync(lockPath, "utf8").trim();
    console.log(`Lock exists (PID ${pid}), exiting`);
    return false;
  }
  writeFileSync(lockPath, process.pid.toString());
  return true;
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
