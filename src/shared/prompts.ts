// Every prompt Relay sends to a model lives in prompts/ as a markdown file (the Rust side reads the same files with
// include_str!). They are imported here as text, one place for the frontend: `prompts.mail.draft`. A prompt with
// {{name}} placeholders goes through fill() before it is sent.
import conversationUsageLimitResume from "../../prompts/conversation/usage-limit-resume.md?raw";
import gitCommitMessage from "../../prompts/git/commit-message.md?raw";
import mailComposeForward from "../../prompts/mail/compose-forward.md?raw";
import mailComposeReply from "../../prompts/mail/compose-reply.md?raw";
import mailDraft from "../../prompts/mail/draft.md?raw";
import mailDraftReplyAll from "../../prompts/mail/draft-reply-all.md?raw";
import mailQuickReplies from "../../prompts/mail/quick-replies.md?raw";
import mailReference from "../../prompts/mail/reference.md?raw";
import mailStyle from "../../prompts/mail/style.md?raw";
import mailTicket from "../../prompts/mail/ticket.md?raw";
import mailTicketBoard from "../../prompts/mail/ticket-board.md?raw";
import mailTicketComment from "../../prompts/mail/ticket-comment.md?raw";
import mailTicketDescription from "../../prompts/mail/ticket-description.md?raw";
import mailTicketNoBoard from "../../prompts/mail/ticket-no-board.md?raw";
import mailTweak from "../../prompts/mail/tweak.md?raw";
import mailTweakDutch from "../../prompts/mail/tweak-dutch.md?raw";
import mailTweakEnglish from "../../prompts/mail/tweak-english.md?raw";
import mailTweakFormal from "../../prompts/mail/tweak-formal.md?raw";
import mailTweakShorter from "../../prompts/mail/tweak-shorter.md?raw";
import meetingsNote from "../../prompts/meetings/note.md?raw";
import meetingsPrep from "../../prompts/meetings/prep.md?raw";
import meetingsTranscript from "../../prompts/meetings/transcript.md?raw";
import pipelinePreflight from "../../prompts/pipeline/preflight.md?raw";
import pipelineResume from "../../prompts/pipeline/resume.md?raw";
import pipelineReviewComments from "../../prompts/pipeline/review-comments.md?raw";
import pullRequestsLinkTicket from "../../prompts/pull-requests/link-ticket.md?raw";
import pullRequestsReview from "../../prompts/pull-requests/review.md?raw";
import pullRequestsReviewExplain from "../../prompts/pull-requests/review-explain.md?raw";
import pullRequestsReviewFindings from "../../prompts/pull-requests/review-findings.md?raw";
import pullRequestsSecondOpinion from "../../prompts/pull-requests/second-opinion.md?raw";
import sharedUntrusted from "../../prompts/shared/untrusted.md?raw";
import sharedUntrustedNl from "../../prompts/shared/untrusted-nl.md?raw";
import timeBooking from "../../prompts/time/booking.md?raw";
import timeIntro from "../../prompts/time/intro.md?raw";
import timeIntroEmpty from "../../prompts/time/intro-empty.md?raw";

// the files end with a newline an editor adds; the prompt itself does not
const text = (raw: string) => raw.replace(/\n$/, "");

export const prompts = {
  conversation: {
    usageLimitResume: text(conversationUsageLimitResume),
  },
  git: {
    commitMessage: text(gitCommitMessage),
  },
  mail: {
    composeForward: text(mailComposeForward),
    composeReply: text(mailComposeReply),
    draft: text(mailDraft),
    draftReplyAll: text(mailDraftReplyAll),
    quickReplies: text(mailQuickReplies),
    reference: text(mailReference),
    style: text(mailStyle),
    ticket: text(mailTicket),
    ticketBoard: text(mailTicketBoard),
    ticketComment: text(mailTicketComment),
    ticketDescription: text(mailTicketDescription),
    ticketNoBoard: text(mailTicketNoBoard),
    tweak: text(mailTweak),
    tweakDutch: text(mailTweakDutch),
    tweakEnglish: text(mailTweakEnglish),
    tweakFormal: text(mailTweakFormal),
    tweakShorter: text(mailTweakShorter),
  },
  meetings: {
    note: text(meetingsNote),
    prep: text(meetingsPrep),
    transcript: text(meetingsTranscript),
  },
  pipeline: {
    preflight: text(pipelinePreflight),
    resume: text(pipelineResume),
    reviewComments: text(pipelineReviewComments),
  },
  pullRequests: {
    linkTicket: text(pullRequestsLinkTicket),
    review: text(pullRequestsReview),
    reviewExplain: text(pullRequestsReviewExplain),
    reviewFindings: text(pullRequestsReviewFindings),
    secondOpinion: text(pullRequestsSecondOpinion),
  },
  shared: {
    untrusted: text(sharedUntrusted),
    untrustedNl: text(sharedUntrustedNl),
  },
  time: {
    booking: text(timeBooking),
    intro: text(timeIntro),
    introEmpty: text(timeIntroEmpty),
  },
};

/** `template` with every {{name}} replaced by its value in `vars`. A placeholder without a value, or a value no
 *  placeholder takes, throws: a prompt that went out with "{{url}}" in it, or lost its url, is a bug to see at once.
 *  One pass over the template, so a value that holds "{{x}}" stays as it is. */
export function fill(template: string, vars: Record<string, string | number> = {}) {
  const used = new Set<string>();
  const out = template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => {
    if (!(name in vars)) throw new Error(`prompt placeholder {{${name}}} has no value`);
    used.add(name);
    return String(vars[name]);
  });
  const unused = Object.keys(vars).filter(name => !used.has(name));
  if (unused.length) throw new Error(`prompt has no placeholder for ${unused.join(", ")}`);
  return out;
}

/** Third-party text for a prompt: inside <tag>, with a closing </tag> in it made harmless so the text cannot end the
 *  block early. `attrs` become attributes of the opening tag (<mail from="…">). Say what the block is with
 *  `untrustedNote`. (src-tauri: agent_core::prompt::untrusted.) */
export function untrusted(tag: string, text: string, attrs: Record<string, string> = {}) {
  const open = Object.entries(attrs).map(([k, v]) => ` ${k}="${v.replace(/\s+/g, " ").replace(/"/g, "'")}"`);
  return `<${tag}${open.join("")}>\n${text.replace(new RegExp(`</${tag}`, "gi"), `<\\/${tag}`)}\n</${tag}>`;
}
/** The one sentence that tells the model what the blocks made by `untrusted` are: `lang` of the prompt it goes in. */
export const untrustedNote = (lang: "en" | "nl", tags: string[]) =>
  fill(lang === "nl" ? prompts.shared.untrustedNl : prompts.shared.untrusted, {
    tags: tags.map(t => `<${t}>`).join(", "),
  });
