/** A conversation of the laptop on the paired machine, as the phone lists it. `sid`: its Claude session there, null
 *  until the machine saw it. */
export type PhoneConversation = {
  key: string;
  title: string | null; // the first thing said in it, where the machine saw it
  provider: string;
  model: string;
  effort: string;
  sid: string | null;
};
/** The machine the phone is paired with, as it says. `mirror_open`: the laptop's vault there is unlocked. */
export type PhoneServer = { host: string; version: string; mirror_open: boolean };
