import { dropProposal } from "../../../../application/today/capture";
import { useT } from "../../../hooks/useT";
import { Icon } from "../../../components/Icon";
import { Markdown } from "../../../components/Markdown";
import { ICON_BUTTON } from "../parts";
import type { SectionProps } from "./types";

/** What a closed conversation proposes for the vault: per note what changes, each one can be left out. Apply
 *  makes the rest in a conversation (application/today/capture). */
export function CaptureSection({ entry }: SectionProps<"capture">) {
  const { t } = useT();
  const { capture } = entry.subject;
  return (
    <ol className="m-0 p-0 list-none flex flex-col gap-4 max-w-170">
      {capture.proposals.map((proposal, i) => (
        <li key={`${proposal.file}:${i}`} className="flex gap-3">
          <div className="min-w-0 flex-1 flex flex-col gap-1">
            <span className="text-sm font-semibold">{proposal.title}</span>
            <span className="text-xs text-tertiary truncate select-text">{proposal.file}</span>
            <Markdown text={proposal.change} className="md-panel text-sm leading-relaxed text-secondary select-text" />
          </div>
          <button
            type="button"
            className={ICON_BUTTON}
            title={t("capture.leaveOut")}
            aria-label={t("capture.leaveOut")}
            onClick={() => dropProposal(capture.key, i)}
          >
            <Icon name="close" className="glyph size-4" />
          </button>
        </li>
      ))}
    </ol>
  );
}
