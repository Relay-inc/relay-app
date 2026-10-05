// the app's icons: Hugeicons' free stroke-rounded set, the one bb uses. Each icon is data: ui/components/Icon.tsx draws
// it as SVG elements, `iconPaths` as markup for the HTML the app builds itself (markdown's copy button). Stroke and its
// width are left to the CSS, so a row can colour its glyph the way it did with the hand-drawn ones
import {
  Notification01Icon,
  ServerStack01Icon,
  LeftToRightListBulletIcon,
  Message01Icon,
  ComputerTerminal01Icon,
  Settings01Icon,
  Folder01Icon,
  SquareTerminalIcon,
  Note01Icon,
  GithubIcon,
  DashboardSpeed01Icon,
  Tick02Icon,
  Copy01Icon,
  Calendar03Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  GitPullRequestIcon,
  Mail01Icon,
  Cancel01Icon,
  MailOpen01Icon,
  TextAlignLeftIcon,
  Image01Icon,
  MailReply01Icon,
  Archive02Icon,
  Delete02Icon,
  Plug01Icon,
  Search01Icon,
  ArrowUp02Icon,
  BotIcon,
  ImageUploadIcon,
  ImageNotFound01Icon,
  RefreshIcon,
  MoreHorizontalIcon,
  PencilEdit02Icon,
  ArrowDown01Icon,
  Sun03Icon,
  Moon02Icon,
  File01Icon,
  Add01Icon,
  Bookmark01Icon,
  FilterHorizontalIcon,
  ArrowUpRight01Icon,
  KanbanIcon,
  ListViewIcon,
  DashboardSquare01Icon,
  WorkflowSquare01Icon,
  Mic01Icon,
} from "@hugeicons/core-free-icons";

/** One SVG element: its tag and its attributes, camelCase as React takes them. */
type Shape = readonly [string, Readonly<Record<string, string | number>>];
type Icon = readonly Shape[];

const ICONS: Record<string, Icon> = {
  bell: Notification01Icon,
  list: LeftToRightListBulletIcon,
  chat: Message01Icon,
  term: ComputerTerminal01Icon,
  drawerTerm: SquareTerminalIcon,
  notes: Note01Icon,
  github: GithubIcon,
  gear: Settings01Icon,
  folder: Folder01Icon,
  gauge: DashboardSpeed01Icon,
  check: Tick02Icon,
  copy: Copy01Icon,
  cal: Calendar03Icon,
  left: ArrowLeft01Icon,
  right: ArrowRight01Icon,
  pr: GitPullRequestIcon,
  mail: Mail01Icon,
  close: Cancel01Icon,
  read: MailOpen01Icon,
  text: TextAlignLeftIcon,
  html: Image01Icon,
  reply: MailReply01Icon,
  archive: Archive02Icon,
  trash: Delete02Icon,
  talk: Message01Icon,
  plug: Plug01Icon,
  server: ServerStack01Icon,
  search: Search01Icon,
  send: ArrowUp02Icon,
  agent: BotIcon,
  upload: ImageUploadIcon,
  none: ImageNotFound01Icon,
  refresh: RefreshIcon,
  more: MoreHorizontalIcon,
  compose: PencilEdit02Icon,
  chevron: ArrowDown01Icon,
  sun: Sun03Icon,
  moon: Moon02Icon,
  file: File01Icon,
  edit: PencilEdit02Icon,
  add: Add01Icon,
  down: ArrowDown01Icon,
  bookmark: Bookmark01Icon,
  filter: FilterHorizontalIcon,
  out: ArrowUpRight01Icon,
  plus: Add01Icon,
  kanban: KanbanIcon,
  rows: ListViewIcon,
  board: DashboardSquare01Icon,
  workflow: WorkflowSquare01Icon,
  mic: Mic01Icon,
};
// the attributes without React's key and the stroke settings the CSS owns
const own = ([tag, attrs]: Shape): Shape => [
  tag,
  Object.fromEntries(Object.entries(attrs).filter(([name]) => name !== "key" && !name.startsWith("stroke"))),
];
const solid = { fill: "currentColor", stroke: "none" };
const EXTRA: Record<string, Icon> = {
  // unread: the envelope with a solid dot in its corner
  unread: [...Mail01Icon.map(own), ["circle", { cx: "19.5", cy: "5", r: "3.2", ...solid }]],
  stop: [["rect", { x: "6", y: "6", width: "12", height: "12", rx: "2", ...solid }]],
};

/** The shapes of an icon on the 24×24 grid. */
export const iconShapes = (name: string): readonly Shape[] => EXTRA[name] ?? (ICONS[name] ?? []).map(own);
const kebab = (name: string) => name.replace(/[A-Z]/g, char => "-" + char.toLowerCase());
/** An icon's inner markup on the 24×24 grid: built from Hugeicons' data, so trusted. */
export const iconPaths = (name: string) =>
  iconShapes(name)
    .map(
      ([tag, attrs]) =>
        `<${tag} ${Object.entries(attrs)
          .map(([key, value]) => `${kebab(key)}="${value}"`)
          .join(" ")}/>`,
    )
    .join("");

/** Only an image data url becomes an <img>. */
export const isImg = (url?: string | null): url is string =>
  !!url && /^data:image\/(png|jpeg|gif|webp|svg\+xml|x-icon);base64,[A-Za-z0-9+/=]+$/.test(url);
