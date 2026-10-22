import { useState } from "react";
import { useT } from "../../hooks/useT";
import { Icon } from "../../components/Icon";

/** A folder's name typed in place of its row: Enter or leaving the field keeps it, Escape the name it had. */
export function FolderName({
  name,
  indent,
  onDone,
}: {
  name: string;
  indent: boolean;
  onDone: (name: string) => void;
}) {
  const { t } = useT();
  const [text, setText] = useState(name);
  return (
    <label className={`flex h-7.5 gap-2 items-center px-2 rounded-md bg-fill ${indent ? "ml-4.5" : ""}`}>
      <Icon name="folder" className="glyph size-3.5 flex-none text-secondary" />
      <input
        // the folder was just made, or renamed from its menu
        autoFocus
        aria-label={t("nav.folderName")}
        className="min-w-0 flex-1 bg-transparent outline-none select-text"
        value={text}
        onFocus={e => e.target.select()}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => {
          e.stopPropagation(); // Escape here closes nothing else
          if (e.key === "Enter") onDone(text);
          else if (e.key === "Escape") onDone("");
        }}
        onBlur={() => onDone(text)}
      />
    </label>
  );
}
