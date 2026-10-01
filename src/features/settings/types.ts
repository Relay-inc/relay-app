// the settings as the backend keeps them: one type for both windows
import type { Settings } from "../../domain/config";
export type { Settings, MailAcct, MailCfg, CalendarCfg, AgentCfg } from "../../domain/config";
/** A template to render, or text. */
export type Renderable = unknown;
export type Message = { text: string; ok: boolean };
/** What a page asks its container to save: the settings, and the message to show when it worked. */
export type SaveSettings = { settings: Settings; done: string };
