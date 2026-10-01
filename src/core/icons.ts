import { html, nothing } from "lit";
import { unsafeSVG } from "lit/directives/unsafe-svg.js";

// the app's icons: Hugeicons' free stroke-rounded set, the one bb uses. Each icon is data, drawn here as SVG markup;
// stroke and its width are left to the CSS, so a row can colour its glyph the way it did with the hand-drawn ones
import {
  Notification01Icon,
  LeftToRightListBulletIcon,
  Message01Icon,
  ComputerTerminal01Icon,
  Settings01Icon,
  Folder01Icon,
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
  Plug01Icon,
  Search01Icon,
  ArrowUp02Icon,
  BotIcon,
  ImageUploadIcon,
  ImageNotFound01Icon,
  RefreshIcon,
  MoreHorizontalIcon,
} from "@hugeicons/core-free-icons";

type Icon = readonly (readonly [string, Readonly<Record<string, string | number>>])[];
const kebab = (name: string) => name.replace(/[A-Z]/g, char => "-" + char.toLowerCase());
// the attributes of one element, without React's key and the stroke settings the CSS owns
const attributes = (attrs: Readonly<Record<string, string | number>>) =>
  Object.entries(attrs)
    .filter(([name]) => name !== "key" && !name.startsWith("stroke"))
    .map(([name, value]) => `${kebab(name)}="${value}"`)
    .join(" ");
const draw = (icon: Icon) => icon.map(([tag, attrs]) => `<${tag} ${attributes(attrs)}/>`).join("");

const ICONS: Record<string, Icon> = {
  bell: Notification01Icon,
  list: LeftToRightListBulletIcon,
  chat: Message01Icon,
  term: ComputerTerminal01Icon,
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
  talk: Message01Icon,
  plug: Plug01Icon,
  search: Search01Icon,
  send: ArrowUp02Icon,
  agent: BotIcon,
  upload: ImageUploadIcon,
  none: ImageNotFound01Icon,
  refresh: RefreshIcon,
  more: MoreHorizontalIcon,
};
const extra: Record<string, string> = {
  // unread: the envelope with a solid dot in its corner
  unread: draw(Mail01Icon) + '<circle cx="19.5" cy="5" r="3.2" fill="currentColor" stroke="none"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none"/>',
};

// inner markup on the 24×24 grid: built here from Hugeicons' data, so trusted
export const iconPaths = (name: string) => extra[name] ?? draw(ICONS[name]);
export const icon = (name: string, cls = "glyph") =>
  html`<svg class=${cls} viewBox="0 0 24 24" aria-hidden="true">${unsafeSVG(iconPaths(name))}</svg>`;
/** A provider's own 16×16 glyph (a package's static SVG body). `cls` sizes it: the `glyph` utility only sets fill and stroke. */
export const glyphSvg = (body: string, cls = "glyph", box = "0 0 16 16") =>
  html`<svg class=${cls} viewBox=${box} aria-hidden="true">${unsafeSVG(body)}</svg>`;

/** Only an image data url becomes an <img>. */
export const isImg = (url?: string | null): url is string =>
  !!url && /^data:image\/(png|jpeg|gif|webp|svg\+xml|x-icon);base64,[A-Za-z0-9+/=]+$/.test(url);
// the project image in a row, the size of a glyph
export const iconImg = (
  url?: string | null,
  cls = "w-[15px] h-[15px] flex-none object-contain rounded-[3px] align-[-2px] mr-1.5",
) => (isImg(url) ? html`<img class=${cls} src=${url} alt="" />` : nothing);
