import type { Entry, SubjectType } from "../../../../domain/today/kinds/types";
import { AskSection } from "./AskSection";
import { BlockedSection } from "./BlockedSection";
import { CaptureSection } from "./CaptureSection";
import { CardSection, cardFacts, cardLoad } from "./CardSection";
import { ChatSection } from "./ChatSection";
import { MailSection, mailFacts, mailLoad } from "./MailSection";
import { MeetingSection, meetingFacts } from "./MeetingSection";
import { PrSection, prFacts, prLoad } from "./PrSection";
import { ReminderSection, reminderFacts } from "./ReminderSection";
import { TimeSection } from "./TimeSection";
import type { SectionDef } from "./types";

/** The detail section of each kind of item, by subject type. */
export const SECTIONS: { [T in SubjectType]: SectionDef<T> } = {
  ask: { Body: AskSection },
  blocked: { Body: BlockedSection },
  meeting: { Body: MeetingSection, facts: meetingFacts },
  reminder: { Body: ReminderSection, facts: reminderFacts },
  card: { Body: CardSection, facts: cardFacts, load: cardLoad },
  pr: { Body: PrSection, facts: prFacts, load: prLoad },
  mail: { Body: MailSection, facts: mailFacts, load: mailLoad },
  chat: { Body: ChatSection },
  time: { Body: TimeSection },
  capture: { Body: CaptureSection },
};
/** The section of an entry. */
export const sectionOf = (entry: Entry) => SECTIONS[entry.subject.type] as unknown as SectionDef<SubjectType>;
