import type { Locales } from "./i18n";

// The contract a task tracker implements to show as a board in the sidebar (see README, "Integrations").
// Two levels pick a board: a project (Productive project, Trello workspace, Linear team) and a board in it
// (Productive board, Trello board, Linear project or the team itself). The backend half of a provider is the
// Rust crate in the same package (a board_core::Provider): the allowed calls and the token, which never
// reaches the webview. `K` is the provider's own string keys (its locales.ts).

export type Opt = { id: string; name: string };
/** A column: a Productive task list, a Trello list, a Linear workflow state. */
export type Column = { id: string; name: string; placement: number;
  /** what the column means when it is a workflow status (Productive statuses, Linear states): draws its ring */
  state?: State };
/** The broad kind of a workflow status: not started, in progress, finished. */
export type State = "todo" | "doing" | "done";
/** A card in a column. `number` is shown as #number (as it is when not only digits, Linear's ENG-12), `who` is the
 * assignee's first name, `due` is yyyy-mm-dd, `priority` Linear's scale: 1 urgent to 4 low, 0 or absent none. */
export type Card = { id: string; title: string; number: string; column: string; placement: number; due: string | null; who: string; priority?: number;
  /** its column in each grouping but the first (`column`): Productive's { status: workflow status id } */
  in?: Record<string, string>;
  /** What the tracker knows beyond the column, all optional (a provider fills what it has; the board hides what no card has):
   *  its workflow status (name and kind), the folder (Productive board) and task list it sits in, labels, and the last update as an ISO time. */
  status?: string; state?: State; folder?: string; list?: string; labels?: string[]; updated?: string };
/** A card for the ticket window, in a shape every provider's detail can fill: the app draws it, the provider only maps. `description` and the feed's `html` are sanitised HTML. */
export type CardView = {
  title: string; number: string; closed: boolean; url: string;
  board: string; list: string; project: string; created: string; creator: string;
  description: string;
  status?: { id: string; name: string; state?: State };
  assignee?: { id: string; name: string };
  /** Trello supports multiple members. Changes add/remove one member, preserving everyone else. */
  assignees?: Opt[];
  due: string; labels: string[];
  /** the choices for the status and assignee pickers, once known; without them those two show as text */
  statuses?: Opt[]; people?: Opt[];
  files: { id: string; name: string; size: number; url: string }[] | null;
  feed: { at: string; who: string; html: string; change: string; files: { id: string; name: string; size: number; url: string }[] }[];
};
/** A way to lay out the columns, when a provider has more than one: Productive's task lists or workflow statuses. */
export type Grouping<K extends string = string> = { id: string; label: K };
/** A card's values a board filters on, per facet (names, as the cards carry them; `who` is the first name). */
export type ViewFilters = Partial<Record<"state" | "status" | "who" | "folder" | "list" | "label", string[]>>;
/** A view saved in the tracker (Productive's saved views), offered next to the app's own presets. `filters` is null
 * when it asks for something the board can't filter on; `group` is the grouping it lays the columns out by, `layout`
 * how it shows (absent: one the board doesn't have, the board stays as it is). */
export type View = { id: string; name: string; filters: ViewFilters | null; group?: string; layout?: "kanban" | "list" };
/** Which board a vault project maps to, settings.boards[vault project]. */
export type BoardRef = { provider: string; project: string; board: string };

/** What a provider gets for each call: its settings.integrations.<id>, and one API call through the backend. */
export type Ctx = { config: Record<string, any>; call: (method: string, path: string, body?: unknown) => Promise<any>;
  /** Upload to a backend-allowed URL. `fields` are Productive form fields, Linear signed headers, or empty for Trello.
   * Authentication and transport are selected by the backend; secrets never come from the webview. */
  upload: (url: string, fields: Record<string, string>, file: File) => Promise<string> };

/** A card's detail, optional: without it a click opens the card in the browser. Data only: the app draws the ticket
 * window from `view` (ui/features/board), the package knows no UI framework. */
export interface CardDetail<D = any> {
  /** what a background load already has, so the window opens at once */
  cached(id: string): D | undefined;
  fetch(ctx: Ctx, ref: BoardRef, id: string): Promise<D>;
  /** The card as the ticket window shows it, made when it is drawn (strings in the language of that moment). */
  view(d: D): CardView;
  /** An action from the window, resolves with the card as it is now: "status" or "assignee" with the picked id,
   * "member-add"/"member-remove" with a person id, "comment" with the composer's text, "attach" with picked files. */
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
  /** a 16×16 SVG body in the product's own colours, for the settings list */
  glyph: string;
  /** a 24×24 monochrome SVG body for the sidebar, like the app's own icons: stroke and its width come from the CSS */
  mark: string;
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
  /** The board's saved views in the tracker, read only. */
  views?(ctx: Ctx, ref: BoardRef): Promise<View[]>;
  /** The card's page in the tracker's web app. */
  url(ctx: Ctx, ref: BoardRef, card: string): Promise<string>;
  detail?: CardDetail;
  /** drop caches: new credentials or a new language */
  reset?(): void;

  settings: {
    fields: Field<K>[];
    tokenLabel: K;
    help: K;
    /** The tracker's page that hands out a token, from the secrets typed so far (Trello: its authorize page for the API
     *  key); undefined while what it needs is missing. Settings shows a button next to the token that opens it. */
    tokenUrl?(secrets: Record<string, string>): string | undefined;
    /** What is wrong with the secrets as typed (an empty one keeps the stored value), checked before Save: a key in
     *  `strings`, or undefined. */
    check?(secrets: Record<string, string>): K | undefined;
    /** One call that shows token and config work together, resolves with the message to show. */
    test(ctx: Ctx): Promise<string>;
    /** Every board the user can open, when the API gives them in one call: Settings then maps boards to vault projects. */
    allBoards?(ctx: Ctx): Promise<BoardOpt[]>;
    /** Take token and config from elsewhere (Productive: Claude Code's MCP config), resolves with the config fields to save. */
  };
}
