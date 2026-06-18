export const CHANNEL_EVENT_KINDS = [
  "created",
  "message",
  "spawned",
  "progress",
  "done",
  "error",
  "interrupt_requested",
  "interrupted",
  "killed",
  "supervisor_warning",
  "context",
] as const;

export type ChannelEventKind = (typeof CHANNEL_EVENT_KINDS)[number];

export type ChannelTarget = string | string[];

export interface ChannelEventBase {
  seq: number;
  ts: string;
  kind: ChannelEventKind;
  by: string;
}

export interface CreatedChannelEvent extends ChannelEventBase {
  kind: "created";
  cwd: string;
  channelType: "chat" | "forum";
  task?: string;
  labels?: string[];
  description?: string;
}

export interface MessageChannelEvent extends ChannelEventBase {
  kind: "message";
  text: string;
  to?: ChannelTarget;
}

export interface SpawnedChannelEvent extends ChannelEventBase {
  kind: "spawned";
  as: string;
  provider: string;
  pid?: number;
  files?: string[];
  manifests?: string[];
}

export interface ProgressChannelEvent extends ChannelEventBase {
  kind: "progress";
  message: string;
  to?: ChannelTarget;
}

export interface DoneChannelEvent extends ChannelEventBase {
  kind: "done";
  text?: string;
  to?: ChannelTarget;
}

export interface ErrorChannelEvent extends ChannelEventBase {
  kind: "error";
  message: string;
  provider?: string;
  detail?: unknown;
}

export interface InterruptRequestedChannelEvent extends ChannelEventBase {
  kind: "interrupt_requested";
  to: string;
  reason?: string;
}

export interface InterruptedChannelEvent extends ChannelEventBase {
  kind: "interrupted";
  to: string;
  reason?: string;
  outcome?: "interrupted" | "no-active-worker";
}

export interface KilledChannelEvent extends ChannelEventBase {
  kind: "killed";
  to: string;
  reason?: string;
  signal?: string;
}

export interface SupervisorWarningChannelEvent extends ChannelEventBase {
  kind: "supervisor_warning";
  message: string;
  to?: ChannelTarget;
}

export interface ContextChannelEvent extends ChannelEventBase {
  kind: "context";
  action: "add" | "delete" | "list" | "clear";
  path?: string;
  text?: string;
}

export type ChannelEvent =
  | CreatedChannelEvent
  | MessageChannelEvent
  | SpawnedChannelEvent
  | ProgressChannelEvent
  | DoneChannelEvent
  | ErrorChannelEvent
  | InterruptRequestedChannelEvent
  | InterruptedChannelEvent
  | KilledChannelEvent
  | SupervisorWarningChannelEvent
  | ContextChannelEvent;

type Draft<T extends ChannelEvent> = Omit<T, "seq" | "ts"> & { ts?: string };

export type AppendableChannelEvent =
  | Draft<CreatedChannelEvent>
  | Draft<MessageChannelEvent>
  | Draft<SpawnedChannelEvent>
  | Draft<ProgressChannelEvent>
  | Draft<DoneChannelEvent>
  | Draft<ErrorChannelEvent>
  | Draft<InterruptRequestedChannelEvent>
  | Draft<InterruptedChannelEvent>
  | Draft<KilledChannelEvent>
  | Draft<SupervisorWarningChannelEvent>
  | Draft<ContextChannelEvent>;

export interface ChannelPathOptions {
  cwd?: string;
  project?: string;
}
