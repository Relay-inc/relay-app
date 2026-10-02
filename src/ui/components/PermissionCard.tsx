import { Fragment, useState } from "react";
import type { CardChoice, Pending, Question } from "../../domain/conversations/types";
import { useT } from "../hooks/useT";
import { Html } from "./Html";
import { Icon } from "./Icon";
import { isQuestion } from "../../domain/conversations/rules";

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
  // Answer waits for something picked or typed
  const hasAnswer = questions.some((_, qi) => picked[qi]?.size || other[qi]?.trim());
  const answerQuestions = () =>
    onAnswer({
      picked: questions.map((question, qi) =>
        (question.options || []).map(option => option.label).filter(label => picked[qi]?.has(label)),
      ),
      other: questions.map((_, qi) => other[qi] ?? ""),
    });

  const renderQuestion = (question: Question, qi: number) => (
    <Fragment key={qi}>
      <div className="text-[15px] leading-[1.4] font-semibold text-label">{question.question}</div>
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
        className="h-8 rounded-lg border border-separator-strong bg-transparent px-2.5 text-[13px] text-label placeholder:text-secondary outline-none"
        placeholder={t("card.other")}
        value={other[qi] ?? ""}
        onChange={e => setOther({ ...other, [qi]: e.target.value })}
      />
    </Fragment>
  );

  if (isQuestion(request))
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
        {describe(request)}
      </pre>
      <div className="flex justify-end gap-2">
        <button className="btn cursor-pointer" disabled={busy} onClick={() => onAnswer("deny")}>
          {t("card.deny")}
        </button>
        <button className="btn btn-primary cursor-pointer" disabled={busy} onClick={() => onAnswer("allow")}>
          {t("card.allow")}
        </button>
      </div>
    </div>
  );
}
