import fs from "node:fs";
import path from "node:path";

const DEFAULT_RETRY_INTERVAL_MS = 25;
const DEFAULT_MAX_WAIT_MS = 5_000;

export interface LockOptions {
  retryIntervalMs?: number;
  maxWaitMs?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function stealStaleLock(lockFile: string): boolean {
  let holderPid = 0;
  try {
    holderPid = Number(fs.readFileSync(lockFile, "utf-8").trim());
  } catch {
    return false;
  }

  if (holderPid && pidAlive(holderPid)) {
    return false;
  }

  try {
    fs.unlinkSync(lockFile);
    process.stderr.write(
      `[channel lock] stale lock from dead pid ${holderPid} stolen at ${lockFile}\n`,
    );
    return true;
  } catch {
    return false;
  }
}

export async function acquireLock(
  lockFile: string,
  options: LockOptions = {},
): Promise<void> {
  const retryIntervalMs =
    options.retryIntervalMs ?? DEFAULT_RETRY_INTERVAL_MS;
  const maxWaitMs = options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
  const deadline = Date.now() + maxWaitMs;
  fs.mkdirSync(path.dirname(lockFile), { recursive: true });

  while (true) {
    try {
      const fd = fs.openSync(lockFile, "wx");
      fs.writeSync(fd, String(process.pid));
      fs.closeSync(fd);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") {
        throw error;
      }
    }

    if (stealStaleLock(lockFile)) {
      continue;
    }

    if (Date.now() >= deadline) {
      throw new Error(`Failed to acquire lock ${lockFile} within ${maxWaitMs}ms`);
    }
    await sleep(retryIntervalMs);
  }
}

export function releaseLock(lockFile: string): void {
  try {
    const content = fs.readFileSync(lockFile, "utf-8").trim();
    if (content === String(process.pid)) {
      fs.unlinkSync(lockFile);
    }
  } catch {
    // Already released or stolen by another process.
  }
}

export async function withLock<T>(
  lockFile: string,
  fn: () => Promise<T> | T,
  options?: LockOptions,
): Promise<T> {
  await acquireLock(lockFile, options);
  try {
    return await fn();
  } finally {
    releaseLock(lockFile);
  }
}
