import { useEffect, useRef, useState, type ClipboardEvent, type ReactNode } from "react";
import { removeProperty, setProperty } from "../../../domain/workspace/properties";
import { coverOf, emojiOf, pageIcon } from "../../../domain/workspace/decor";
import type { ProjectIcon } from "../../../domain/workspace/types";
import { embedOf, embedUrl, pasteAttachments, pickAttachments } from "../../../application/navigation/embeds";
import { isImg } from "../../../shared/icons";
import { useDismiss } from "../../hooks/useDismiss";
import { useT } from "../../hooks/useT";
import { Icon } from "../../components/Icon";
import { ProjectImg } from "../../components/ProjectImg";
import { isFinderPaste } from "./embeds";
import { PageHeader } from "./PageHeader";

/** The page header (PageHeader) with the page's icon and cover (issue 424): the cover's banner above it, the icon the
 *  note's `icon:` emoji, else its project's icon, else the file glyph (`pageIcon`); hovering offers Add icon and Add cover
 *  for what is missing. Both are frontmatter keys, so each change goes to `onChange` like any property. */
export function PageTop({
  page,
  project,
  title,
  yaml,
  onChange,
  children,
}: {
  page: string;
  project?: ProjectIcon;
  title: string;
  yaml: string;
  onChange: (yaml: string) => void;
  children?: ReactNode;
}) {
  const { t } = useT();
  const [open, setOpen] = useState<"icon" | "cover" | null>(null);
  const shown = pageIcon(yaml, project);
  const own = !!shown && "emoji" in shown;
  const cover = coverOf(yaml);
  const src = useCover(page, cover);
  const set = (key: string, value: string | null) =>
    onChange(value === null ? removeProperty(yaml, key) : setProperty(yaml, key, value));
  const close = () => setOpen(null);
  const coverPopover = (align: string) =>
    open === "cover" ? (
      <CoverPopover
        page={page}
        has={!!cover}
        align={align}
        set={name => set("cover", name && `[[${name}]]`)}
        onClose={close}
      />
    ) : null;
  return (
    <div className="group/top relative flex flex-col gap-3">
      {src ? (
        <Cover src={src}>
          <button
            className="h-6.5 px-2.5 rounded-md bg-raised text-xs text-label shadow-sm"
            aria-expanded={open === "cover"}
            onClick={() => setOpen(open === "cover" ? null : "cover")}
          >
            {t("header.changeCover")}
          </button>
          {coverPopover("right-0")}
        </Cover>
      ) : null}
      {!own || !src ? (
        <div
          className={`absolute left-0 -top-8 h-6 flex items-center gap-1 text-xs text-tertiary transition-opacity ${
            open ? "opacity-100" : "opacity-0 group-hover/top:opacity-100 focus-within:opacity-100"
          }`}
        >
          {own ? null : (
            <button
              className="h-6 flex items-center gap-1.5 px-1.5 rounded-md hover:bg-fill hover:text-label"
              onClick={() => setOpen("icon")}
            >
              <Icon name="add" className="glyph size-3" />
              {t("header.addIcon")}
            </button>
          )}
          {src ? null : (
            <span className="relative">
              <button
                className="h-6 flex items-center gap-1.5 px-1.5 rounded-md hover:bg-fill hover:text-label"
                aria-expanded={open === "cover"}
                onClick={() => setOpen(open === "cover" ? null : "cover")}
              >
                <Icon name="add" className="glyph size-3" />
                {t("header.addCover")}
              </button>
              {coverPopover("left-0")}
            </span>
          )}
        </div>
      ) : null}
      <PageHeader
        icon={
          <span className="relative size-full">
            <button
              className="size-full grid place-items-center rounded-lg hover:bg-fill"
              aria-label={t("header.icon")}
              aria-expanded={open === "icon"}
              onClick={() => setOpen(open === "icon" ? null : "icon")}
            >
              {shown && "emoji" in shown ? (
                <span className="text-2xl leading-none">{shown.emoji}</span>
              ) : shown && isImg(shown.project.img) ? (
                <ProjectImg url={shown.project.img} className="size-6 object-contain" />
              ) : shown?.project.icon ? (
                shown.project.icon
              ) : (
                <Icon name="file" className="glyph size-5 text-secondary" />
              )}
            </button>
            {open === "icon" ? <IconPopover has={own} set={emoji => set("icon", emoji)} onClose={close} /> : null}
          </span>
        }
        title={title}
        yaml={yaml}
        onChange={onChange}
      >
        {children}
      </PageHeader>
    </div>
  );
}

/** The picture `cover:` names as an address the webview loads; "" while it is asked for, and when it is missing or not
 *  a picture: then there is no banner at all, and the key stays. */
function useCover(page: string, name: string) {
  const key = `${page}\u001f${name}`;
  const [got, setGot] = useState({ key: "", src: "" });
  useEffect(() => {
    if (!name) return;
    let live = true;
    void embedOf(page, name).then(
      info => live && setGot({ key, src: info.kind === "image" && info.path ? embedUrl(info.path) : "" }),
    );
    return () => void (live = false);
  }, [page, name, key]);
  return name && got.key === key ? got.src : "";
}

/** The cover's banner; `children`: its controls, shown on hover. */
function Cover({ src, children }: { src: string; children: ReactNode }) {
  const [broken, setBroken] = useState("");
  if (broken === src) return null;
  return (
    <div data-page-cover className="group/cover relative h-40 flex-none">
      <img src={src} alt="" className="size-full object-cover rounded-xl" onError={() => setBroken(src)} />
      <div className="absolute right-2 bottom-2 flex items-center gap-1 opacity-0 group-hover/cover:opacity-100 focus-within:opacity-100 has-[[aria-expanded=true]]:opacity-100">
        {children}
      </div>
    </div>
  );
}

const POPOVER =
  "absolute z-20 top-full mt-1 w-60 p-2 flex flex-col gap-1.5 rounded-xl bg-raised border border-separator shadow-md text-[12.5px] text-label font-normal";

/** Set the icon: a field that takes one emoji (the macOS picker, ⌃⌘Space, types into it); Enter sets it, anything but
 *  one grapheme is refused with the hint. Remove drops the key. */
function IconPopover({
  has,
  set,
  onClose,
}: {
  has: boolean;
  set: (emoji: string | null) => void;
  onClose: () => void;
}) {
  const { t } = useT();
  const box = useRef<HTMLDivElement>(null);
  const [typed, setTyped] = useState("");
  const [refused, setRefused] = useState(false);
  useDismiss(box, true, onClose, { on: "pointerdown" });
  const apply = () => {
    const emoji = emojiOf(typed);
    if (!emoji) return setRefused(true);
    set(emoji);
    onClose();
  };
  return (
    <div ref={box} data-icon-popover className={`${POPOVER} left-0`}>
      <input
        autoFocus
        value={typed}
        aria-label={t("header.icon")}
        aria-invalid={refused || undefined}
        placeholder="🚀"
        className="h-8 w-full px-2 rounded-md bg-fill-2 text-lg outline-none"
        onChange={e => {
          setTyped(e.target.value);
          setRefused(false);
        }}
        onKeyDown={e => e.key === "Enter" && apply()}
      />
      <span className={refused ? "text-bad" : "text-tertiary"}>
        {t(refused ? "header.iconRefused" : "header.iconHint")}
      </span>
      {has ? (
        <button
          className="h-7 flex items-center gap-2 px-2 rounded-md text-left hover:bg-fill"
          onClick={() => {
            set(null);
            onClose();
          }}
        >
          <Icon name="trash" className="glyph size-3.5" />
          {t("header.remove")}
        </button>
      ) : null}
    </div>
  );
}

/** Set the cover: pick a picture or paste one into the field; it is copied into the workspace's attachments folder like
 *  a file added to the page (25 MB cap), and its name becomes `cover:`. Remove drops the key, not the file. */
function CoverPopover({
  page,
  has,
  align,
  set,
  onClose,
}: {
  page: string;
  has: boolean;
  align: string;
  set: (name: string | null) => void;
  onClose: () => void;
}) {
  const { t } = useT();
  const box = useRef<HTMLDivElement>(null);
  useDismiss(box, true, onClose, { on: "pointerdown" });
  const take = (links: string[]) => {
    if (!links[0]) return;
    set(links[0]);
    onClose();
  };
  const paste = (e: ClipboardEvent<HTMLInputElement>) => {
    const files = [...e.clipboardData.files];
    if (!files.length) return;
    e.preventDefault();
    void pasteAttachments(page, files.slice(0, 1), isFinderPaste(e.clipboardData.getData("text/plain"))).then(take);
  };
  return (
    <div ref={box} data-cover-popover className={`${POPOVER} ${align}`}>
      <button
        autoFocus
        className="h-7 flex items-center gap-2 px-2 rounded-md text-left hover:bg-fill"
        onClick={() => void pickAttachments(page).then(take)}
      >
        <Icon name="upload" className="glyph size-3.5" />
        {t("header.chooseImage")}
      </button>
      <input
        aria-label={t("header.pasteImage")}
        placeholder={t("header.pasteImage")}
        className="h-7 w-full px-2 rounded-md bg-fill-2 outline-none"
        value=""
        onChange={() => {}}
        onPaste={paste}
      />
      {has ? (
        <button
          className="h-7 flex items-center gap-2 px-2 rounded-md text-left hover:bg-fill"
          onClick={() => {
            set(null);
            onClose();
          }}
        >
          <Icon name="trash" className="glyph size-3.5" />
          {t("header.remove")}
        </button>
      ) : null}
    </div>
  );
}
