import { useEffect, useState, type ReactNode } from "react";
import { readProperties, setProperty, type PropertyValue } from "../../../domain/workspace/properties";
import { DECOR_KEYS } from "../../../domain/workspace/decor";
import { headerOf, type Header, type Slot } from "../../../domain/types/header";
import { activeFolder } from "../../../application/navigation/workspaces";
import { followPageLink } from "../../../application/navigation/pages";
import { toast } from "../../../application/navigation/navigation";
import { loadTemplates } from "../../../application/navigation/kb";
import { loadRows } from "../../../application/collections/collections";
import { useCollectionsStore } from "../../../application/collections/store";
import { createLinked, loadTypes, registryOf, templateOf } from "../../../application/types/types";
import { useDerived } from "../../hooks/useDerived";
import { useT } from "../../hooks/useT";
import { Icon } from "../../components/Icon";
import { LinkEditor } from "../collections/LinkEditor";
import { Field, Properties } from "./Properties";

/** The name a [[link]] value points at ("" for none): `"[[Sofie Claes|Sofie]]"` is Sofie Claes. */
const nameOf = (value: unknown) =>
  typeof value === "string"
    ? value
        .replace(/^\[\[|\]\]$/g, "")
        .split(/[|#]/)[0]
        .trim()
    : "";
const namesOf = (value: PropertyValue) => (Array.isArray(value) ? value : [value]).map(nameOf).filter(Boolean);

/** A page's header (issue 419): `icon` (any node: the project's icon, a file glyph, an emoji) beside the title, and for
 *  a note whose `type:` the registry knows, its type chip, the breadcrumb of its `context:` and `about:` and its type's
 *  fields, each with its editor; a required field it lacks is an empty, highlighted slot. Every other key is the plain
 *  Properties list under it, and all of a note without a known type. Each change hands the new frontmatter to
 *  `onChange`; `children` go last in the properties (the project's conversations). */
export function PageHeader({
  icon,
  title,
  yaml,
  onChange,
  children,
}: {
  icon: ReactNode;
  title: string;
  yaml: string;
  onChange: (yaml: string) => void;
  children?: ReactNode;
}) {
  const folder = useDerived(() => activeFolder());
  const registry = useDerived(() => registryOf(folder));
  useEffect(() => void loadTypes(folder), [folder]);
  const read = readProperties(yaml);
  const header = read && headerOf(read, registry);
  const set = (key: string, value: PropertyValue) => onChange(setProperty(yaml, key, value));
  return (
    <header className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <span data-page-icon className="size-11 flex-none grid place-items-center rounded-lg bg-fill-2 text-xl">
          {icon}
        </span>
        <div className="min-w-0 flex flex-col gap-1">
          <h1 className="text-3xl font-semibold tracking-tight text-pretty">{title}</h1>
          {header ? <TypeLine header={header} types={registry.types.map(t => t.name)} set={set} /> : null}
        </div>
      </div>
      {header ? (
        <div
          data-type-fields
          className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-x-4 gap-y-1 text-[13px] leading-normal"
        >
          {header.slots.map(slot => (
            <FieldSlot
              key={slot.field.key}
              slot={slot}
              type={header.type.name}
              note={title}
              header={header}
              set={set}
            />
          ))}
        </div>
      ) : null}
      <Properties
        yaml={yaml}
        onChange={onChange}
        hide={[...DECOR_KEYS, ...(header ? ["type", ...header.slots.map(s => s.field.key)] : [])]}
        suggest={header?.absent ?? []}
      >
        {children}
      </Properties>
    </header>
  );
}

/** The type chip (a select of the registry's types) and the breadcrumb Context › Project from `context:` and `about:`. */
function TypeLine({
  header,
  types,
  set,
}: {
  header: Header;
  types: string[];
  set: (key: string, value: PropertyValue) => void;
}) {
  const { t } = useT();
  const value = (key: string) => nameOf(header.slots.find(s => s.field.key === key)?.row.value);
  const crumbs = [value("context"), value("about")].filter((name, i, all) => name && all.indexOf(name) === i);
  return (
    <div className="flex items-center gap-2 min-w-0 text-[13px] text-secondary">
      <select
        aria-label={t("header.type")}
        className="h-5.5 pl-1.5 pr-1 rounded-md bg-accent-soft text-accent-text text-xs font-medium outline-none cursor-pointer"
        value={header.type.name}
        onChange={e => set("type", e.target.value)}
      >
        {types.map(name => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
      <nav data-type-crumbs className="flex items-center gap-1.5 min-w-0 whitespace-nowrap">
        {crumbs.map((name, i) => (
          <span key={name} className="contents">
            {i ? <Icon name="right" className="glyph size-3 flex-none text-tertiary" /> : null}
            <button className="truncate hover:text-accent-text" onClick={() => void followPageLink(name, false)}>
              {name}
            </button>
          </span>
        ))}
      </nav>
    </div>
  );
}

/** One field of the type: its key and its editor; a link or people field picks notes of its target types. */
function FieldSlot({
  slot,
  type,
  note,
  header,
  set,
}: {
  slot: Slot;
  type: string;
  note: string;
  header: Header;
  set: (key: string, value: PropertyValue) => void;
}) {
  const { t } = useT();
  const { field, row, missing } = slot;
  const link = field.kind === "link" || field.kind === "people";
  return (
    <div
      data-slot={field.key}
      data-missing={missing || undefined}
      title={missing ? t("header.missing", { type, key: field.key }) : undefined}
      className={`flex items-center gap-2 min-w-0 min-h-7 pl-2 rounded-md border ${
        missing ? "border-dashed border-accent bg-accent-soft" : "border-transparent"
      }`}
    >
      <span className={`w-20 flex-none truncate ${missing ? "text-accent-text" : "text-tertiary"}`}>{field.key}</span>
      {link ? (
        <LinkSlot
          slot={slot}
          note={note}
          context={nameOf(header.slots.find(s => s.field.key === "context")?.row.value)}
          set={set}
        />
      ) : (
        <Field row={row} set={value => set(field.key, value)} />
      )}
    </div>
  );
}

/** A link field's notes as chips that open them, and the picker of its target types, which can also make one. */
function LinkSlot({
  slot,
  note,
  context,
  set,
}: {
  slot: Slot;
  note: string;
  context: string;
  set: (key: string, value: PropertyValue) => void;
}) {
  const { t } = useT();
  const { field, row } = slot;
  const folder = useDerived(() => activeFolder());
  const rows = useCollectionsStore(s => s.rows[folder]) ?? [];
  const create = useDerived(() => (field.target ?? []).filter(type => templateOf(folder, type)));
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    void loadRows(folder);
    void loadTemplates(folder);
  }, [open, folder]);
  const many = field.kind === "people";
  const values = namesOf(row.value);
  const write = (names: string[]) =>
    set(field.key, many ? names.map(n => `[[${n}]]`) : names[0] ? `[[${names[names.length - 1]}]]` : null);
  return (
    <div className="relative flex-1 min-w-0 flex flex-wrap items-center gap-1 py-0.5">
      {values.map(name => (
        <button
          key={name}
          className="h-6 px-2 rounded-md bg-fill-2 text-accent-text truncate max-w-full hover:underline"
          onClick={() => void followPageLink(name, false)}
        >
          {name}
        </button>
      ))}
      <button
        className="h-6 px-1.5 grid place-items-center rounded-md text-tertiary hover:bg-fill-2 hover:text-label"
        aria-label={`${t("props.addButton")}: ${field.key}`}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {values.length ? <Icon name="edit" className="glyph size-3" /> : t("props.addButton")}
      </button>
      {open ? (
        <LinkEditor
          rows={rows}
          fieldKey={field.key}
          note={note}
          values={values}
          target={field.target}
          many={many}
          create={create}
          onChange={names => {
            write(names);
            if (!many) setOpen(false);
          }}
          onCreate={(type, name) =>
            void createLinked(folder, type, name, context).then(
              made => {
                write(many ? [...values, made] : [made]);
                setOpen(false);
              },
              e => toast(String(e)),
            )
          }
          onClose={() => setOpen(false)}
        />
      ) : null}
    </div>
  );
}
