import fs from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";

import { toPosix } from "../../utils/posix.js";

const DEFAULT_MAX_FILE_BYTES = 1_000_000;
const DEFAULT_WARN_FILE_BYTES = 200_000;
const DEFAULT_WARN_TOTAL_BYTES = 500_000;

export type ChannelContextSource = "file" | "jsonl";

export type ChannelContextWarningCode =
  | "empty_path"
  | "file_too_large"
  | "invalid_jsonl"
  | "missing_file"
  | "non_file"
  | "no_glob_matches"
  | "warn_file_large"
  | "warn_total_large";

export interface ChannelContextFile {
  path: string;
  absolutePath: string;
  content: string;
  reason?: string;
  source: ChannelContextSource;
  manifestPath?: string;
  manifestLine?: number;
  sizeBytes: number;
}

export interface ChannelContextWarning {
  code: ChannelContextWarningCode;
  message: string;
  path?: string;
  line?: number;
}

export interface LoadChannelContextOptions {
  cwd?: string;
  files?: string[];
  jsonl?: string[];
  maxFileBytes?: number;
  warnFileBytes?: number;
  warnTotalBytes?: number;
}

export interface ChannelContextLoadResult {
  cwd: string;
  files: ChannelContextFile[];
  warnings: ChannelContextWarning[];
  totalBytes: number;
}

interface ResolvedContextPath {
  absolutePath: string;
  logicalPath: string;
}

interface AddContextInput {
  rawPath: string;
  source: ChannelContextSource;
  reason?: string;
  manifestPath?: string;
  manifestLine?: number;
}

interface ContextAccumulator {
  rootReal: string;
  files: ChannelContextFile[];
  warnings: ChannelContextWarning[];
  seenRealPaths: Set<string>;
  totalBytes: number;
  totalWarningEmitted: boolean;
  maxFileBytes: number;
  warnFileBytes: number;
  warnTotalBytes: number;
}

function comparePath(filePath: string): string {
  return process.platform === "win32" ? filePath.toLowerCase() : filePath;
}

function pathIsInside(root: string, candidate: string): boolean {
  const relative = path.relative(comparePath(root), comparePath(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function assertInsideRoot(rootReal: string, candidate: string, label: string): void {
  if (!pathIsInside(rootReal, candidate)) {
    throw new Error(`Context path escapes worker cwd: ${label}`);
  }
}

function resolveContextPath(rawPath: string, rootReal: string): ResolvedContextPath {
  const trimmed = rawPath.trim();
  if (trimmed.length === 0) {
    throw new Error("Context path is empty");
  }

  const candidate = path.isAbsolute(trimmed)
    ? path.resolve(trimmed)
    : path.resolve(rootReal, trimmed);
  assertInsideRoot(rootReal, candidate, rawPath);

  let absolutePath: string;
  try {
    absolutePath = fs.realpathSync.native(candidate);
  } catch {
    throw new Error(`Context file not found: ${rawPath}`);
  }
  assertInsideRoot(rootReal, absolutePath, rawPath);

  return {
    absolutePath,
    logicalPath: toPosix(path.relative(rootReal, absolutePath)),
  };
}

function hasGlobPattern(rawPath: string): boolean {
  return /[*?]/.test(rawPath);
}

function escapeRegExp(value: string): string {
  return value.replace(/[\\^$+?.()|[\]{}]/g, "\\$&");
}

function globToRegExp(pattern: string): RegExp {
  let expression = "^";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === "*") {
      const next = pattern[index + 1];
      const afterNext = pattern[index + 2];
      if (next === "*" && afterNext === "/") {
        expression += "(?:.*\\/)?";
        index += 2;
      } else if (next === "*") {
        expression += ".*";
        index += 1;
      } else {
        expression += "[^/]*";
      }
    } else if (char === "?") {
      expression += "[^/]";
    } else {
      expression += escapeRegExp(char ?? "");
    }
  }
  expression += "$";
  return new RegExp(expression);
}

function normalizePattern(rawPath: string, rootReal: string): string {
  const trimmed = rawPath.trim();
  if (trimmed.length === 0) {
    throw new Error("Context path is empty");
  }
  const resolvedPattern = path.isAbsolute(trimmed)
    ? path.resolve(trimmed)
    : path.resolve(rootReal, trimmed);
  assertInsideRoot(rootReal, resolvedPattern, rawPath);
  return toPosix(path.relative(rootReal, resolvedPattern));
}

function listFiles(root: string): string[] {
  const result: string[] = [];
  const stack = [root];

  while (stack.length > 0) {
    const dir = stack.pop();
    if (dir === undefined) continue;

    const entries = fs
      .readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile()) {
        result.push(fullPath);
      } else if (entry.isSymbolicLink()) {
        try {
          const stat = fs.statSync(fullPath);
          if (stat.isFile()) {
            result.push(fullPath);
          }
        } catch {
          // Broken symlink; later explicit path resolution will report it.
        }
      }
    }
  }

  return result.sort((a, b) => a.localeCompare(b));
}

function expandGlob(rawPath: string, rootReal: string): string[] {
  const pattern = normalizePattern(rawPath, rootReal);
  const regexp = globToRegExp(pattern);
  return listFiles(rootReal).filter((filePath) => {
    const relative = toPosix(path.relative(rootReal, filePath));
    return regexp.test(relative);
  });
}

function warning(
  code: ChannelContextWarningCode,
  message: string,
  pathValue?: string,
  line?: number,
): ChannelContextWarning {
  return { code, message, path: pathValue, line };
}

function addWarning(acc: ContextAccumulator, item: ChannelContextWarning): void {
  acc.warnings.push(item);
}

function readContextFile(
  resolved: ResolvedContextPath,
  input: AddContextInput,
  acc: ContextAccumulator,
): void {
  if (acc.seenRealPaths.has(comparePath(resolved.absolutePath))) {
    return;
  }

  const stat = fs.statSync(resolved.absolutePath);
  if (stat.isDirectory()) {
    for (const nested of listFiles(resolved.absolutePath)) {
      const nestedInput = { ...input, rawPath: nested };
      const nestedResolved = resolveContextPath(nested, acc.rootReal);
      readContextFile(nestedResolved, nestedInput, acc);
    }
    return;
  }

  if (!stat.isFile()) {
    addWarning(
      acc,
      warning("non_file", `Skipping non-file context path: ${input.rawPath}`, input.rawPath, input.manifestLine),
    );
    return;
  }

  if (stat.size > acc.maxFileBytes) {
    addWarning(
      acc,
      warning(
        "file_too_large",
        `Skipping context file over ${acc.maxFileBytes} bytes: ${resolved.logicalPath}`,
        input.rawPath,
        input.manifestLine,
      ),
    );
    return;
  }

  const content = fs.readFileSync(resolved.absolutePath, "utf-8");
  acc.files.push({
    path: resolved.logicalPath,
    absolutePath: resolved.absolutePath,
    content,
    reason: input.reason,
    source: input.source,
    manifestPath: input.manifestPath,
    manifestLine: input.manifestLine,
    sizeBytes: stat.size,
  });
  acc.seenRealPaths.add(comparePath(resolved.absolutePath));
  acc.totalBytes += stat.size;

  if (stat.size > acc.warnFileBytes) {
    addWarning(
      acc,
      warning(
        "warn_file_large",
        `Context file is large (${stat.size} bytes): ${resolved.logicalPath}`,
        input.rawPath,
        input.manifestLine,
      ),
    );
  }
  if (!acc.totalWarningEmitted && acc.totalBytes > acc.warnTotalBytes) {
    acc.totalWarningEmitted = true;
    addWarning(
      acc,
      warning(
        "warn_total_large",
        `Total context size is large (${acc.totalBytes} bytes)`,
      ),
    );
  }
}

function addContextPath(input: AddContextInput, acc: ContextAccumulator): void {
  if (input.rawPath.trim().length === 0) {
    addWarning(
      acc,
      warning("empty_path", "Skipping empty context path", input.rawPath, input.manifestLine),
    );
    return;
  }

  if (hasGlobPattern(input.rawPath)) {
    const matches = expandGlob(input.rawPath, acc.rootReal);
    if (matches.length === 0) {
      addWarning(
        acc,
        warning(
          "no_glob_matches",
          `Context glob matched no files: ${input.rawPath}`,
          input.rawPath,
          input.manifestLine,
        ),
      );
    }
    for (const match of matches) {
      const resolved = resolveContextPath(match, acc.rootReal);
      readContextFile(resolved, { ...input, rawPath: match }, acc);
    }
    return;
  }

  const resolved = resolveContextPath(input.rawPath, acc.rootReal);
  readContextFile(resolved, input, acc);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function addJsonlContext(
  rawManifestPath: string,
  acc: ContextAccumulator,
): Promise<void> {
  const manifest = resolveContextPath(rawManifestPath, acc.rootReal);
  const stream = fs.createReadStream(manifest.absolutePath, { encoding: "utf-8" });
  const reader = createInterface({ input: stream, crlfDelay: Infinity });
  let lineNumber = 0;

  for await (const line of reader) {
    lineNumber += 1;
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      addWarning(
        acc,
        warning(
          "invalid_jsonl",
          `Invalid JSONL line in ${manifest.logicalPath}:${lineNumber}`,
          manifest.logicalPath,
          lineNumber,
        ),
      );
      continue;
    }

    if (!isRecord(parsed)) {
      addWarning(
        acc,
        warning(
          "invalid_jsonl",
          `JSONL line is not an object in ${manifest.logicalPath}:${lineNumber}`,
          manifest.logicalPath,
          lineNumber,
        ),
      );
      continue;
    }

    const file = parsed.file;
    if (file === undefined || file === null || file === "") {
      continue;
    }
    if (typeof file !== "string") {
      addWarning(
        acc,
        warning(
          "invalid_jsonl",
          `JSONL file field is not a string in ${manifest.logicalPath}:${lineNumber}`,
          manifest.logicalPath,
          lineNumber,
        ),
      );
      continue;
    }

    addContextPath(
      {
        rawPath: file,
        source: "jsonl",
        reason: typeof parsed.reason === "string" ? parsed.reason : undefined,
        manifestPath: manifest.logicalPath,
        manifestLine: lineNumber,
      },
      acc,
    );
  }
}

export async function loadChannelContext(
  options: LoadChannelContextOptions = {},
): Promise<ChannelContextLoadResult> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const rootReal = fs.realpathSync.native(cwd);
  const acc: ContextAccumulator = {
    rootReal,
    files: [],
    warnings: [],
    seenRealPaths: new Set<string>(),
    totalBytes: 0,
    totalWarningEmitted: false,
    maxFileBytes: options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES,
    warnFileBytes: options.warnFileBytes ?? DEFAULT_WARN_FILE_BYTES,
    warnTotalBytes: options.warnTotalBytes ?? DEFAULT_WARN_TOTAL_BYTES,
  };

  for (const file of options.files ?? []) {
    addContextPath({ rawPath: file, source: "file" }, acc);
  }
  for (const manifest of options.jsonl ?? []) {
    await addJsonlContext(manifest, acc);
  }

  return {
    cwd: rootReal,
    files: acc.files,
    warnings: acc.warnings,
    totalBytes: acc.totalBytes,
  };
}

export function sanitizeContextHeader(value: string): string {
  return [...value]
    .map((char) => {
      const code = char.charCodeAt(0);
      return code < 32 || code === 127 ? " " : char;
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

export function renderChannelContext(result: ChannelContextLoadResult): string {
  if (result.files.length === 0) return "";

  const chunks = ["# Channel Context", ""];
  for (const file of result.files) {
    const headerParts = [sanitizeContextHeader(file.path)];
    if (file.reason !== undefined && file.reason.trim().length > 0) {
      headerParts.push(`reason: ${sanitizeContextHeader(file.reason)}`);
    }
    chunks.push(`=== ${headerParts.join(" | ")} ===`);
    chunks.push(file.content);
    chunks.push("");
  }

  return `${chunks.join("\n").trimEnd()}\n`;
}
