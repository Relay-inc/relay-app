import { useState } from "react";
import { useT } from "../../hooks/useT";
import { Icon } from "../../components/Icon";
import { Markdown } from "../../components/Markdown";
import { copyText } from "../../components/copy";

/** What the agent answered, as markdown, with a button on hover that copies it as written. */
export function Answer({ text }: { text: string }) {
  const { t } = useT();
  const [copied, setCopied] = useState(false);
  const copy = () => {
    copyText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };
  return (
    <div className="group">
      <Markdown className="md-chat [&_a:not(.vlink)]:underline [&_strong]:font-bold!" text={text} />
      <button
        className="grid place-items-center size-6 -ml-1 mt-1 rounded-sm border-0 bg-transparent text-secondary hover:bg-fill opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
        title={t("copy")}
        aria-label={t("copy")}
        onClick={copy}
      >
        <Icon name={copied ? "check" : "copy"} className="glyph size-3.5" />
      </button>
    </div>
  );
}
