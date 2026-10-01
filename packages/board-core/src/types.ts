import type { TemplateResult } from "lit";
import type { Locales } from "./i18n";

// The contract a task tracker implements to show as a board in the sidebar (see README, "Integrations").
// Two levels pick a board: a project (Productive project, Trello workspace, Linear team) and a board in it
// (Productive board, Trello board, Linear project or the team itself). The backend half of a provider is the
// Rust crate in the same package (a board_core::Provider): the allowed calls and the token, which never
// reaches the webview. `K` is the provider's own string keys (its locales.ts).

export type Opt = { id: string; name: string };
/** A column: a Productive task list, a Trello list, a Linear workflow state. */
export type Column = { id: string; name: string; placement: number };
/** A card in a column. `number` is shown as #number (as it is when not only digits, Linear's ENG-12), `who` is the
 * assignee's first name, `due` is yyyy-mm-dd, `priority` Linear's scale: 1 urgent to 4 low, 0 or absent none. */
export type Card = { id: string; title: string; number: string; column: string; placement: number; due: string | null; who: string; priority?: number;
  /** its column in each grouping but the first (`column`): Productive's { status: workflow status id } */
  in?: Record<string, string> };
/** A way to lay out the columns, when a provider has more than one: Productive's task lists or workflow statuses. */
export type Grouping<K extends string = string> = { id: string; label: K };
/** Which board a vault project maps to, settings.boards[vault project]. */
export type BoardRef = { provider: string; project: string; board: string };

/** What a provider gets for each call: its settings.integrations.<id>, and one API call through the backend. */
export type Ctx = { config: Record<string, any>; call: (method: string, path: string, body?: unknown) => Promise<any>;
  /** a file posted as a form to a URL the backend's `upload` allows (no secrets go along), resolves with its Location */
  upload: (url: string, fields: Record<string, string>, file: File) => Promise<string> };

/** The right panel for one card, optional: without it a click opens the card in the browser. */
export interface CardDetail<D = any> {
  /** what a background load already has, so the panel opens at once */
  cached(id: string): D | undefined;
  fetch(ctx: Ctx, ref: BoardRef, id: string): Promise<D>;
  /** A template in the PR detail's classes. Its close button fires a bubbling, composed "detail-close" event (the panel closes on it). */
  render(d: D | null, err: string): TemplateResult;
  /** An action from the panel, resolves with the card as it is now. The template asks for one with a bubbling, composed
   * "detail-act" event, detail `{ action, value, files }`: a picker's value or the composer's text, and picked or dropped files. */
  act?(ctx: Ctx, ref: BoardRef, id: string, action: string, input: { value: string; files: File[] }): Promise<D>;
}

/** A field of the provider's config in Settings › Integrations, stored as integrations.<id>.<key> (a string).
 * `secret`: a password field kept in the keychain under that key (Trello's API key), never in the settings.
 * `check`: a checkbox stored as a boolean, `placeholder` is its text. */
export type Field<K extends string = string> = { key: string; label: K; placeholder?: K; numeric?: boolean; optional?: boolean; secret?: boolean; check?: boolean };
/** A board with the project it is in, for picking one in Settings without going level by level. */
export type BoardOpt = Opt & { project: string; group: string };

export interface BoardProvider<K extends string = string> {
  /** the key in settings.integrations and in the backend's PROVIDERS, e.g. "productive" */
  id: string;
  /** the product's name, not translated */
  name: string;
  /** a 16×16 SVG body for the sidebar row and the settings list */
  glyph: string;
  /** its UI strings in every language, which the app keeps as <id>.<key> */
  strings: Locales<K>;

  projects(ctx: Ctx): Promise<Opt[]>;
  boards(ctx: Ctx, project: string): Promise<Opt[]>;
  /** the groupings it offers, the first is the default (the cards' `column`) */
  groupings?: Grouping<K>[];
  columns(ctx: Ctx, ref: BoardRef, group?: string): Promise<Column[]>;
  cards(ctx: Ctx, ref: BoardRef): Promise<Card[]>;
  /** Move the card to another column, in the tracker right away. Resolves with the new placement when the API gives one. */
  move(ctx: Ctx, ref: BoardRef, card: Card, to: string, group?: string): Promise<number | void>;
  /** The card's page in the tracker's web app. */
  url(ctx: Ctx, ref: BoardRef, card: string): Promise<string>;
  detail?: CardDetail;
  /** drop caches: new credentials or a new language */
  reset?(): void;

  settings: {
    fields: Field<K>[];
    tokenLabel: K;
    help: K;
    /** One call that shows token and config work together, resolves with the message to show. */
    test(ctx: Ctx): Promise<string>;
    /** Every board the user can open, when the API gives them in one call: Settings then maps boards to vault projects. */
    allBoards?(ctx: Ctx): Promise<BoardOpt[]>;
    /** Take token and config from elsewhere (Productive: Claude Code's MCP config), resolves with the config fields to save. */
  };
}
