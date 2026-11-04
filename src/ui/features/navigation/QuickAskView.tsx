import { useEffect, useEffectEvent, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import type { Img } from "../../../domain/conversations/types";
import { useNavigationStore } from "../../../application/navigation/store";
import {
  newHere,
  openDrawer,
  openProject,
  openSettingsTab,
  quickChats,
  quickProjects,
  select,
  toggleQuickAsk,
} from "../../../application/navigation/navigation";
import { selectedProject } from "../../../application/conversations/selectors";
import { TABS } from "../../../application/settings/window";
import { WAIT } from "../../../domain/navigation/views";
import { arrange, isQuestion, matchCommands } from "../../../domain/navigation/palette";
import {
  addToConversation,
  openPageAtLine,
  openPageIn,
  openPagePath,
  placeIn,
} from "../../../application/navigation/pages";
import {
  type ContentHit,
  type NameHit,
  findNotes,
  loadTemplates,
  newFromTemplate,
  openDailyNote,
  templatesOf,
} from "../../../application/navigation/kb";
import { activeFolder, workspaces } from "../../../application/navigation/workspaces";
import { filterPrefix, queryOf, takeFilters } from "../../../domain/navigation/search";
import { quickSend } from "../../../application/conversations/actions";
import { knownTickets, openFoundCard, searchTickets, type Found } from "../../../application/board/board";
import { findMeetings, timeOf } from "../../../application/calendar/calendar";
import { openMeeting } from "../../../application/today/today";
import type { Meeting } from "../../../domain/calendar/types";
import { prepImages, releaseImages } from "../../../application/conversations/images";
import { dropTarget, fromPaths } from "../../../application/conversations/attachments";
import { onPasteFiles } from "../../components/image-files";
import { ImageThumbs } from "../../components/ImageThumbs";
import { FileChips } from "../../components/FileChips";
import { Glyph } from "../../components/Glyph";
import { Icon } from "../../components/Icon";
import { numbered } from "../board/format";
import { useDerived } from "../../hooks/useDerived";
import { useT } from "../../hooks/useT";

const close = () => toggleQuickAsk(false);
type Located = { folder: string };
type Key = Parameters<ReturnType<typeof useT>["t"]>[0];
type Option =
  | { kind: "chat"; key: string; name: string; context: string }
  | ({ kind: "project" } & ReturnType<typeof quickProjects>[number])
  | { kind: "meeting"; meeting: Meeting }
  | ({ kind: "ticket" } & Found)
  | ({ kind: "note" } & NameHit & Located)
  | ({ kind: "content" } & ContentHit & Located)
  | { kind: "action"; id: string; label: string; run?: () => void };
const NO_NOTES: { names: NameHit[]; content: ContentHit[] } = { names: [], content: [] };
/** The folders of a note's path that tell where it is, the last two. */
const whereIs = (path: string) => path.split("/").slice(0, -1).slice(-2).join("/");
const ticketKey = (found: Found) => `${found.provider.id}:${found.hit.id}`;
const rowKey = (option: Option) =>
  option.kind === "project"
    ? option.name
    : option.kind === "chat"
      ? `chat:${option.key}`
      : option.kind === "meeting"
        ? `meeting:${option.meeting.id}`
        : option.kind === "ticket"
          ? ticketKey(option)
          : option.kind === "action"
            ? `action:${option.id}`
            : `${option.kind}:${option.folder}:${option.path}${option.kind === "content" ? `:${option.line}` : ""}`;
/** Meetings and loaded cards show from this many characters, the trackers are searched once typing pauses this long (ms). */
const MIN_QUERY = 3;
const HINT = {
  chat: "qk.chatHint",
  project: "qk.openHint",
  meeting: "qk.meetingHint",
  ticket: "qk.ticketHint",
  note: "qk.noteHint",
  content: "qk.noteHint",
  action: "qk.actionHint",
} as const;
const MIN_NOTES = 2;
// the notes' groups always say what they are; a lone project or ticket list needs no heading
const NOTE_GROUPS: string[] = ["qk.groupNotes", "qk.groupContent", "qk.groupCommands"];
const PAUSE = 250;
const PAUSE_NOTES = 60;

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
  // the filters typed and finished (type:Document, in:Studio, #tag), shown as pills; the workspace searched (⇥ cycles)
  const [filters, setFilters] = useState<string[]>([]);
  const [searched, setSearched] = useState(-1);
  const spaces = useDerived(() => workspaces());
  const space = spaces[searched] ?? spaces.find(w => w.active) ?? spaces[0];
  const folder = space?.folder ?? "";
  const found = useDerived(() => quickProjects(typed));
  // a question (6+ words, or ending in ?) lists nothing, unless a filter is set: a pill is not a question
  const asking = !!(images.length || files.length || typed.includes("\n") || (!filters.length && isQuestion(typed)));
  // a filter narrows the notes: the conversations, projects, meetings and tickets stand aside
  const onlyNotes = filters.length > 0;
  const projects = asking || onlyNotes ? [] : found;
  const chats = useDerived(() => (asking || onlyNotes ? [] : quickChats(typed)));
  // the notes the backend finds by name and content, once typing pauses a moment; the last answer stays until the next
  const noteQuery = asking ? "" : queryOf(filters, typed);
  const [answer, setAnswer] = useState(NO_NOTES);
  const notes = noteQuery.length < MIN_NOTES ? NO_NOTES : answer;
  useEffect(() => {
    if (noteQuery.length < MIN_NOTES) return;
    let live = true;
    const timer = setTimeout(
      () =>
        findNotes(folder, noteQuery)
          .then(next => live && setAnswer(next))
          .catch(console.error),
      PAUSE_NOTES,
    );
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [noteQuery, folder]);
  // opening Cmd-K has the backend bring its index of the notes up to date, so the first search is fast
  useEffect(() => {
    void findNotes(activeFolder(), "").catch(console.error);
    void loadTemplates();
  }, []);
  // Commands: the frame's Today's note and New <template> (made where the open page is), and the fixed list of
  // places and tools; each shows when what is typed names it
  const place = useDerived(() => placeIn(openPagePath().split("/").slice(0, -1).join("/")));
  const templates = useDerived(() => templatesOf());
  const inProject = useDerived(() => selectedProject() !== null);
  const note = (id: string, label: string, run?: () => void) => ({ id, label, run });
  const tools = [
    ["terminal", t("drawer.terminal")],
    ["notes", t("drawer.notes")],
    ["design", t("drawer.design")],
    ["git", t("drawer.git")],
    ["files", t("drawer.files")],
    ["agents", t("agents.column")],
    ["workers", t("qk.cmdWorkers")],
  ] as const;
  const everyAction = [
    note("daily", t("qk.todayNote")),
    ...templates.map(name =>
      note(
        `tpl:${name}`,
        place.about
          ? t("qk.newTemplateIn", { template: name, where: place.about })
          : t("qk.newTemplate", { template: name }),
      ),
    ),
    note("new-here", t("qk.cmdNewHere"), () => void newHere()),
    note("today", t("nav.today"), () => void select(WAIT)),
    ...(inProject ? tools.map(([id, label]) => note(`tool:${id}`, label, () => openDrawer(id))) : []),
    note("settings", t("set.title"), () => void openSettingsTab()),
    ...TABS.map(([id, name]) =>
      note(`settings:${id}`, `${t("set.title")}: ${t(name)}`, () => void openSettingsTab(id)),
    ),
    note("updates", t("qk.cmdUpdates"), () => void openSettingsTab("updates")),
  ];
  const usual = ["daily", ...(place.about && templates.length ? [`tpl:${templates[0]}`] : [])];
  const named = matchCommands(everyAction, typed);
  const actions =
    asking || (typed.trim().length < MIN_NOTES && !filters.length)
      ? []
      : [...named, ...everyAction.filter(action => usual.includes(action.id) && !named.includes(action))];
  const exactCommand = !asking && !onlyNotes && named[0]?.label.toLowerCase() === typed.trim().toLowerCase();
  // the trackers' tickets, searched once typing pauses; the last answer stays until the next one is in
  const query = asking || onlyNotes ? "" : typed.trim();
  const [tickets, setTickets] = useState<Found[]>([]);
  // what is known without asking anyone: the day's meetings and the cards already loaded, at once
  const meetings = useDerived(() => (query.length < MIN_QUERY ? [] : findMeetings(query)));
  const known = useDerived(() => (query.length < MIN_QUERY ? [] : knownTickets(query)));
  // the query the shown tickets answer; a different one is still being searched
  const [answered, setAnswered] = useState("");
  const searching = query.length >= MIN_QUERY && answered !== query;
  useEffect(() => {
    if (query.length < MIN_QUERY) return;
    let live = true;
    const timer = setTimeout(
      () =>
        searchTickets(query, next => {
          if (live) setTickets(next);
        }).then(() => {
          if (live) setAnswered(query);
        }),
      PAUSE,
    );
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query]);
  // in groups, in the order they are shown; `options` is them in one list, which the arrow keys walk
  const all: { id: string; title: Key; options: Option[] }[] = [
    { id: "chats", title: "qk.groupChats", options: chats.map(chat => ({ kind: "chat" as const, ...chat })) },
    {
      id: "projects",
      title: "qk.groupProjects",
      options: projects.map(project => ({ kind: "project" as const, ...project })),
    },
    {
      id: "meetings",
      title: "qk.groupMeetings",
      options: meetings.map(meeting => ({ kind: "meeting" as const, meeting })),
    },
    // the loaded cards first, the trackers' answers after them: a late answer adds rows below, the selection stays put
    {
      id: "tickets",
      title: "qk.groupTickets",
      options: [
        ...new Map([...known, ...(query.length < MIN_QUERY ? [] : tickets)].map(x => [ticketKey(x), x])).values(),
      ].map(ticket => ({ kind: "ticket" as const, ...ticket })),
    },
    {
      id: "notes",
      title: "qk.groupNotes",
      options: notes.names.map(name => ({ kind: "note" as const, ...name, folder })),
    },
    {
      id: "content",
      title: "qk.groupContent",
      options: notes.content.map(hit => ({ kind: "content" as const, ...hit, folder })),
    },
    {
      id: "commands",
      title: "qk.groupCommands",
      options: actions.map(action => ({ kind: "action" as const, ...action })),
    },
  ];
  const groups = arrange(all, exactCommand);
  const options = groups.flatMap(group => group.options);
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
    // a filter finished with a space becomes a pill; with one, Enter opens the first result and not a question
    const taken = takeFilters(el.value);
    if (taken.filters.length) {
      el.value = taken.rest;
      setFilters([...filters, ...taken.filters]);
    }
    setTyped(el.value);
    setPicked(taken.filters.length || filters.length ? 0 : -1);
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  };
  const choose = (option: Option, beside = false, add = false) => {
    close();
    if (add && (option.kind === "note" || option.kind === "content"))
      void addToConversation(option.path, option.folder);
    else if (option.kind === "project") openProject(option.name);
    else if (option.kind === "meeting") openMeeting(option.meeting.id);
    else if (option.kind === "ticket") openFoundCard(option.provider, option.hit);
    else if (option.kind === "content" && !beside) openPageAtLine(option.folder, option.path, option.line);
    else if (option.kind === "note" || option.kind === "content") openPageIn(option.folder, option.path, beside);
    else if (option.kind === "chat") void select(option.key);
    else if (option.run) option.run();
    else if (option.id === "daily") void openDailyNote();
    else void newFromTemplate(option.id.slice("tpl:".length), place);
  };
  const dropFilter = (at: number) => {
    setFilters(filters.filter((_, i) => i !== at));
    setPicked(filters.length > 1 ? 0 : -1);
    field.current?.focus();
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
    // ⇥ searches the next workspace; Backspace in an empty field takes the last pill off
    if (e.key === "Tab" && !e.shiftKey && spaces.length > 1) {
      e.preventDefault();
      setSearched((spaces.indexOf(space) + 1) % spaces.length);
      return;
    }
    if (e.key === "Backspace" && !e.currentTarget.value && filters.length) {
      e.preventDefault();
      dropFilter(filters.length - 1);
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
      choose(option, e.metaKey, e.altKey);
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
        className={`w-full max-w-2xl bg-bg border rounded-xl shadow-2xl px-4 pt-3.5 pb-2.5 ${dropping ? "border-accent" : "border-separator"}`}
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
        <div className="flex flex-wrap items-center gap-1.5">
          {filters.map((filter, i) => {
            const at = filter.indexOf(":") + 1;
            return (
              <span
                key={filter}
                data-filter={filter}
                className="inline-flex items-center gap-1 h-6 px-2 rounded-md bg-accent-soft text-accent-text text-xs"
              >
                {filter.startsWith("#") ? (
                  filter
                ) : (
                  <>
                    <span className="opacity-70">{filter.slice(0, at)}</span>
                    {filter.slice(at).replace(/^"|"$/g, "")}
                  </>
                )}
                <button
                  type="button"
                  className="border-0 bg-transparent p-0 cursor-pointer text-current"
                  aria-label={t("qk.removeFilter", { filter })}
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => dropFilter(i)}
                >
                  <Icon name="close" className="glyph size-2.5" />
                </button>
              </span>
            );
          })}
          <textarea
            ref={field}
            className="flex-1 min-w-32 border-0 outline-0 resize-none bg-transparent text-label text-lg leading-snug font-sans max-h-80 overflow-y-auto p-0.5 placeholder:text-secondary"
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
        </div>
        <div id="quick-options" role="listbox" aria-label={t("qk.options")}>
          {groups.map(group => (
            <div key={group.title} role="group" aria-label={t(group.title)}>
              {groups.length > 1 || NOTE_GROUPS.includes(group.title) ? (
                <div className="flex items-center px-2.5 pt-2 pb-1 text-xs font-semibold uppercase tracking-wider text-secondary">
                  <span className="flex-1">{t(group.title)}</span>
                  <span className="font-medium normal-case tracking-normal">{group.options.length}</span>
                </div>
              ) : null}
              {group.options.map(option => {
                const i = options.indexOf(option);
                return (
                  <button
                    key={rowKey(option)}
                    id={`quick-option-${i}`}
                    type="button"
                    role="option"
                    aria-selected={picked === i}
                    tabIndex={-1}
                    data-option={option.kind}
                    className={`flex items-center gap-3 w-full text-left border-0 rounded-lg px-2.5 py-2 mt-1 cursor-pointer text-label ${picked === i ? "bg-fill-2" : "bg-transparent hover:bg-fill"}`}
                    onMouseDown={e => e.preventDefault()}
                    onClick={e => choose(option, e.metaKey)}
                  >
                    {option.kind === "chat" ? (
                      <span className="flex-1 min-w-0 truncate text-[13px] font-medium">{option.name}</span>
                    ) : option.kind === "project" ? (
                      <span className="flex-1 min-w-0 truncate text-[13px] font-medium">{option.label}</span>
                    ) : option.kind === "meeting" ? (
                      <>
                        <Icon name="cal" className="glyph size-4 flex-none" />
                        <span className="flex-1 min-w-0 truncate text-[13px] font-medium">{option.meeting.title}</span>
                      </>
                    ) : option.kind === "ticket" ? (
                      <>
                        <Glyph svg={option.provider.glyph} className="size-4 flex-none" />
                        <span className="flex-1 min-w-0 truncate text-[13px] font-medium">
                          <span className="text-secondary font-normal tabular-nums">{numbered(option.hit.number)}</span>{" "}
                          {option.hit.title}
                        </span>
                      </>
                    ) : option.kind === "action" ? (
                      <>
                        <Icon name="right" className="glyph size-4 flex-none text-accent-text" />
                        <span className="flex-1 min-w-0 truncate text-[13px] font-medium">{option.label}</span>
                      </>
                    ) : (
                      <>
                        <Icon name="file" className="glyph size-4 flex-none self-start mt-0.5 text-secondary" />
                        <span className="flex-1 min-w-0 flex flex-col gap-0.5">
                          <span className="flex items-center gap-2">
                            <span className="truncate text-[13px] font-medium">{option.title}</span>
                            <span className="flex-1 min-w-0 truncate text-xs text-tertiary">
                              {option.kind === "content"
                                ? `${whereIs(option.path)} · ${t("qk.lineNo", { n: option.line })}`
                                : whereIs(option.path)}
                            </span>
                          </span>
                          {option.kind === "content" ? (
                            <span className="truncate text-xs text-secondary">
                              {option.before}
                              <mark className="bg-mark text-label rounded-xs">{option.hit}</mark>
                              {option.after}
                            </span>
                          ) : null}
                        </span>
                      </>
                    )}
                    {option.kind === "chat" || option.kind === "project" ? (
                      <span className="text-xs text-secondary truncate max-w-40">{option.context}</span>
                    ) : option.kind === "meeting" ? (
                      <span className="text-xs text-secondary truncate max-w-40">{timeOf(option.meeting.start)}</span>
                    ) : option.kind === "ticket" ? (
                      <span className="text-xs text-secondary truncate max-w-40">{option.hit.where}</span>
                    ) : picked === i ? (
                      <span className="text-xs text-secondary self-start mt-0.5">↵</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2 text-xs text-secondary mt-1.5">
          <span className="flex-1 min-w-0">{t(!options[picked] ? "qk.hint" : HINT[options[picked].kind])}</span>
          {spaces.length > 1 && space && !space.active ? (
            <span className="flex-none text-accent-text">{t("qk.workspace", { name: space.name })}</span>
          ) : null}
          {filterPrefix(typed) || filters.length ? null : (
            <span className="flex-none text-tertiary">{t("qk.filters")}</span>
          )}
          {searching ? (
            <span role="status" aria-label={t("qk.searching")} title={t("qk.searching")}>
              <Icon name="refresh" className="glyph size-3.5 animate-spin" />
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
