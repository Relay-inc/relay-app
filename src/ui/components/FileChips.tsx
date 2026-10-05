import { fileName } from "../../domain/conversations/files";
import { openAttached } from "../../application/conversations/attachments";
import { useT } from "../hooks/useT";
import { Icon } from "./Icon";

/** Files attached by their path, in the composer, the Cmd-K field and the user's messages. A click opens the file
 *  where it is, Option-click shows it in Finder. `onRemove` adds the × button (the index). */
export function FileChips({
  paths,
  className = "",
  end = false,
  onRemove,
}: {
  paths: string[];
  className?: string;
  end?: boolean;
  onRemove?: (index: number) => void;
}) {
  const { t } = useT();
  return (
    <div className={`flex flex-wrap gap-1.5 ${end ? "justify-end" : ""} ${className}`}>
      {paths.map((path, i) => (
        <span key={path} className="group relative flex-none">
          <button
            className="inline-flex items-center gap-1.5 max-w-60 h-7 pl-2 pr-2.5 rounded-lg border-0 ring-1 ring-separator bg-fill text-[13px] text-label hover:bg-fill-2 cursor-default"
            title={`${path}\n${t("file.openHint")}`}
            onClick={e => openAttached(path, e.altKey)}
          >
            <Icon name="file" className="glyph size-3.5 flex-none text-secondary" />
            <span className="truncate">{fileName(path)}</span>
          </button>
          {onRemove ? (
            <button
              className="absolute -top-1.5 -right-1.5 hidden group-hover:grid focus-visible:grid size-4 rounded-full p-0 bg-label text-bg text-sm leading-none place-items-center cursor-default"
              title={t("file.remove")}
              aria-label={t("file.remove")}
              onClick={() => onRemove(i)}
            >
              ×
            </button>
          ) : null}
        </span>
      ))}
    </div>
  );
}
