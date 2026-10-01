// gpt-6.1-sol as GPT-6.1-Sol, gpt-5.1-codex-mini as GPT-5.1-Codex-Mini, the fallback "codex" as Codex
export const modelName = (id: string) =>
  id.split("-").map((s, i) => (i === 0 && s === "gpt" ? "GPT" : s.charAt(0).toUpperCase() + s.slice(1))).join("-");
