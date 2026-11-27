import { useT } from "../../hooks/useT";
import { Icon } from "../../components/Icon";

/** A small ⓘ with the long explanation of a setting in its tooltip. The text may hold the markup of a translation:
 *  the tooltip shows it as plain text. */
export function Info({ text }: { text: string }) {
  const { t } = useT();
  const plain = text.replace(/<[^>]+>/g, "");
  return (
    <button
      type="button"
      className="grid size-4 flex-none place-items-center rounded-full text-s-faint hover:text-s-fg focus-visible:ring-2 ring-s-ring focus-visible:outline-none"
      title={plain}
      aria-label={`${t("set.moreInfo")}: ${plain}`}
    >
      <Icon name="info" className="size-3.5 fill-none stroke-current stroke-2 glyph" />
    </button>
  );
}
