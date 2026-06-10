/* global process */
/**
 * Polygon Workflow State Injection Plugin
 *
 * Per-turn UserPromptSubmit equivalent for OpenCode.
 *
 * On every chat.message, if a Polygon task is active, inject a short
 * <workflow-state> breadcrumb reminding the main AI what task is
 * active and its expected flow. Breadcrumb text is pulled exclusively
 * from the project's workflow.md [workflow-state:STATUS] tag blocks —
 * workflow.md is the single source of truth. There are no fallback
 * tables in this plugin: when workflow.md is missing or a tag is
 * absent, the breadcrumb degrades to a generic
 * "Refer to workflow.md for current step." line so users see (and fix)
 * the broken state instead of the plugin silently masking it.
 *
 * Unlike session-start, this plugin does NOT dedupe — the breadcrumb
 * should surface on every turn so long conversations don't drift.
 *
 * Silently skips when:
 *   - No .polygon/ directory
 *   - No active task in the session runtime context
 *   - task.json malformed or missing status
 */

import { existsSync, readFileSync } from "fs"
import { join } from "path"
import { PolygonContext, debugLog, isPolygonSubagent } from "../lib/polygon-context.js"

// Supports STATUS values with letters, digits, underscores, hyphens
// (so "in-review" / "blocked-by-team" work alongside "in_progress").
const TAG_RE = /\[workflow-state:([A-Za-z0-9_-]+)\]\s*\n([\s\S]*?)\n\s*\[\/workflow-state:\1\]/g

/**
 * Parse workflow.md for [workflow-state:STATUS] blocks.
 *
 * Returns {status: body}. workflow.md is the single source of truth —
 * there are no fallback tables here. Missing tags (or a missing /
 * unreadable workflow.md) fall back to a generic line in
 * buildBreadcrumb so users see the broken state and fix workflow.md
 * rather than the plugin silently masking it.
 */
function loadBreadcrumbs(directory) {
  const workflowPath = join(directory, ".polygon", "workflow.md")
  if (!existsSync(workflowPath)) return {}
  let content
  try {
    content = readFileSync(workflowPath, "utf-8")
  } catch {
    return {}
  }
  const result = {}
  for (const match of content.matchAll(TAG_RE)) {
    const status = match[1]
    const body = match[2].trim()
    if (body) result[status] = body
  }
  return result
}

/**
 * Minimal .polygon/config.yaml reader for the ultracode flag.
 *
 * The repo's YAML is hand-parsed by polygon_config.py without boolean coercion,
 * so `enabled: true` may be stored as the string "true". We accept the string
 * forms ("true"/"yes"/"on"/"1") as well as a bare boolean. Anything else
 * (missing file/block, false, malformed) → false. Scans only the top-level
 * `ultracode:` block's `enabled:` child; no full YAML parse needed.
 */
function isUltracodeEnabled(directory) {
  const configPath = join(directory, ".polygon", "config.yaml")
  if (!existsSync(configPath)) return false
  let content
  try {
    content = readFileSync(configPath, "utf-8")
  } catch {
    return false
  }
  let inUltracode = false
  for (const raw of content.split("\n")) {
    const line = raw.replace(/\s+#.*$/, "") // strip " # ..." inline comment
    if (/^\s*#/.test(line) || !line.trim()) continue
    const indent = line.length - line.trimStart().length
    if (indent === 0) {
      inUltracode = /^ultracode\s*:/.test(line.trim())
      continue
    }
    if (inUltracode) {
      const m = line.trim().match(/^enabled\s*:\s*(.+)$/)
      if (m) {
        const v = m[1].trim().replace(/^['"]|['"]$/g, "").toLowerCase()
        return v === "true" || v === "yes" || v === "on" || v === "1"
      }
    }
  }
  return false
}

/**
 * Pick the breadcrumb tag key. The OpenCode plugin layer is always OpenCode
 * (never codex), so there is no codex dispatch-mode branch here. When ultracode
 * is enabled in config.yaml, serve the `${status}-ultra` breadcrumb variant —
 * buildBreadcrumb falls back to the plain `${status}` tag if no -ultra block
 * exists, so only planning/in_progress need ultra bodies.
 */
function resolveBreadcrumbKey(status, directory) {
  if (isUltracodeEnabled(directory)) {
    return `${status}-ultra`
  }
  return status
}

/**
 * Get (taskId, status) from active task, or null if no active task.
 */
function getActiveTask(ctx, platformInput = null) {
  const active = ctx.getActiveTask(platformInput)
  const taskRef = active.taskPath
  if (!taskRef) return null
  const taskDir = ctx.resolveTaskDir(taskRef)
  if (active.stale || !taskDir || !existsSync(taskDir)) {
    return { id: taskRef.split("/").pop(), status: "stale", source: active.source }
  }
  const taskJsonPath = join(taskDir, "task.json")
  if (!existsSync(taskJsonPath)) return null
  try {
    const data = JSON.parse(readFileSync(taskJsonPath, "utf-8"))
    const status = typeof data.status === "string" ? data.status : ""
    if (!status) return null
    const id = data.id || taskRef.split("/").pop()
    return { id, status, source: active.source }
  } catch {
    return null
  }
}

/**
 * Build the <workflow-state>...</workflow-state> block.
 * - Known status (tag present in workflow.md) → detailed body
 * - Unknown status (no tag, or workflow.md missing) → generic
 *   "Refer to workflow.md for current step." line
 * - no_task pseudo-status (id === null) → header omits task info
 */
function buildBreadcrumb(id, status, templates, source = null, breadcrumbKey = null) {
  const lookupKey = breadcrumbKey || status
  let body = templates[lookupKey]
  if (body === undefined && lookupKey !== status) {
    body = templates[status]
  }
  if (body === undefined) {
    body = "Refer to workflow.md for current step."
  }
  let header = id === null ? `Status: ${status}` : `Task: ${id} (${status})`
  if (source) {
    header = `${header}\nSource: ${source}`
  }
  return `<workflow-state>\n${header}\n${body}\n</workflow-state>`
}

// OpenCode 1.2.x expects plugins to be factory functions (see inject-subagent-context.js comment).
export default async ({ directory }) => {
  const ctx = new PolygonContext(directory)
  debugLog("workflow-state", "Plugin loaded, directory:", directory)

  return {
      // chat.message fires on every user message. Inject breadcrumb in-place
      // so it persists in conversation history.
      "chat.message": async (input, output) => {
        try {
          // Skip Polygon sub-agent turns — the per-turn breadcrumb is for the
          // main session only; sub-agent context comes from the parent's
          // tool.execute.before injection.
          if (isPolygonSubagent(input)) {
            debugLog("workflow-state", "Skipping polygon subagent turn:", input?.agent)
            return
          }
          if (process.env.POLYGON_HOOKS === "0" || process.env.POLYGON_DISABLE_HOOKS === "1") {
            return
          }
          if (process.env.OPENCODE_NON_INTERACTIVE === "1") {
            return
          }
          if (!ctx.isPolygonProject()) {
            return
          }
          const templates = loadBreadcrumbs(directory)
          const task = getActiveTask(ctx, input)
          const breadcrumb = task
            ? buildBreadcrumb(
                task.id,
                task.status,
                templates,
                task.source,
                resolveBreadcrumbKey(task.status, directory),
              )
            : buildBreadcrumb(
                null,
                "no_task",
                templates,
                null,
                resolveBreadcrumbKey("no_task", directory),
              )

          const parts = output?.parts || []
          const textPartIndex = parts.findIndex(
            p => p.type === "text" && p.text !== undefined,
          )
          if (textPartIndex !== -1) {
            const originalText = parts[textPartIndex].text || ""
            parts[textPartIndex].text = `${breadcrumb}\n\n${originalText}`
          } else {
            parts.unshift({ type: "text", text: breadcrumb })
          }
          debugLog(
            "workflow-state",
            "Injected breadcrumb for task",
            task ? task.id : "none",
            "status",
            task ? task.status : "no_task",
          )
        } catch (error) {
          debugLog(
            "workflow-state",
            "Error in chat.message:",
            error instanceof Error ? error.message : String(error),
          )
        }
      },
  }
}
