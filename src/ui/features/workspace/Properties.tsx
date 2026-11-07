import { useEffect, useId, useState, type ReactNode } from "react";
import { openNoteLink, propertyValues, workspacePaths } from "../../../application/navigation/pages";
import { noteKnown } from "../../../application/workspace/vault";
import { noteOf } from "../../../shared/markdown";
import {
  moveProperty,
  readProperties,
  removeProperty,
  setProperty,
  typed,
  type Property,
  type PropertyKind,
  type PropertyValue as Value,
} from "../../../domain/workspace/properties";
import { noteName } from "../../../domain/navigation/pages";
import { activeFolder } from "../../../application/navigation/workspaces";
import { loadTypes, registryOf } from "../../../application/types/types";
import type { TypeField } from "../../../domain/types/registry";
import { useDerived } from "../../hooks/useDerived";
import { useT } from "../../hooks/useT";
import { Icon } from "../../components/Icon";

const FIELD =
  "h-7 w-full min-w-0 px-2 rounded-md bg-transparent text-label outline-none hover:bg-fill-2 focus:bg-fill-2 placeholder:text-tertiary";
const KINDS = ["text", "list", "date", "link", "check"] as const;
const LINK = /^\[\[([^\]\n]+)\]\]$/;
const today = () => new Date().toISOString().slice(0, 10);

/** A page's properties as rows to edit, the way Obsidian shows them: text (offering the values the key has elsewhere in
 *  the workspace), a date picker, chips for a list, a [[note]] link, a checkbox, and a select for a key the note's type
 *  gives a list of values (the type registry also picks the editor of a key that is still empty). Each change hands the new frontmatter to
 *  `onChange`; a key is removed with its ×, moved by dragging its name, added at the bottom. `children` go last (the
 *  project's conversations). Frontmatter that does not parse shows read-only. */
export function Properties({
  yaml,
  onChange,
  hide = [],
  suggest = [],
  children,
}: {
  yaml: string;
  onChange: (yaml: string) => void;
  hide?: string[]; // keys the page header shows (a typed note's fields)
  suggest?: TypeField[]; // what "Add property" offers before any other key: the type's fields the note lacks
  children?: ReactNode;
}) {
  const { t } = useT();
  const folder = useDerived(() => activeFolder());
  const registry = useDerived(() => registryOf(folder));
  useEffect(() => void loadTypes(folder), [folder]);
  const read = readProperties(yaml);
  const rows = read && typed(read, registry).filter(row => !hide.includes(row.key));
  const [kinds, setKinds] = useState<Record<string, PropertyKind>>({}); // a new, still empty key's kind
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  if (!rows) return <ReadOnly yaml={yaml}>{children}</ReadOnly>;
  const drop = (before: string | null) => {
    if (dragging) onChange(moveProperty(yaml, dragging, before));
    setDragging(null);
    setOver(null);
  };
  return (
    <dl className="grid grid-cols-[140px_minmax(0,1fr)] gap-x-4 gap-y-1 text-[13px] leading-normal">
      {rows.map(row => {
        const kind =
          row.value === null || (Array.isArray(row.value) && !row.value.length)
            ? (kinds[row.key] ?? row.kind)
            : row.kind;
        return (
          <div
            key={row.key}
            className={`contents group ${over === row.key ? "[&>*]:border-t-2 [&>*]:border-accent" : ""}`}
            onDragOver={e => {
              if (!dragging) return;
              e.preventDefault();
              setOver(row.key);
            }}
            onDrop={e => {
              e.preventDefault();
              drop(row.key);
            }}
          >
            <dt
              draggable
              title={t("props.move")}
              className="flex items-center gap-1 h-7 text-tertiary cursor-grab select-none border-t-2 border-transparent"
              onDragStart={e => {
                e.dataTransfer.effectAllowed = "move";
                setDragging(row.key);
              }}
              onDragEnd={() => {
                setDragging(null);
                setOver(null);
              }}
            >
              <span className="w-3 text-[10px] tracking-tighter opacity-0 group-hover:opacity-100">⋮⋮</span>
              <span className="truncate">{row.key}</span>
            </dt>
            <dd className="flex items-center gap-1 min-w-0 border-t-2 border-transparent">
              <Field row={{ ...row, kind }} set={value => onChange(setProperty(yaml, row.key, value))} />
              <button
                className="size-6 flex-none grid place-items-center rounded-md text-tertiary opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-fill-2 hover:text-label"
                title={t("props.remove")}
                aria-label={`${t("props.remove")}: ${row.key}`}
                onClick={() => onChange(removeProperty(yaml, row.key))}
              >
                <Icon name="close" className="glyph size-3" />
              </button>
            </dd>
          </div>
        );
      })}
      <AddProperty
        taken={read.map(row => row.key)}
        suggest={suggest}
        dropping={!!dragging}
        onDrop={() => drop(null)}
        onAdd={(key, kind) => {
          setKinds(k => ({ ...k, [key]: kind }));
          onChange(
            setProperty(yaml, key, kind === "check" ? false : kind === "date" ? today() : kind === "list" ? [] : null),
          );
        }}
      />
      {children}
    </dl>
  );
}

/** One value's editor, by kind. */
export function Field({ row, set }: { row: Property; set: (value: Value) => void }) {
  const { t } = useT();
  const list = useId();
  const { key, value, kind } = row;
  if (kind === "check")
    return (
      <span className="flex-1 h-7 flex items-center px-2">
        <input type="checkbox" checked={value === true} onChange={e => set(e.target.checked)} aria-label={key} />
      </span>
    );
  if (kind === "date")
    return (
      <input
        type="date"
        className={FIELD}
        value={typeof value === "string" ? value : ""}
        aria-label={key}
        onChange={e => set(e.target.value || null)}
      />
    );
  if (kind === "select") {
    const current = value === null ? "" : String(value);
    const invalid = !!current && !row.values?.includes(current);
    return (
      <select
        className={invalid ? FIELD.replace("text-label", "text-bad") : FIELD}
        value={current}
        aria-label={key}
        aria-invalid={invalid}
        title={invalid ? t("props.invalid") : undefined}
        onChange={e => set(e.target.value || null)}
      >
        <option value="" />
        {invalid ? <option value={current}>{current}</option> : null}
        {row.values?.map(v => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
      </select>
    );
  }
  if (kind === "raw")
    return <span className="flex-1 px-2 font-mono text-xs text-secondary whitespace-pre-wrap">{String(value)}</span>;
  if (kind === "list") return <ListField name={key} items={Array.isArray(value) ? value : []} set={set} />;
  if (kind === "link") {
    const name = typeof value === "string" ? (LINK.exec(value)?.[1] ?? value) : "";
    return (
      <>
        <TextInput
          name={key}
          value={name}
          list={list}
          options={() => Promise.resolve(noteNames())}
          set={text => set(text ? `[[${text.replace(/^\[\[|\]\]$/g, "")}]]` : null)}
        />
        {name ? (
          <button
            className="size-6 flex-none grid place-items-center rounded-md text-accent-text hover:bg-fill-2"
            title={t("props.open")}
            aria-label={`${t("props.open")}: ${name}`}
            onClick={() => void openNoteLink(name.split("|")[0])}
          >
            <Icon name="right" className="glyph size-3" />
          </button>
        ) : null}
      </>
    );
  }
  return (
    <TextInput
      name={key}
      value={value === null ? "" : String(value)}
      list={list}
      options={() => propertyValues(key)}
      set={text =>
        set(
          !text.trim() ? null : typeof value === "number" && /^-?\d+(\.\d+)?$/.test(text.trim()) ? Number(text) : text,
        )
      }
    />
  );
}

/** The workspace's note names, for a [[link]] to pick. */
const noteNames = () => [...new Set(workspacePaths().map(path => noteName(path)))];

/** A text box that saves on Enter or when it loses focus, and goes back to the value on Escape; `options` fill its
 *  native suggestion list the first time it gets focus. */
function TextInput({
  name,
  value,
  list,
  options,
  set,
  placeholder,
  clearAfter,
}: {
  name: string;
  value: string;
  list: string;
  options?: () => Promise<string[]>;
  set: (text: string) => void;
  placeholder?: string;
  clearAfter?: boolean; // a list's "add" box: empty again after each item
}) {
  const [choices, setChoices] = useState<string[] | null>(null);
  const commit = (input: HTMLInputElement) => {
    if (input.value === value) return;
    set(input.value);
    if (clearAfter) input.value = "";
  };
  return (
    <>
      <input
        key={value}
        className={FIELD}
        defaultValue={value}
        aria-label={name}
        placeholder={placeholder}
        list={options ? list : undefined}
        onFocus={() => {
          if (options && !choices) void options().then(setChoices);
        }}
        onBlur={e => commit(e.currentTarget)}
        onKeyDown={e => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing) {
            e.preventDefault();
            commit(e.currentTarget);
          }
          if (e.key === "Escape") {
            e.currentTarget.value = value;
            e.currentTarget.blur();
          }
        }}
      />
      {choices ? (
        <datalist id={list}>
          {choices.map(choice => (
            <option key={choice} value={choice} />
          ))}
        </datalist>
      ) : null}
    </>
  );
}

/** A list's items as chips, each with its ×, and a box after them to add one. */
function ListField({ name, items, set }: { name: string; items: string[]; set: (value: Value) => void }) {
  const { t } = useT();
  const list = useId();
  return (
    <span className="flex-1 min-w-0 flex flex-wrap items-center gap-1.5 py-0.5">
      {items.map((item, i) => (
        <span key={i} className="flex items-center gap-1 pl-2 pr-0.5 rounded-md bg-fill-2 text-label wrap-anywhere">
          <PropertyValue value={item} />
          <button
            className="size-4 grid place-items-center rounded-sm text-tertiary hover:text-label"
            aria-label={`${t("props.remove")}: ${item}`}
            onClick={() => set(items.filter((_, j) => j !== i))}
          >
            <Icon name="close" className="glyph size-2.5" />
          </button>
        </span>
      ))}
      <span className="flex-1 min-w-24">
        <TextInput
          name={name}
          value=""
          list={list}
          options={() => propertyValues(name)}
          placeholder={t("props.addItem")}
          clearAfter
          set={text => text.trim() && set([...items, text.trim()])}
        />
      </span>
    </span>
  );
}

const KIND_OF: Record<TypeField["kind"], PropertyKind> = {
  text: "text",
  select: "text",
  date: "date",
  link: "link",
  people: "list",
  check: "check",
};
/** "Add property" at the bottom: the type's missing fields first (`suggest`), then "Other" for a name and a kind; also
 *  where a dragged key lands to go last. */
function AddProperty({
  taken,
  suggest,
  dropping,
  onDrop,
  onAdd,
}: {
  taken: string[];
  suggest: TypeField[];
  dropping: boolean;
  onDrop: () => void;
  onAdd: (key: string, kind: PropertyKind) => void;
}) {
  const { t } = useT();
  const [open, setOpen] = useState<false | "menu" | "other">(false);
  const [kind, setKind] = useState<PropertyKind>("text");
  const [error, setError] = useState(false);
  const add = (input: HTMLInputElement | null) => {
    const key = input?.value.trim() ?? "";
    if (!key) return setOpen(false);
    if (taken.includes(key) || !/^[^\s:#\-[\]{},&*!|>'"%@`][^:#]*$/.test(key)) return setError(true);
    onAdd(key, kind);
    setOpen(false);
    setKind("text");
  };
  return (
    <div
      className="col-span-2"
      onDragOver={e => {
        if (dropping) e.preventDefault();
      }}
      onDrop={e => {
        e.preventDefault();
        onDrop();
      }}
    >
      {open === "menu" ? (
        <div className="flex flex-wrap items-center gap-1.5 py-0.5" role="group" aria-label={t("props.add")}>
          {suggest.map(field => (
            <button
              key={field.key}
              className="h-6.5 px-2 rounded-md border border-separator text-label hover:bg-fill"
              onClick={() => {
                onAdd(field.key, KIND_OF[field.kind]);
                setOpen(false);
              }}
            >
              {field.key}
            </button>
          ))}
          <button className="h-6.5 px-2 rounded-md text-secondary hover:bg-fill" onClick={() => setOpen("other")}>
            {t("props.other")}
          </button>
        </div>
      ) : open ? (
        <form
          className="flex items-center gap-2 h-8"
          onSubmit={e => {
            e.preventDefault();
            add(e.currentTarget.elements.namedItem("key") as HTMLInputElement);
          }}
        >
          <input
            name="key"
            autoFocus
            className={`${FIELD} max-w-44 border ${error ? "border-bad" : "border-separator"}`}
            placeholder={t("props.name")}
            aria-label={t("props.name")}
            aria-invalid={error}
            onChange={() => setError(false)}
            onKeyDown={e => e.key === "Escape" && setOpen(false)}
          />
          <select
            className="h-7 px-1.5 rounded-md border border-separator bg-bg text-label"
            aria-label={t("props.kind")}
            value={kind}
            onChange={e => setKind(e.target.value as PropertyKind)}
          >
            {KINDS.map(k => (
              <option key={k} value={k}>
                {t(`props.kind.${k}`)}
              </option>
            ))}
          </select>
          <button className="h-7 px-2.5 rounded-md bg-accent text-on-accent hover:opacity-90">
            {t("props.addButton")}
          </button>
          <button
            type="button"
            className="h-7 px-2 rounded-md text-secondary hover:bg-fill-2"
            onClick={() => setOpen(false)}
          >
            {t("props.cancel")}
          </button>
        </form>
      ) : (
        <button
          className="flex items-center gap-1.5 h-7 px-1 rounded-md text-tertiary hover:text-label"
          onClick={() => setOpen(suggest.length ? "menu" : "other")}
        >
          <Icon name="plus" className="glyph size-3" />
          {t("props.add")}
        </button>
      )}
    </div>
  );
}

/** Frontmatter Relay can't edit safely (it does not parse): its lines as they are. */
function ReadOnly({ yaml, children }: { yaml: string; children?: ReactNode }) {
  return (
    <dl className="grid grid-cols-[140px_minmax(0,1fr)] gap-x-4 gap-y-2 text-[13px] leading-normal">
      <dd className="col-span-2 font-mono text-xs text-secondary whitespace-pre-wrap">{yaml}</dd>
      {children}
    </dl>
  );
}

/** A property's [[link]] as its label, the rest as written. */
const linkLabel = (value: string) =>
  value.replace(/\[\[([^\]\n]+)\]\]/g, (_, inner: string) => inner.split("|").pop()!.trim());

/** A property's value: a [[link]] in it opens the note when it exists, the rest as written. */
function PropertyValue({ value }: { value: string }) {
  return value.split(/(\[\[[^\]\n]+\]\])/).map((part, i) => {
    const link = /^\[\[([^\]\n]+)\]\]$/.exec(part);
    if (!link) return part;
    const target = noteOf(link[1]);
    return noteKnown(target) ? (
      <a key={i} className="vlink text-accent cursor-pointer" href="#" data-note={target}>
        {linkLabel(part)}
      </a>
    ) : (
      linkLabel(part)
    );
  });
}
