import { useState } from "react";
import { copyText } from "../../components/copy";
import { Icon } from "../../components/Icon";
import { useT } from "../../hooks/useT";
import { BUTTON_GLYPH, buttonClass } from "./blocks";

/** A button that copies `text` (or what `get` answers) and says Copied for a moment. */
export function CopyButton({
  label,
  text = "",
  get,
  kind = "plain",
}: {
  label: string;
  text?: string;
  get?: () => Promise<string>;
  kind?: "plain" | "ghost";
}) {
  const { t } = useT();
  const [copied, setCopied] = useState(false);
  return (
    <button
      className={buttonClass(kind)}
      onClick={async () => {
        copyText(get ? await get() : text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
    >
      <Icon name={copied ? "check" : "link"} className={BUTTON_GLYPH} />
      {copied ? t("mc.copied") : label}
    </button>
  );
}
