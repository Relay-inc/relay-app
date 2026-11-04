import type { CommonwealthStatus } from "../../domain/settings/types";
import { makeStore } from "../make-store";

type CommonwealthState = {
  status: CommonwealthStatus | null;
  installing: boolean; // the plugin install in Settings is running
  installErr: string;
  joining: boolean; // `commonwealth join` in Settings is running
  joined: string; // its report, "" until it ran
  joinErr: string;
};

export const useCommonwealthStore = makeStore<CommonwealthState>(() => ({
  status: null,
  installing: false,
  installErr: "",
  joining: false,
  joined: "",
  joinErr: "",
}));
