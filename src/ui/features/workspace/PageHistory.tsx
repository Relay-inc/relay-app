import { useEffect, useState } from "react";
import {
  loadHistory,
  restorePage,
  type PageHistory as History,
  type PageVersion,
} from "../../../application/navigation/pages";
import { toast } from "../../../application/navigation/navigation";
import { diffLines } from "../../../domain/workspace/merge";
import { clockTime } from "../../../shared/format";
import { agoOf } from "../brain/ago";
import { useT } from "../../hooks/useT";
import { Icon } from "../../components/Icon";
import { Note } from "../../components/Note";

// what made a version, as its row says it ("" typed in a page: nothing said)
const BY = {
  claude: "page.historyBy.claude",
  disk: "page.historyBy.disk",
  relay: "page.historyBy.relay",
  restore: "page.historyBy.restore",
} as const;
const PAGE = 30;
const CONTEXT = 2; // unchanged lines shown next to a change in a diff // versions listed at a time, "Load older" adds as many

const lines = (s: string) => (s ? s.replace(/\n$/, "").split("\n") : []);
/** Lines `b` adds and removes against `a`. */
function counts(a: string, b: string) {
  return diffLines(lines(a), lines(b)).reduce(
    (n, h) => ({ added: n.added + h.lines.length, removed: n.removed + h.to - h.from }),
    { added: 0, removed: 0 },
  );
}

/** A page's history beside it (ticket 10): its versions newest first, who made each, when and how much changed; one
 *  picked shows what changed since in the page's place, with Restore. */
export function PageHistory({
  page,
  current,
  picked,
  onPick,
}: {
  page: string;
  current: string;
  picked: PageVersion | null;
  onPick: (v: PageVersion | null, kind: History["kind"]) => void;
}) {
  const { t, locale } = useT();
  const [history, setHistory] = useState<History | null>(null);
  const [err, setErr] = useState("");
  const [shown, setShown] = useState(PAGE);
  useEffect(() => {
    loadHistory(page).then(setHistory, e => setErr(String(e)));
  }, [page]);
  const versions = history?.versions ?? [];
  return (
    <aside className="w-72 flex-none min-h-0 overflow-y-auto border-l border-separator flex flex-col">
      <div className="h-10 flex-none flex items-center px-4 text-[13px] font-medium text-label">
        {t("page.history")}
      </div>
      {err ? (
        <div className="err-box m-3">{err}</div>
      ) : !history ? (
        <div className="px-4">
          <Note>{t("pr.loading")}</Note>
        </div>
      ) : history.kind === "none" || !versions.length ? (
        <div className="px-4">
          <Note>{t(history.kind === "none" ? "page.historyNone" : "page.historyEmpty")}</Note>
        </div>
      ) : (
        <ul className="flex flex-col px-2 pb-3">
          {versions.slice(0, shown).map((v, i) => {
            const n =
              v.added === undefined
                ? counts(versions[i + 1]?.text ?? "", v.text)
                : { added: v.added, removed: v.removed ?? 0 };
            const by = (v.by ?? []).flatMap(b => (b in BY ? [t(BY[b as keyof typeof BY])] : []));
            return (
              <li key={v.key}>
                <button
                  className={`w-full text-left flex flex-col gap-0.5 px-2.5 py-2 rounded-md cursor-default hover:bg-fill ${picked?.key === v.key ? "bg-accent-soft" : ""}`}
                  onClick={() => onPick(picked?.key === v.key ? null : v, history.kind)}
                >
                  <span className="flex items-center gap-2 text-[13px] text-label">
                    <span className="flex-1 min-w-0 truncate font-medium">{v.author}</span>
                    <span className="flex-none text-xs tabular-nums">
                      <span className="text-ok">+{n.added}</span> <span className="text-late">−{n.removed}</span>
                    </span>
                  </span>
                  <span className="text-xs text-tertiary truncate">
                    {[`${agoOf(v.at, t)} · ${clockTime(new Date(v.at).toISOString(), locale)}`, ...by].join(" · ")}
                  </span>
                </button>
              </li>
            );
          })}
          {versions.length > shown ? (
            <li>
              <button
                className="w-full px-2.5 py-2 text-left text-[13px] text-accent-text cursor-default"
                onClick={() => setShown(shown + PAGE)}
              >
                {t("page.historyOlder")}
              </button>
            </li>
          ) : null}
        </ul>
      )}
      {picked && current === picked.text ? (
        <div className="px-4 pb-3">
          <Note>{t("page.historySame")}</Note>
        </div>
      ) : null}
    </aside>
  );
}

/** `a` against `b` line by line: each line of `a` unchanged (" ") or gone ("-"), with what `b` has instead ("+"). */
function diffRows(a: string[], b: string[]) {
  const rows: { kind: " " | "+" | "-"; text: string }[] = [];
  let at = 0;
  for (const h of diffLines(a, b)) {
    while (at < h.from) rows.push({ kind: " ", text: a[at++] });
    while (at < h.to) rows.push({ kind: "-", text: a[at++] });
    for (const l of h.lines) rows.push({ kind: "+", text: l });
  }
  while (at < a.length) rows.push({ kind: " ", text: a[at++] });
  return rows;
}

/** What changed in a page since a version of it, line by line: green what came after it, red what it had. Read-only,
 *  with Restore (the version made the page's text again) and Back. */
export function VersionDiff({
  page,
  kind,
  version,
  current,
  onDone,
}: {
  page: string;
  kind: History["kind"];
  version: PageVersion;
  current: string;
  onDone: () => void;
}) {
  const { t, locale } = useT();
  const [busy, setBusy] = useState(false);
  const rows = diffRows(lines(version.text), lines(current));
  // unchanged runs folded to the lines next to a change
  const near = (i: number) => rows.slice(Math.max(0, i - CONTEXT), i + CONTEXT + 1).some(r => r.kind !== " ");
  const shown: ({ kind: " " | "+" | "-"; text: string } | number)[] = [];
  rows.forEach((r, i) => {
    const last = shown.length - 1;
    if (near(i)) shown.push(r);
    else if (typeof shown[last] === "number") shown[last] = shown[last] + 1;
    else shown.push(1);
  });
  const time = clockTime(new Date(version.at).toISOString(), locale);
  const restore = async () => {
    setBusy(true);
    try {
      await restorePage(page, kind, version.text);
      toast(t("page.historyRestored", { time }));
      onDone();
    } catch (e) {
      toast(String(e));
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <span className="flex-1 min-w-0 truncate text-[13px] text-secondary">
          {version.author} · {agoOf(version.at, t)} · {time}
        </span>
        <button className="h-7 px-2.5 rounded-md text-[13px] text-label hover:bg-fill" onClick={onDone}>
          {t("page.historyBack")}
        </button>
        <button
          className="flex items-center gap-1.5 h-7 px-2.5 rounded-md bg-accent text-[13px] text-on-accent disabled:opacity-50"
          disabled={busy || current === version.text}
          onClick={() => void restore()}
        >
          <Icon name="undo" className="glyph size-3.5" />
          {t("page.historyRestore")}
        </button>
      </div>
      <pre className="text-[13px] leading-6 font-mono whitespace-pre-wrap break-words rounded-lg border border-separator overflow-hidden">
        {shown.map((r, i) =>
          typeof r === "number" ? (
            <div key={i} className="px-3 py-0.5 bg-fill text-xs text-tertiary">
              {t("page.historyUnchanged", { n: r })}
            </div>
          ) : (
            <div
              key={i}
              className={`px-3 ${r.kind === "+" ? "bg-ok/10 text-label" : r.kind === "-" ? "bg-late/10 text-secondary line-through" : "text-secondary"}`}
            >
              <span className="select-none inline-block w-4 text-tertiary">
                {r.kind === "+" ? "+" : r.kind === "-" ? "−" : ""}
              </span>
              {r.text || " "}
            </div>
          ),
        )}
      </pre>
    </div>
  );
}
