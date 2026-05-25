import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawn } from "child_process";
import { writeFileSync, existsSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("lockfile parseLockPid + isPidAlive", () => {
  it("parseLockPid handles empty and invalid", async () => {
    const { parseLockPid } = await import("../scripts/lib/lockfile.js");
    expect(parseLockPid("")).toBeNull();
    expect(parseLockPid("   ")).toBeNull();
    expect(parseLockPid("abc")).toBeNull();
    expect(parseLockPid("12a3")).toBeNull();
    expect(parseLockPid("42")).toBe(42);
  });

  it("isPidAlive false for nonsense pid", async () => {
    const { isPidAlive } = await import("../scripts/lib/lockfile.js");
    expect(isPidAlive(0)).toBe(false);
    expect(isPidAlive(-1)).toBe(false);
    expect(isPidAlive(2147483646)).toBe(false);
  });

  it("isPidAlive true for current process", async () => {
    const { isPidAlive } = await import("../scripts/lib/lockfile.js");
    expect(isPidAlive(process.pid)).toBe(true);
  });

  it("isPidAlive treats pid 1 as alive", async () => {
    const { isPidAlive } = await import("../scripts/lib/lockfile.js");
    expect(isPidAlive(1)).toBe(true);
  });
});

describe("lockfile acquireLock", () => {
  let lockPath;

  beforeEach(() => {
    lockPath = join(tmpdir(), `ce-lock-${Date.now()}-${Math.random().toString(36).slice(2)}.lock`);
  });

  afterEach(() => {
    try {
      rmSync(lockPath);
    } catch {
      /* ignore */
    }
  });

  it("acquires when no file", async () => {
    const { acquireLock, releaseLock } = await import("../scripts/lib/lockfile.js");
    expect(acquireLock(lockPath)).toBe(true);
    expect(existsSync(lockPath)).toBe(true);
    expect(readFileSync(lockPath, "utf8").trim()).toBe(String(process.pid));
    releaseLock(lockPath);
    expect(existsSync(lockPath)).toBe(false);
  });

  it("removes empty lock and acquires", async () => {
    writeFileSync(lockPath, "");
    const { acquireLock, releaseLock } = await import("../scripts/lib/lockfile.js");
    expect(acquireLock(lockPath)).toBe(true);
    expect(readFileSync(lockPath, "utf8").trim()).toBe(String(process.pid));
    releaseLock(lockPath);
  });

  it("removes lock with dead pid and acquires", async () => {
    writeFileSync(lockPath, "2147483646\n");
    const { acquireLock, releaseLock } = await import("../scripts/lib/lockfile.js");
    expect(acquireLock(lockPath)).toBe(true);
    expect(readFileSync(lockPath, "utf8").trim()).toBe(String(process.pid));
    releaseLock(lockPath);
  });

  it("does not acquire when lock held by another live process", async () => {
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 3600_000)"], {
      stdio: "ignore",
      detached: true,
    });
    await new Promise((r) => setTimeout(r, 150));
    writeFileSync(lockPath, `${child.pid}\n`);
    const { acquireLock } = await import("../scripts/lib/lockfile.js");
    expect(acquireLock(lockPath)).toBe(false);
    expect(readFileSync(lockPath, "utf8").trim()).toBe(String(child.pid));
    try {
      process.kill(child.pid, "SIGKILL");
    } catch {
      /* ignore */
    }
    try {
      child.kill("SIGKILL");
    } catch {
      /* ignore */
    }
    rmSync(lockPath);
  });
});
