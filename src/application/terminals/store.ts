import { makeStore } from "../make-store";

// `chat`: the conversation the tab continues, so its terminal button shows this tab instead of starting another
export type TerminalTab = { id: number; title: string; exited: boolean; chat?: string };

type TerminalsState = {
  // per project: its shells as tabs and the one shown (0: none). The xterm instances are not state, see terminals.ts
  byProject: Record<string, { tabs: TerminalTab[]; active: number }>;
};

export const useTerminalsStore = makeStore<TerminalsState>(() => ({ byProject: {} }));
