export const CHANNEL_PROVIDERS = ["shell", "claude", "codex"] as const;

export type ChannelProvider = (typeof CHANNEL_PROVIDERS)[number];

export interface ShellProviderConfig {
  provider: "shell";
  command: string;
  args: string[];
  stdin?: boolean;
}

export interface AgentProviderConfig {
  provider: "claude" | "codex";
  command: string;
  args: string[];
  stdin: boolean;
}

export type ChannelProviderConfig = ShellProviderConfig | AgentProviderConfig;

export interface WorkerPromptView {
  channel: string;
  worker: string;
  project?: string;
  task?: string;
  contextText?: string;
}

export interface ProviderSpawnSpec {
  command: string;
  args: string[];
  stdin: boolean;
  initialInput?: string;
}

export function parseChannelProvider(value: string | undefined): ChannelProvider {
  const provider = value ?? "shell";
  if (CHANNEL_PROVIDERS.includes(provider as ChannelProvider)) {
    return provider as ChannelProvider;
  }
  throw new Error(
    `Unknown channel provider '${provider}' (expected ${CHANNEL_PROVIDERS.join(", ")})`,
  );
}

export function buildShellProviderConfig(
  command: string | undefined,
  args: string | undefined,
  stdin?: boolean,
): ShellProviderConfig {
  if (command === undefined || command.trim().length === 0) {
    throw new Error("--command is required for --provider shell");
  }
  return {
    provider: "shell",
    command,
    args: args === undefined || args.trim().length === 0 ? [] : parseArgs(args),
    stdin,
  };
}

export function buildAgentProviderConfig(
  provider: "claude" | "codex",
  command: string | undefined,
  args: string | undefined,
  stdin?: boolean,
): AgentProviderConfig {
  const normalizedCommand = command?.trim();
  return {
    provider,
    command:
      normalizedCommand !== undefined && normalizedCommand.length > 0
        ? normalizedCommand
        : defaultAgentCommand(provider),
    args: args === undefined || args.trim().length === 0 ? [] : parseArgs(args),
    stdin: stdin ?? true,
  };
}

export function buildWorkerPrompt(view: WorkerPromptView): string {
  const chunks = [
    "# Polygon Channel Worker",
    "",
    `You are worker '${sanitizePromptField(view.worker)}' in channel '${sanitizePromptField(view.channel)}'.`,
    view.project !== undefined
      ? `Project: ${sanitizePromptField(view.project)}`
      : undefined,
    view.task !== undefined ? `Task: ${sanitizePromptField(view.task)}` : undefined,
    "",
    "Rules:",
    "- Stay within the assigned task and channel.",
    "- Do not spawn additional workers unless the main session explicitly asks.",
    "- Do not run git commit, push, merge, amend, or archive operations.",
    "- Report progress or final results through the channel when possible.",
    "- Exit with code 0 when the assignment is complete; exit non-zero on failure.",
  ].filter((item): item is string => item !== undefined);

  if (view.contextText !== undefined && view.contextText.trim().length > 0) {
    chunks.push("", view.contextText.trimEnd());
  }

  return `${chunks.join("\n")}\n`;
}

export function buildProviderSpawnSpec(
  config: ChannelProviderConfig,
  prompt: string | undefined,
): ProviderSpawnSpec {
  if (config.provider === "shell") {
    return {
      command: config.command,
      args: config.args,
      stdin: config.stdin === true,
    };
  }

  return {
    command: config.command,
    args: config.args,
    stdin: config.stdin,
    initialInput: prompt,
  };
}

function defaultAgentCommand(provider: "claude" | "codex"): string {
  return provider;
}

function sanitizePromptField(value: string): string {
  return [...value]
    .map((char) => {
      const code = char.charCodeAt(0);
      return code < 32 || code === 127 ? " " : char;
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

function parseArgs(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}
