import { useEffect, useEffectEvent, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import type { Img } from "../../../domain/conversations/types";
import { useNavigationStore } from "../../../application/navigation/store";
import { openProject, quickProjects, toggleQuickAsk } from "../../../application/navigation/navigation";
import { quickSend } from "../../../application/conversations/actions";
import { openFoundCard, searchTickets } from "../../../application/board/board";
import { prepImages, releaseImages } from "../../../application/conversations/images";
import { dropTarget, fromPaths } from "../../../application/conversations/attachments";
import { onPasteFiles } from "../../components/image-files";
import { ImageThumbs } from "../../components/ImageThumbs";
import { FileChips } from "../../components/FileChips";
import { Glyph } from "../../components/Glyph";
import { numbered } from "../board/format";
import { useDerived } from "../../hooks/useDerived";
import { useT } from "../../hooks/useT";

const close = () => toggleQuickAsk(false);
type Ticket = Awaited<ReturnType<typeof searchTickets>>[number];
type Option = ({ kind: "project" } & ReturnType<typeof quickProjects>[number]) | ({ kind: "ticket" } & Ticket);
/** Tickets are searched from this many characters, once typing pauses this long (ms). */
const MIN_QUERY = 3;
const PAUSE = 250;

/** Cmd-K: open a matching project or ticket, or send a quick question in the background. Mounted while `quickAsk`. */
export function QuickAskView() {
  const { t } = useT();
  const zoomed = useNavigationStore(s => !!s.zoom);
  const field = useRef<HTMLTextAreaElement>(null);
  // images waiting in the field, freed when it closes without sending
  const [images, setImages] = useState<Img[]>([]);
  const waiting = useRef<Img[]>([]);
  // files by their path, dropped or pasted after a Finder copy
  const [files, setFiles] = useState<string[]>([]);
  const [dropping, setDropping] = useState(false);
  const sent = useRef(false);
  // a relay://ask link opens Cmd-K with its question typed (the shell keys this view by it)
  const initial = useNavigationStore(s => s.quickText);
  const [typed, setTyped] = useState(initial);
  const [picked, setPicked] = useState(-1); // nothing selected: Enter keeps asking a quick question
  const found = useDerived(() => quickProjects(typed));
  const asking = !!(images.length || files.length || typed.includes("\n"));
  const projects = asking ? [] : found;
  // the trackers' tickets, searched once typing pauses; the last answer stays until the next one is in
  const query = asking ? "" : typed.trim();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  useEffect(() => {
    if (query.length < MIN_QUERY) return;
    let live = true;
    const timer = setTimeout(
      () =>
        searchTickets(query).then(next => {
          if (!live) return;
          setTickets(next);
          setPicked(-1);
        }),
      PAUSE,
    );
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query]);
  const options: Option[] = [
    ...projects.map(project => ({ kind: "project" as const, ...project })),
    ...(query.length < MIN_QUERY ? [] : tickets).map(ticket => ({ kind: "ticket" as const, ...ticket })),
  ];
  const update = (next: Img[]) => {
    waiting.current = next;
    setImages(next);
  };
  const add = async (files: File[]) => {
    setPicked(-1);
    const prepared = await prepImages(files);
    if (prepared.length) update([...waiting.current, ...prepared]);
  };
  const addPaths = async (paths: string[]) => {
    setPicked(-1);
    const read = await fromPaths(paths);
    if (read.images.length) update([...waiting.current, ...read.images]);
    setFiles(now => [...now, ...read.files.filter(path => !now.includes(path))]);
    field.current?.focus();
  };
  // while Cmd-K is open, a drop anywhere on the window lands here and not in the composer behind it
  const dropped = useEffectEvent((paths: string[]) => addPaths(paths));
  useEffect(() => dropTarget({ over: setDropping, drop: dropped }), []);

  useEffect(() => {
    const el = field.current!;
    el.focus();
    if (el.value) {
      el.setSelectionRange(el.value.length, el.value.length);
      el.style.height = el.scrollHeight + "px";
    }
    return () => {
      if (!sent.current) releaseImages(waiting.current);
    };
  }, []);

  const grow = () => {
    const el = field.current!;
    setTyped(el.value);
    setPicked(-1);
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  };
  const choose = (option: Option) => {
    close();
    if (option.kind === "project") openProject(option.name);
    else openFoundCard(option.provider, option.hit);
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Escape") {
      if (zoomed) return; // the app closes the image first
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    if (options.length && !e.shiftKey && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      const count = options.length + 1; // include the quick-question choice at -1
      setPicked(((picked + 1 + (e.key === "ArrowDown" ? 1 : -1) + count) % count) - 1);
      return;
    }
    if (e.key !== "Enter" || e.shiftKey) return;
    e.preventDefault();
    const option = options[picked];
    if (option) {
      choose(option);
      return;
    }
    const text = e.currentTarget.value.trim();
    if (!text && !images.length && !files.length) return;
    sent.current = true;
    close();
    quickSend(text, images, files);
  };
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => onPasteFiles(e, add, addPaths);
  const remove = (i: number) => {
    releaseImages([images[i]]);
    update(images.filter((_, at) => at !== i));
    field.current?.focus();
  };

  // the textarea keeps the browser's own 2px padding and grey placeholder
  return (
    <div
      className="fixed inset-0 z-25 flex justify-center items-start px-10 pt-36 bg-black/20"
      onClick={e => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        className={`w-full max-w-xl bg-bg border rounded-xl shadow-2xl px-4 pt-3.5 pb-2.5 ${dropping ? "border-accent" : "border-separator"}`}
        role="dialog"
        aria-label={t("qk.label")}
        aria-modal="true"
        onKeyDown={e => {
          if (e.key === "Escape" && !e.nativeEvent.isComposing && !zoomed) {
            e.stopPropagation();
            close();
          }
        }}
      >
        {images.length ? (
          <ImageThumbs className="mb-2" urls={images.map(image => image.url)} onRemove={remove} />
        ) : null}
        {files.length ? (
          <FileChips
            className="mb-2"
            paths={files}
            onRemove={i => {
              setFiles(files.filter((_, at) => at !== i));
              field.current?.focus();
            }}
          />
        ) : null}
        <textarea
          ref={field}
          className="w-full border-0 outline-0 resize-none bg-transparent text-label text-lg leading-snug font-sans max-h-80 overflow-y-auto p-0.5 placeholder:text-secondary"
          rows={1}
          defaultValue={initial}
          spellCheck={false}
          placeholder={t("qk.ph")}
          aria-label={t("qk.label")}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={options.length > 0}
          aria-controls="quick-options"
          aria-activedescendant={options[picked] ? `quick-option-${picked}` : undefined}
          onInput={grow}
          onKeyDown={onKey}
          onPaste={onPaste}
        />
        <div id="quick-options" role="listbox" aria-label={t("qk.options")}>
          {options.map((option, i) => (
            <button
              key={option.kind === "project" ? option.name : `${option.provider.id}:${option.hit.id}`}
              id={`quick-option-${i}`}
              type="button"
              role="option"
              aria-selected={picked === i}
              tabIndex={-1}
              className={`flex items-center gap-3 w-full text-left border-0 rounded-lg px-2.5 py-2 mt-1 cursor-pointer text-label ${picked === i ? "bg-fill-2" : "bg-transparent hover:bg-fill"}`}
              onMouseDown={e => e.preventDefault()}
              onClick={() => choose(option)}
            >
              {option.kind === "project" ? (
                <span className="flex-1 min-w-0 truncate text-[13px] font-medium">{option.label}</span>
              ) : (
                <>
                  <Glyph svg={option.provider.glyph} className="size-4 flex-none" />
                  <span className="flex-1 min-w-0 truncate text-[13px] font-medium">
                    <span className="text-secondary font-normal tabular-nums">{numbered(option.hit.number)}</span>{" "}
                    {option.hit.title}
                  </span>
                </>
              )}
              <span className="text-xs text-secondary truncate max-w-40">
                {option.kind === "project" ? option.context : option.hit.where}
              </span>
            </button>
          ))}
        </div>
        <div className="text-xs text-secondary mt-1.5">
          {t(!options[picked] ? "qk.hint" : options[picked].kind === "project" ? "qk.openHint" : "qk.ticketHint")}
        </div>
      </div>
    </div>
  );
}
