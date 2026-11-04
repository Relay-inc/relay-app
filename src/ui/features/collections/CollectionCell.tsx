import { useEffect, useRef, useState } from "react";
import { dayMonth } from "../../../shared/format";
import {
  isDerived,
  stageOf,
  valuesOf,
  type Column,
  type CollectionId,
  type Row,
} from "../../../domain/collections/rules";
import { setCell } from "../../../application/collections/collections";
import { openPage } from "../../../application/navigation/pages";
import { useT } from "../../hooks/useT";
import { StageGlyph } from "../today/StageGlyph";
import { LinkEditor } from "./LinkEditor";

const CHIP =
  "h-5 inline-flex items-center px-1.75 rounded-md border border-separator-strong bg-raised text-accent-text text-xs";
const initials = (name: string) =>
  name
    .split(/\s+/)
    .map(w => w.charAt(0))
    .join("")
    .slice(0, 2)
    .toUpperCase();
/** Whether a click on this cell edits it: a column of a stored property, never a derived value, the title or the mtime. */
export const editable = (collection: CollectionId, column: Column) =>
  !isDerived(collection, column.key) && column.kind !== "title" && column.kind !== "time";

/** What a cell shows, by its column's kind. */
export function CellValue({ row, column, today }: { row: Row; column: Column; today: string }) {
  const { t, locale } = useT();
  const values = valuesOf(row, column.key);
  switch (column.kind) {
    case "title":
      return (
        <button
          className="max-w-full truncate font-medium text-left cursor-pointer hover:underline"
          onClick={() => openPage(row.p)}
        >
          {row.t}
        </button>
      );
    case "date":
      return <span className="text-secondary tabular-nums">{values[0] ? dayMonth(values[0], locale) : ""}</span>;
    case "time":
      return (
        <span className="text-secondary tabular-nums">{dayMonth(new Date(row.at * 1000).toISOString(), locale)}</span>
      );
    case "stage": {
      const stage = stageOf(row, today);
      if (!stage) return null;
      const unwrapped = stage === "unwrapped";
      return (
        <span
          className={`inline-flex items-center gap-1.5 ${unwrapped ? "text-soon" : stage === "wrapped" ? "" : "text-secondary"}`}
        >
          <StageGlyph
            glyph={{
              stage: unwrapped ? (row.stage as "planned") : (stage as "planned"),
              followed: false,
              dashed: unwrapped,
            }}
          />
          {unwrapped ? t("coll.unwrapped") : t(`meet.stageName.${stage as "planned"}`)}
        </span>
      );
    }
    case "links":
      return (
        <span className="inline-flex gap-1 min-w-0">
          {values.map(v => (
            <span key={v} className={`${CHIP} truncate`}>
              {v}
            </span>
          ))}
        </span>
      );
    case "people":
      return (
        <span className="inline-flex gap-1 min-w-0 overflow-hidden">
          {values.map(v => (
            <span
              key={v}
              className="h-5 inline-flex items-center gap-1 pl-0.5 pr-1.75 rounded-full bg-fill-2 text-xs whitespace-nowrap"
            >
              <span className="size-4 rounded-full grid place-items-center text-[8px] font-bold bg-fill text-ctx-a">
                {initials(v)}
              </span>
              {v}
            </span>
          ))}
        </span>
      );
    case "status":
      return values[0] ? (
        <span className="h-5 inline-flex items-center px-2 rounded-xl bg-fill-2 text-xs">{values[0]}</span>
      ) : null;
    default:
      return <span className="text-secondary truncate">{column.key === "type" ? row.k : values.join(", ")}</span>;
  }
}

/** The editor of one cell, over it: the links' listbox, a date picker or a text box. Each change writes the note. */
export function CellEditor({
  row,
  column,
  rows,
  onClose,
}: {
  row: Row;
  column: Column;
  rows: Row[];
  onClose: () => void;
}) {
  const values = valuesOf(row, column.key);
  const file = row.p.split("/").pop() ?? row.p;
  if (column.kind === "links" || column.kind === "people")
    return (
      <LinkEditor
        rows={rows}
        fieldKey={column.key}
        note={file}
        values={values}
        onClose={onClose}
        onChange={next =>
          void setCell(
            row.p,
            column.key,
            next.length > 1 ? next.map(v => `[[${v}]]`) : next.length ? `[[${next[0]}]]` : null,
          )
        }
      />
    );
  return <TextCell row={row} column={column} value={values[0] ?? ""} onClose={onClose} />;
}

function TextCell({ row, column, value, onClose }: { row: Row; column: Column; value: string; onClose: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [done, setDone] = useState(false);
  useEffect(() => input.current?.focus(), []);
  const commit = () => {
    if (done) return;
    setDone(true);
    const next = input.current?.value.trim() ?? "";
    if (next !== value) void setCell(row.p, column.key, next || null);
    onClose();
  };
  return (
    <input
      ref={input}
      type={column.kind === "date" ? "date" : "text"}
      defaultValue={value}
      aria-label={column.key}
      className="h-7 w-full px-2 rounded-md bg-fill-2 outline-none"
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === "Enter" && !e.nativeEvent.isComposing) commit();
        if (e.key === "Escape") {
          setDone(true);
          onClose();
        }
      }}
    />
  );
}
