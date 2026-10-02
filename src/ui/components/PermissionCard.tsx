import { Fragment, useEffect, useEffectEvent, useState, useSyncExternalStore } from "react";
import type { CardChoice, Pending, Question } from "../../domain/conversations/types";
import { useNavigationStore } from "../../application/navigation/store";
import { useT } from "../hooks/useT";
import { Html } from "./Html";
import { Icon } from "./Icon";
import { Highlighted } from "./Highlighted";
import { isQuestion } from "../../domain/conversations/rules";

// ---------- Enter allows a permission card, but only when it is the one card on screen that can be allowed: with two
// (the Waiting view) it would be a guess. The composer takes Enter when it is empty (allowOnlyCard), any other field,
// button or link keeps its own Enter
const allowable = new Set<() => void>();
const listeners = new Set<() => void>();
const changed = () => listeners.forEach(listener => listener());
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const isOnlyCard = () => allowable.size === 1;
/** Allows the one permission card on screen. Whether there was exactly one. */
export function allowOnlyCard() {
  const { panel, zoom, quickAsk } = useNavigationStore.getState();
  if (allowable.size !== 1 || panel.modal || zoom || quickAsk) return false;
  [...allowable][0]();
  return true;
}
window.addEventListener("keydown", e => {
  if (e.key !== "Enter" || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey || e.isComposing || e.repeat) return;
  if (e.defaultPrevented) return;
  const inControl = e
    .composedPath()
    .some(node => node instanceof HTMLElement && node.matches("input, textarea, select, button, a, [contenteditable]"));
  if (!inControl && allowOnlyCard()) e.preventDefault();
});

// what a permission card shows: the command, the file (and what is written to it), or the input as it is
function describe(request: Pending): string {
  const input = request.input || {};
  if (request.tool_name === "Bash") return String(input.command ?? "");
  if (input.file_path)
    return String(input.file_path) + (input.content ? `\n\n${String(input.content).slice(0, 600)}` : "");
  return JSON.stringify(input, null, 2).slice(0, 900);
}

// a long path never widens the card past its border
const box = "grid grid-cols-1 gap-2.5 rounded-xl border border-accent bg-raised ring-3 ring-accent-soft px-3.5 py-3";
// the icon in front of what the card asks
const badge = (name: string) => (
  <span className="grid place-items-center size-5.5 flex-none rounded-md bg-accent-soft text-accent-text">
    <Icon name={name} className="glyph size-3.5" />
  </span>
);

/** A pending permission or question of an agent, waiting for the user. `where`: the conversation it belongs to when
 *  shown outside it. The container answers (`onAnswer`, e.g. the `answer` use case) and sets `busy` while it does;
 *  a card that is not answered stays usable. */
export function PermissionCard({
  request,
  where = "",
  busy = false,
  onAnswer,
}: {
  request: Pending;
  where?: string;
  busy?: boolean;
  onAnswer: (choice: CardChoice) => void;
}) {
  const { t, th } = useT();
  const question = isQuestion(request);
  // this card is the one Enter allows while it waits alone (allowOnlyCard)
  const only = useSyncExternalStore(subscribe, isOnlyCard);
  const allowByKey = useEffectEvent(() => onAnswer("allow"));
  useEffect(() => {
    if (busy || question) return;
    const allow = () => allowByKey();
    allowable.add(allow);
    changed();
    return () => {
      allowable.delete(allow);
      changed();
    };
  }, [busy, question]);
  // the options picked per question, and what is typed in its "other" field
  const [picked, setPicked] = useState<Record<number, Set<string>>>({});
  const [other, setOther] = useState<Record<number, string>>({});

  const pick = (questionIndex: number, option: string, multiple: boolean) => {
    const current = picked[questionIndex];
    const next = new Set(multiple ? current : current?.has(option) ? [option] : []);
    if (next.has(option)) next.delete(option);
    else next.add(option);
    setPicked({ ...picked, [questionIndex]: next });
  };
  const questions = request.input.questions || [];
  const answerQuestions = () =>
    onAnswer({
      picked: questions.map((question, qi) =>
        (question.options || []).map(option => option.label).filter(label => picked[qi]?.has(label)),
      ),
      other: questions.map((_, qi) => other[qi] ?? ""),
    });

  const renderQuestion = (question: Question, qi: number) => (
    <Fragment key={qi}>
      <div className="text-base font-semibold text-label">{question.question}</div>
      <div className="flex flex-wrap gap-2">
        {(question.options || []).map(option => (
          <button
            key={option.label}
            className={picked[qi]?.has(option.label) ? "btn btn-primary cursor-pointer" : "btn cursor-pointer"}
            title={option.description || ""}
            disabled={busy}
            onClick={() => pick(qi, option.label, !!question.multiSelect)}
          >
            {option.label}
          </button>
        ))}
      </div>
      <input
        className="rounded-md border border-separator bg-bg px-2.5 py-1.5 text-sm text-label placeholder:text-secondary"
        placeholder={t("card.other")}
        value={other[qi] ?? ""}
        onChange={e => setOther({ ...other, [qi]: e.target.value })}
      />
    </Fragment>
  );

  if (question)
    return (
      <div className={box}>
        <div className="flex items-center gap-2 text-[13px] text-secondary">
          {badge("chat")}
          {t("card.asks")}
        </div>
        {questions.map(renderQuestion)}
        <div className="flex justify-end gap-2">
          <button className="btn cursor-pointer" disabled={busy} onClick={() => onAnswer("deny")}>
            {t("card.skip")}
          </button>
          <button className="btn btn-primary cursor-pointer" disabled={busy} onClick={answerQuestions}>
            {t("card.answer")}
          </button>
        </div>
      </div>
    );
  return (
    <div className={box}>
      <div className="flex items-center gap-2 text-[13px] text-secondary [&_b]:text-label [&_b]:font-semibold">
        {badge("term")}
        <Html html={th("card.wants", { tool: request.tool_name, where: where ? t("card.in", { name: where }) : "" })} />
      </div>
      <pre className="px-3 py-2.5 rounded-lg bg-well border border-separator font-mono text-[13px] whitespace-pre-wrap wrap-anywhere text-label">
        {request.tool_name === "Bash" ? <Highlighted code={describe(request)} lang="bash" /> : describe(request)}
      </pre>
      <div className="flex justify-end gap-2">
        <button className="btn cursor-pointer" disabled={busy} onClick={() => onAnswer("deny")}>
          {t("card.deny")}
        </button>
        <button
          className="btn btn-primary cursor-pointer inline-flex items-center gap-2"
          disabled={busy}
          onClick={() => onAnswer("allow")}
        >
          {t("card.allow")}
          {only && !busy ? (
            <span className="text-[11px] opacity-70" aria-hidden="true">
              ↵
            </span>
          ) : null}
        </button>
      </div>
    </div>
  );
}
