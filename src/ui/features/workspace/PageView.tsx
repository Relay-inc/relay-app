import { useEffect, useRef } from "react";
import { Toast } from "../conversations/Toast";
import {
  askAboutPage,
  loadPage,
  pagePath,
  pageProject,
  savePage,
  type Page,
} from "../../../application/navigation/pages";
import { useNavigationStore } from "../../../application/navigation/store";
import { pageKey } from "../../../domain/navigation/keys";
import { workspaces } from "../../../application/navigation/workspaces";
import { chatsOf } from "../../../application/conversations/selectors";
import { useConversationsStore } from "../../../application/conversations/store";
import { useWorkspaceStore } from "../../../application/workspace/store";
import { noteTitle } from "../../../domain/workspace/rules";
import { frontmatterOf, withFrontmatter } from "../../../domain/workspace/properties";
import { noteName } from "../../../domain/navigation/pages";
import { clockTime } from "../../../shared/format";
import { isImg } from "../../../shared/icons";
import { agoOf } from "../brain/ago";
import { useDerived } from "../../hooks/useDerived";
import { useT } from "../../hooks/useT";
import { Markdown } from "../../components/Markdown";
import { Icon } from "../../components/Icon";
import { Note } from "../../components/Note";
import { ProjectImg } from "../../components/ProjectImg";
import { FRONTMATTER } from "./NoteDetail";
import { PageEditor, type HeadWriter } from "./PageEditor";
import { Properties } from "./Properties";

const EDIT_MAX = 1_000_000; // characters: a bigger note is shown read-only

/** A workspace's note as a page in the middle column (the A6 design): a bar with where it lives, when it was edited and
 *  Ask Claude, then its folders, icon and title, its properties, the project's conversations and the body. */
export function PageView({ target, className }: { target: string; className: string }) {
  const { t, locale } = useT();
  const read = useNavigationStore(s => s.panel.detail[pageKey(target)]) as Page | undefined;
  const toast = useNavigationStore(s => s.toast);
  useEffect(() => {
    void loadPage(target);
  }, [target]);
  const page = read && !("err" in read) ? read : null;
  const err = read && "err" in read ? read.err : "";
  const path = pagePath(target) || target;
  const workspace = useDerived(() => workspaces().find(w => w.active)?.name ?? "");
  const project = useDerived(() => pageProject(path));
  const icon = useWorkspaceStore(s => (project ? s.icons[project.key] : undefined));
  // the project's conversations, newest first
  useConversationsStore(s => s.chats); // the count follows new and closed conversations
  const chats = project ? chatsOf(project.key) : [];

  const headRef = useRef<HeadWriter["current"]>(null);
  const match = page ? FRONTMATTER.exec(page.text) : null;
  const { title, body } = noteTitle(path, page ? page.text.slice(match ? match[0].length : 0) : noteName(path));
  // what comes before the body in the file (frontmatter, the title's heading): the editor writes it back unchanged
  const head = page ? page.text.slice(0, page.text.length - body.length) : "";
  const folders = path.split("/").slice(0, -1);

  return (
    <div className={`${className} flex flex-col min-h-0`}>
      {/* app chrome is not text: no selection in the bar, like a native Mac app */}
      <div className="h-12 flex-none flex items-center gap-2 pl-4 pr-2.5 select-none" data-tauri-drag-region>
        <Icon name="file" className="glyph size-3.75 text-tertiary" />
        <div title={path} className="flex-1 min-w-0 flex items-center gap-1.5 text-[13px] whitespace-nowrap">
          <span className="text-tertiary">{workspace}</span>
          <span className="text-tertiary">/</span>
          <span className="truncate font-medium text-label">{title}</span>
        </div>
        {page?.modified ? (
          <span className="text-xs text-tertiary">{t("page.edited", { ago: agoOf(page.modified, t) })}</span>
        ) : null}
        <button
          className="flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-separator text-[13px] text-label hover:bg-fill"
          onClick={() => void askAboutPage(path)}
        >
          <Icon name="wand" className="glyph size-3.5" />
          {t("page.ask")}
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {err ? (
          <div className="err-box m-4.5">{err}</div>
        ) : !page ? (
          <div className="p-4.5">
            <Note>{t("pr.loading")}</Note>
          </div>
        ) : (
          <article className="w-full max-w-180 mx-auto pt-10 px-8 pb-16 flex flex-col gap-6">
            <header className="flex flex-col gap-4">
              {folders.length ? (
                <div className="flex items-center gap-1.5 text-[13px] text-tertiary">
                  {folders.map((folder, i) => (
                    <span key={i} className="contents">
                      {i ? <Icon name="right" className="glyph size-3 flex-none" /> : null}
                      <span>{folder}</span>
                    </span>
                  ))}
                </div>
              ) : null}
              <div className="flex items-center gap-3">
                <span className="size-11 flex-none grid place-items-center rounded-lg bg-fill-2 text-xl">
                  {isImg(icon?.img) ? (
                    <ProjectImg url={icon.img} className="size-6 object-contain" />
                  ) : icon?.icon ? (
                    icon.icon
                  ) : (
                    <Icon name="file" className="glyph size-5 text-secondary" />
                  )}
                </span>
                <h1 className="text-3xl font-semibold tracking-tight text-pretty">{title}</h1>
              </div>
              <Properties
                yaml={frontmatterOf(head) ?? ""}
                onChange={yaml => {
                  const next = withFrontmatter(head, yaml);
                  // through the editor: what is typed in the body goes along, one write, one hash check
                  void (headRef.current ? headRef.current(next) : savePage(target, next + body));
                }}
              >
                {project ? (
                  <>
                    <dt className="h-7 flex items-center pl-4 text-tertiary">{t("page.conversations")}</dt>
                    <dd className="flex items-center px-2">
                      <span className="inline-flex items-center gap-1.5 px-2 rounded-md border border-separator text-accent-text">
                        <Icon name="chat" className="glyph size-3" />
                        {chats.length
                          ? t("page.latest", {
                              n: chats.length,
                              time: clockTime(new Date(chats[0].at).toISOString(), locale),
                            })
                          : 0}
                      </span>
                    </dd>
                  </>
                ) : null}
              </Properties>
            </header>
            <div className="h-px bg-separator" />
            {page.text.length > EDIT_MAX ? (
              <>
                <Note>{t("page.tooBig")}</Note>
                <PageBody text={body} />
              </>
            ) : (
              <PageEditor key={target} page={target} head={head} body={body} headRef={headRef} />
            )}
          </article>
        )}
      </div>
      {/* the bar ConversationsView shows under a conversation: Undo of a page put in the trash, an error */}
      {toast ? (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2">
          <Toast toast={toast} />
        </div>
      ) : null}
    </div>
  );
}

/** A page's text read-only: rendered markdown, for a note too big to edit. */
function PageBody({ text }: { text: string }) {
  return (
    <Markdown
      className="md-note leading-[1.65] text-pretty [&_:not(pre)>code]:bg-transparent [&_:not(pre)>code]:p-0 [&_:not(pre)>code]:text-label"
      text={text}
    />
  );
}
