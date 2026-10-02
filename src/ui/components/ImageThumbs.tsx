import { zoom } from "../../application/navigation/navigation";
import { useT } from "../hooks/useT";

/** Thumbnails in the composer, the Cmd-K field and the user's messages. An empty url is an image the transcript did not
 *  hold inline. A click opens one larger (`onOpen`, the zoom by default), `onRemove` adds the × button (the index). */
export function ImageThumbs({
  urls,
  size = "composer",
  className = "",
  onOpen = zoom,
  onRemove,
}: {
  urls: string[];
  size?: "composer" | "message";
  className?: string;
  onOpen?: (url: string) => void;
  onRemove?: (index: number) => void;
}) {
  const { t } = useT();
  const imageSize = size === "message" ? "h-16 max-w-50" : "h-15 max-w-45";
  return (
    <div className={`flex flex-wrap gap-2 ${size === "message" ? "justify-end" : ""} ${className}`}>
      {urls.map((url, i) =>
        url ? (
          <span key={i} className="group relative block flex-none">
            <img
              className={`${imageSize} block object-cover rounded-lg ring-1 ring-separator cursor-zoom-in`}
              src={url}
              alt=""
              role="button"
              tabIndex={0}
              aria-label={t("img.open")}
              onClick={() => onOpen(url)}
              onKeyDown={e => {
                if (e.key !== "Enter" && e.key !== " ") return;
                // the key is the thumbnail's: it does not go on to type into the composer
                e.preventDefault();
                e.stopPropagation();
                onOpen(url);
              }}
            />
            {onRemove ? (
              <button
                className="absolute -top-1.5 -right-1.5 hidden group-hover:grid focus-visible:grid size-4 rounded-full p-0 bg-label text-bg text-sm leading-none place-items-center cursor-default"
                title={t("img.remove")}
                aria-label={t("img.removeLabel")}
                onClick={e => {
                  e.stopPropagation();
                  onRemove(i);
                }}
              >
                ×
              </button>
            ) : null}
          </span>
        ) : (
          <span key={i} className="text-sm text-secondary">
            {t("img.placeholder")}
          </span>
        ),
      )}
    </div>
  );
}
