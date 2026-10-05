import type { Mail, MailFilter } from "../../domain/mail/types";
import { storage } from "../../infrastructure/storage";
import { makeStore } from "../make-store";

type MailState = {
  list: Mail[] | null; // every account's loaded rows, newest first
  err: string;
  busy: boolean;
  gen: number; // bumped when the mail settings change: an answer from an older generation is dropped
  pages: Record<string, number>; // per account: pages of 50 loaded
  end: Record<string, boolean>; // per account: the last one came back short
  more: boolean; // loading the next pages
  filter: MailFilter;
  selected: Set<string>; // the mail keys ticked for a bulk action (experimental)
  anchor: string; // the last key ticked, where a shift-click range starts
  moves: number; // bumped when an archive/delete starts: a list fetched before it would bring the mails back
  link: string; // a link clicked inside a mail waits here for the user's go (one at a time)
  textView: Set<string>; // which open mails show the text instead of the html
};

export const useMailStore = makeStore<MailState>(() => ({
  list: null,
  err: "",
  busy: false,
  gen: 0,
  pages: {},
  end: {},
  more: false,
  filter: { q: "", state: "all", project: "", box: "inbox", ...storage.get<Partial<MailFilter>>("mailFilter", {}) },
  selected: new Set(),
  anchor: "",
  moves: 0,
  link: "",
  textView: new Set(),
}));
