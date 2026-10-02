import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from "react";
import type { Img } from "../../../domain/conversations/types";
import { useNavigationStore } from "../../../application/navigation/store";
import { openProject, quickProjects, toggleQuickAsk } from "../../../application/navigation/navigation";
import { quickSend } from "../../../application/conversations/actions";
import { prepImages, releaseImages } from "../../../application/conversations/images";
import { pastedImages, hasFiles } from "../../components/image-files";
import { ImageThumbs } from "../../components/ImageThumbs";
import { useDerived } from "../../hooks/useDerived";
import { useT } from "../../hooks/useT";

const close = () => toggleQuickAsk(false);

/** Cmd-K: open a matching project, or send a quick question in the background. Mounted while `quickAsk`. */
export function QuickAskView() {
  const { t } = useT();
  const zoomed = useNavigationStore(s => !!s.zoom);
  const field = useRef<HTMLTextAreaElement>(null);
  // images waiting in the field, freed when it closes without sending
  const [images, setImages] = useState<Img[]>([]);
  const waiting = useRef<Img[]>([]);
  const sent = useRef(false);
  const [typed, setTyped] = useState("");
  const [picked, setPicked] = useState(-1); // no project selected: Enter keeps asking a quick question
  const found = useDerived(() => quickProjects(typed));
  const projects = images.length || typed.includes("\n") ? [] : found;
  const update = (next: Img[]) => {
    waiting.current = next;
    setImages(next);
  };
  const add = async (files: File[]) => {
    setPicked(-1);
    const prepared = await prepImages(files);
    if (prepared.length) update([...waiting.current, ...prepared]);
  };

  useEffect(() => {
    field.current?.focus();
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
  const chooseProject = (name: string) => {
    close();
    openProject(name);
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
    if (projects.length && !e.shiftKey && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      const count = projects.length + 1; // include the quick-question choice at -1
      setPicked(((picked + 1 + (e.key === "ArrowDown" ? 1 : -1) + count) % count) - 1);
      return;
    }
    if (e.key !== "Enter" || e.shiftKey) return;
    e.preventDefault();
    const project = projects[picked];
    if (project) {
      chooseProject(project.name);
      return;
    }
    const text = e.currentTarget.value.trim();
    if (!text && !images.length) return;
    sent.current = true;
    close();
    quickSend(text, images);
  };
  const onPaste = (e: ClipboardEvent) => {
    const files = pastedImages(e);
    if (files.length) add(files);
  };
  const onDrop = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    add([...e.dataTransfer.files]);
  };
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
        className="w-full max-w-xl bg-bg border border-separator rounded-xl shadow-2xl px-4 pt-3.5 pb-2.5"
        role="dialog"
        aria-label={t("qk.label")}
        aria-modal="true"
        onKeyDown={e => {
          if (e.key === "Escape" && !e.nativeEvent.isComposing && !zoomed) {
            e.stopPropagation();
            close();
          }
        }}
        onDragOver={e => {
          if (hasFiles(e)) e.preventDefault();
        }}
        onDrop={onDrop}
      >
        {images.length ? (
          <ImageThumbs className="mb-2" urls={images.map(image => image.url)} onRemove={remove} />
        ) : null}
        <textarea
          ref={field}
          className="w-full border-0 outline-0 resize-none bg-transparent text-label text-lg leading-snug font-sans max-h-80 overflow-y-auto p-0.5 placeholder:text-secondary"
          rows={1}
          spellCheck={false}
          placeholder={t("qk.ph")}
          aria-label={t("qk.label")}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={projects.length > 0}
          aria-controls="quick-projects"
          aria-activedescendant={projects[picked] ? `quick-project-${picked}` : undefined}
          onInput={grow}
          onKeyDown={onKey}
          onPaste={onPaste}
        />
        <div id="quick-projects" role="listbox" aria-label={t("qk.projects")}>
          {projects.map((project, i) => (
            <button
              key={project.name}
              id={`quick-project-${i}`}
              type="button"
              role="option"
              aria-selected={picked === i}
              tabIndex={-1}
              className={`flex items-center gap-3 w-full text-left border-0 rounded-lg px-2.5 py-2 mt-1 cursor-pointer text-label ${picked === i ? "bg-fill-2" : "bg-transparent hover:bg-fill"}`}
              onMouseDown={e => e.preventDefault()}
              onClick={() => chooseProject(project.name)}
            >
              <span className="flex-1 min-w-0 truncate text-[13px] font-medium">{project.label}</span>
              <span className="text-xs text-secondary truncate max-w-40">{project.context}</span>
            </button>
          ))}
        </div>
        <div className="text-xs text-secondary mt-1.5">{t(projects[picked] ? "qk.openHint" : "qk.hint")}</div>
      </div>
    </div>
  );
}
