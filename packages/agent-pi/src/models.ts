// "openai-codex/gpt-5.5" as "GPT 5.5 (ChatGPT)", "anthropic/claude-sonnet-5-5" as "Claude Sonnet 5.5 (Anthropic)":
// the usage view names a model with its provider, since the same model can come through several
const PROVIDERS: Record<string, string> = {
  "openai-codex": "ChatGPT", anthropic: "Anthropic", openai: "OpenAI", google: "Google", openrouter: "OpenRouter",
  "github-copilot": "GitHub Copilot", xai: "xAI", mistral: "Mistral", groq: "Groq", deepseek: "DeepSeek", ollama: "Ollama",
};
const word = (s: string) => (/^(gpt|glm|ai)$/i.test(s) ? s.toUpperCase() : s.charAt(0).toUpperCase() + s.slice(1));

export const modelName = (id: string) => {
  const cut = id.indexOf("/");
  if (cut < 0) return id;
  const [provider, model] = [id.slice(0, cut), id.slice(cut + 1)];
  // version numbers written with dashes (5-5) read as 5.5
  const name = model.replace(/(\d)-(\d)(?=$|-)/g, "$1.$2").split("-").map(word).join(" ");
  return `${name} (${PROVIDERS[provider] ?? provider})`;
};
