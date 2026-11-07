import { useRef, useState } from "react";
import { linkOptions, type Row } from "../../../domain/collections/rules";
import { useDismiss } from "../../hooks/useDismiss";
import { useT } from "../../hooks/useT";

/** The listbox a links cell opens (K8): what the key may point at, filtered by what is typed, the ones it points at
 *  ticked. A click on another name replaces the link; after "+ Link another" it adds. Every change is handed to
 *  `onChange` at once, which writes the note. With `target` (the registry field's types) only notes of those types are
 *  offered, and a typed name none of them has can be made as a note of a `create` type (`onCreate`). */
export function LinkEditor({
  rows,
  fieldKey,
  note,
  values,
  onChange,
  onClose,
  target,
  many = false,
  create = [],
  onCreate,
}: {
  rows: Row[];
  fieldKey: string;
  note: string;
  values: string[];
  onChange: (values: string[]) => void;
  onClose: () => void;
  target?: string[];
  many?: boolean; // a list (people): a pick adds instead of replacing
  create?: string[];
  onCreate?: (type: string, name: string) => void;
}) {
  const { t } = useT();
  const box = useRef<HTMLDivElement>(null);
  const [typed, setTyped] = useState("");
  const [adding, setAdding] = useState(many || values.length > 1);
  // pointerdown: the click that opened it is still on its way to the document
  useDismiss(box, true, onClose, { on: "pointerdown" });
  const options = linkOptions(rows, fieldKey, target).filter(name =>
    name.toLowerCase().includes(typed.trim().toLowerCase()),
  );
  const fresh = options.some(o => o.toLowerCase() === typed.trim().toLowerCase()) ? "" : typed.trim();
  const has = (name: string) => values.some(v => v.toLowerCase() === name.toLowerCase());
  const contextOf = (name: string) => rows.find(r => r.t === name)?.props.context?.[0] ?? "";
  const pick = (name: string) => {
    if (!adding) return onChange(has(name) ? values : [name]);
    onChange(has(name) ? values.filter(v => v.toLowerCase() !== name.toLowerCase()) : [...values, name]);
  };
  return (
    <div
      ref={box}
      role="listbox"
      aria-label={`${fieldKey}: ${t("coll.options")}`}
      className="absolute left-0 top-full mt-1 z-20 w-67.5 p-1.5 rounded-xl bg-raised border border-separator shadow-md text-[12.5px] font-normal"
    >
      <input
        autoFocus
        value={typed}
        placeholder={t("coll.search")}
        aria-label={t("coll.search")}
        className="h-7 w-full px-2 rounded-md bg-fill-2 outline-none"
        onChange={e => setTyped(e.target.value)}
        onKeyDown={e => {
          if (e.key === "Enter" && options[0]) pick(options[0]);
          else if (e.key === "Enter" && fresh && create[0]) onCreate?.(create[0], fresh);
        }}
      />
      <div className="mt-1 max-h-60 overflow-y-auto">
        {options.map(name => (
          <button
            key={name}
            role="option"
            aria-selected={has(name)}
            className={`w-full h-7.5 flex items-center gap-2 px-2 rounded-md text-left cursor-pointer hover:bg-fill ${has(name) ? "bg-accent-soft" : ""}`}
            onClick={() => pick(name)}
          >
            <span className="size-4 rounded grid place-items-center text-[9px] font-bold bg-fill-2 text-ctx-a">
              {name.charAt(0).toUpperCase()}
            </span>
            <span className="flex-1 truncate">{name}</span>
            <span className="text-[11.5px] text-secondary">{contextOf(name)}</span>
            {has(name) ? <span className="text-accent-text">✓</span> : null}
          </button>
        ))}
        {fresh && onCreate
          ? create.map(type => (
              <button
                key={type}
                className="w-full h-7.5 flex items-center gap-2 px-2 rounded-md text-left cursor-pointer hover:bg-fill text-accent-text"
                onClick={() => onCreate(type, fresh)}
              >
                <span className="size-4 grid place-items-center text-[13px]">+</span>
                <span className="truncate">{t("link.create", { type, name: fresh })}</span>
              </button>
            ))
          : null}
        <button
          className={`w-full h-7.5 flex items-center px-2 rounded-md text-left cursor-pointer hover:bg-fill ${adding ? "text-accent-text" : "text-secondary"}`}
          onClick={() => setAdding(!adding)}
        >
          {t("coll.linkAnother")}
        </button>
      </div>
      <div className="h-px bg-separator m-1" />
      <div className="px-2 pt-1 pb-0.5 text-[11.5px] text-secondary">{t("coll.writes", { key: fieldKey, note })}</div>
    </div>
  );
}
