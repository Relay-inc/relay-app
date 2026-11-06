import { modelName as providerModelName } from "@relay/agent-core/models";
// "opencode/big-pickle" as "Big Pickle (OpenCode Zen)", "anthropic/claude-sonnet-5-5" as "Claude Sonnet 5.5 (Anthropic)":
// the usage view names a model with its provider, since the same model can come through several
const PROVIDERS: Record<string, string> = {
  opencode: "OpenCode Zen", anthropic: "Anthropic", openai: "OpenAI", google: "Google", openrouter: "OpenRouter",
  "github-copilot": "GitHub Copilot", xai: "xAI", mistral: "Mistral", groq: "Groq", deepseek: "DeepSeek", ollama: "Ollama",
};

export const modelName = (id: string) => providerModelName(id, PROVIDERS);
