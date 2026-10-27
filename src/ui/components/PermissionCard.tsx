import { Fragment, useEffect, useEffectEvent, useState, useSyncExternalStore } from "react";
import type { CardChoice, Pending, Question } from "../../domain/conversations/types";
import { useNavigationStore } from "../../application/navigation/store";
import { isKey, pickedAnswer } from "../../application/settings/settings";
import { useT } from "../hooks/useT";
import { Html } from "./Html";
import { Icon } from "./Icon";
import { Highlighted } from "./Highlighted";
import { Markdown } from "./Markdown";
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
  if (!isKey(e, "card.confirm") || e.isComposing || e.repeat) return;
  if (e.defaultPrevented) return;
  const inControl = e
    .composedPath()
    .some(node => node instanceof HTMLElement && node.matches("input, textarea, select, button, a, [contenteditable]"));
  if (!inControl && allowOnlyCard()) e.preventDefault();
});

// what a permission card shows: the command, the file (and what is written to it), or the input as it is
export function describe(request: Pending): string {
  const input = request.input || {};
  if (request.tool_name === "Bash") return String(input.command ?? "");
  if (typeof input.plan === "string") return input.plan;
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
  keys = false,
  onAnswer,
}: {
  request: Pending;
  where?: string;
  busy?: boolean;
  keys?: boolean; // Today: 1 to 9 pick an option of the question still open, Enter sends the answer
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
  // the options picked per question, what is typed in its "other" field, the note on its choice, and the option whose
  // preview shows (the one last pointed at or picked)
  const [picked, setPicked] = useState<Record<number, Set<string>>>({});
  const [other, setOther] = useState<Record<number, string>>({});
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [shown, setShown] = useState<Record<number, string>>({});

  const pick = (questionIndex: number, option: string, multiple: boolean) => {
    const current = picked[questionIndex];
    const next = new Set(multiple ? current : current?.has(option) ? [option] : []);
    if (next.has(option)) next.delete(option);
    else next.add(option);
    setPicked({ ...picked, [questionIndex]: next });
    setShown({ ...shown, [questionIndex]: option });
  };
  const questions = request.input.questions || [];
  // Answer waits for something picked or typed
  const hasAnswer = questions.some((_, qi) => picked[qi]?.size || other[qi]?.trim());
  const answerQuestions = () =>
    onAnswer({
      picked: questions.map((question, qi) =>
        (question.options || []).map(option => option.label).filter(label => picked[qi]?.has(label)),
      ),
      other: questions.map((_, qi) => other[qi] ?? ""),
      notes: questions.map((_, qi) => notes[qi] ?? ""),
    });

  // the question the number keys answer: the first one nothing is picked for yet, else the last
  const open = questions.findIndex((_, qi) => !picked[qi]?.size);
  const current = open < 0 ? questions.length - 1 : open;
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (busy || e.isComposing || e.defaultPrevented) return;
    const inField = e
      .composedPath()
      .some(node => node instanceof HTMLElement && node.matches("input, textarea, select, [contenteditable]"));
    if (inField) return;
    const options = questions[current]?.options ?? [];
    const n = pickedAnswer(e);
    if (n >= 1 && n <= Math.min(9, options.length)) {
      e.preventDefault();
      pick(current, options[n - 1].label, !!questions[current].multiSelect);
    } else if (isKey(e, "card.confirm") && hasAnswer && !(e.target instanceof HTMLButtonElement)) {
      e.preventDefault();
      answerQuestions();
    }
  });
  useEffect(() => {
    if (!keys || !question) return;
    const listener = (e: KeyboardEvent) => onKey(e);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [keys, question]);

  const renderQuestion = (question: Question, qi: number) => {
    const options = question.options || [];
    const preview = (options.find(option => option.label === shown[qi]) ?? options.find(option => option.preview))
      ?.preview;
    return (
      <Fragment key={qi}>
        <div className="text-[15px] leading-[1.4] font-semibold text-label">{question.question}</div>
        <div className="flex flex-wrap gap-2">
          {(question.options || []).map((option, oi) => (
            <button
              key={option.label}
              className={`${picked[qi]?.has(option.label) ? "btn btn-primary" : "btn"} cursor-pointer inline-flex items-center gap-2`}
              title={option.description || ""}
              disabled={busy}
              onClick={() => pick(qi, option.label, !!question.multiSelect)}
              onMouseEnter={() => option.preview && setShown({ ...shown, [qi]: option.label })}
              onFocus={() => option.preview && setShown({ ...shown, [qi]: option.label })}
            >
              {option.label}
              {keys && qi === current && oi < 9 ? (
                <span
                  className="font-mono text-[11px] opacity-60 px-1 rounded border border-current leading-4"
                  aria-hidden="true"
                >
                  {oi + 1}
                </span>
              ) : null}
            </button>
          ))}
        </div>
        <input
          className="h-8 rounded-lg border border-separator-strong bg-transparent px-2.5 text-[13px] text-label placeholder:text-secondary outline-none"
          placeholder={t("card.other")}
          value={other[qi] ?? ""}
          onChange={e => setOther({ ...other, [qi]: e.target.value })}
        />
        {preview ? (
          <pre className="max-h-64 overflow-auto rounded-lg border border-separator bg-well px-2.5 py-2 font-mono text-xs leading-normal text-label whitespace-pre select-text">
            {preview}
          </pre>
        ) : null}
        {picked[qi]?.size ? (
          <input
            className="h-8 rounded-lg border border-separator-strong bg-transparent px-2.5 text-[13px] text-label placeholder:text-secondary outline-none"
            placeholder={t("card.note")}
            value={notes[qi] ?? ""}
            onChange={e => setNotes({ ...notes, [qi]: e.target.value })}
          />
        ) : null}
      </Fragment>
    );
  };

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
          <button
            className="btn btn-primary cursor-pointer disabled:opacity-50"
            disabled={busy || !hasAnswer}
            onClick={answerQuestions}
          >
            {t("card.answer")}
            {keys && hasAnswer && !busy ? <span className="text-[11px] opacity-70 ml-1.5">↵</span> : null}
          </button>
        </div>
      </div>
    );
  const allowButton = (
    <button
      className="btn btn-primary cursor-pointer inline-flex items-center justify-center gap-2"
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
  );
  // leaving plan mode: the plan as a document over the full width, the decision under it
  if (request.tool_name === "ExitPlanMode" && typeof request.input.plan === "string")
    return (
      <div className={box}>
        <div className="flex items-center gap-2 text-[13px] text-secondary">
          {badge("list")}
          {t("card.plan", { where: where ? t("card.in", { name: where }) : "" })}
        </div>
        <div className="max-h-[60vh] overflow-y-auto rounded-lg bg-well border border-separator px-4 py-3 select-text">
          <Markdown className="md-note" text={request.input.plan} />
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <p className="flex-1 min-w-48 text-[13px] leading-normal text-secondary">{t("card.planAsk")}</p>
          <button className="btn cursor-pointer" disabled={busy} onClick={() => onAnswer("deny")}>
            {t("card.deny")}
          </button>
          {allowButton}
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
        {request.suggestions?.length ? (
          <button className="btn cursor-pointer" disabled={busy} onClick={() => onAnswer("always")}>
            {t("card.always")}
          </button>
        ) : null}
        {allowButton}
      </div>
    </div>
  );
}
