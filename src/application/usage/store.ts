import type { AllTokens, ProvLimits } from "../../domain/usage/types";
import { makeStore } from "../make-store";

type UsageState = {
  limits: ProvLimits[] | null;
  tokens: AllTokens | null;
  tokensError: string;
  tokensAt: number; // when the tokens were read last
  reading: boolean;
};

export const useUsageStore = makeStore<UsageState>(() => ({
  limits: null,
  tokens: null,
  tokensError: "",
  tokensAt: 0,
  reading: false,
}));
