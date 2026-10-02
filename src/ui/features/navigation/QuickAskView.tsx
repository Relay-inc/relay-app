import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from "react";
import type { Img } from "../../../domain/conversations/types";
import { useNavigationStore } from "../../../application/navigation/store";
import { toggleQuickAsk } from "../../../application/navigation/navigation";
import { quickSend } from "../../../application/conversations/actions";
import { prepImages, releaseImages } from "../../../application/conversations/images";
import { pastedImages, hasFiles } from "../../components/image-files";
import { ImageThumbs } from "../../components/ImageThumbs";
import { useT } from "../../hooks/useT";

const close = () => toggleQuickAsk(false);

/** Cmd-K: one question that becomes a new general conversation in the background, the open screen stays. Mounted while `quickAsk`. */
export function QuickAskView() {
  const { t } = useT();
  const zoomed = useNavigationStore(s => !!s.zoom);
  const field = useRef<HTMLTextAreaElement>(null);
  // images waiting in the field, freed when it closes without sending
  const [images, setImages] = useState<Img[]>([]);
  const waiting = useRef<Img[]>([]);
  const sent = useRef(false);
  const update = (next: Img[]) => {
    waiting.current = next;
    setImages(next);
  };
  const add = async (files: File[]) => {
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
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Escape") {
      if (zoomed) return; // the app closes the image first
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
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
          onInput={grow}
          onKeyDown={onKey}
          onPaste={onPaste}
        />
        <div className="text-xs text-secondary mt-1.5">{t("qk.hint")}</div>
      </div>
    </div>
  );
}
