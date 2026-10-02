import { Fragment, useState } from "react";
import type { CardChoice, Pending, Question } from "../../domain/conversations/types";
import { useT } from "../hooks/useT";
import { Html } from "./Html";
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
const box = "grid grid-cols-1 gap-2.5 rounded-lg border border-accent bg-fill px-3.5 py-3";

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
            className={picked[qi]?.has(option.label) ? "btn btn-primary" : "btn"}
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

  if (isQuestion(request))
    return (
      <div className={box}>
        <div className="text-sm text-secondary">{t("card.asks")}</div>
        {questions.map(renderQuestion)}
        <div className="flex justify-end gap-2">
          <button className="btn" disabled={busy} onClick={() => onAnswer("deny")}>
            {t("card.skip")}
          </button>
          <button className="btn btn-primary" disabled={busy} onClick={answerQuestions}>
            {t("card.answer")}
          </button>
        </div>
      </div>
    );
  return (
    <div className={box}>
      <Html
        as="div"
        className="text-sm text-secondary [&_code]:font-mono [&_code]:text-xs"
        html={th("card.wants", { tool: request.tool_name, where: where ? t("card.in", { name: where }) : "" })}
      />
      <pre className="font-mono text-sm whitespace-pre-wrap wrap-anywhere text-label">{describe(request)}</pre>
      <div className="flex justify-end gap-2">
        <button className="btn" disabled={busy} onClick={() => onAnswer("deny")}>
          {t("card.deny")}
        </button>
        <button className="btn btn-primary" disabled={busy} onClick={() => onAnswer("allow")}>
          {t("card.allow")}
        </button>
      </div>
    </div>
  );
}
