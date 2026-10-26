import type { FileEntry, FileRoot } from "../../domain/files/files";
import { makeStore } from "../make-store";

type FilesState = {
  project: string; // whose folders show
  vault: string; // the vault's path, to open its notes in the right drawer
  roots: FileRoot[] | null; // null while loading
  err: string;
  children: Record<string, FileEntry[] | null>; // per folder read, null while reading
  errs: Record<string, string>; // per folder: why it could not be read
  expanded: Record<string, boolean>; // folders open, a root open unless closed
  letters: Record<string, string>; // per absolute path git's letter (M, A, D, ?)
  view: { path: string; text: string | null; err: string } | null; // a text file in the window over the app
};

export const useFilesStore = makeStore<FilesState>(() => ({
  project: "",
  vault: "",
  roots: null,
  err: "",
  children: {},
  errs: {},
  expanded: {},
  letters: {},
  view: null,
}));
