const word = (s: string) => (/^(gpt|oss)$/i.test(s) ? s.toUpperCase() : /^\d+b$/i.test(s) ? s.toUpperCase() : s.charAt(0).toUpperCase() + s.slice(1));

// "gemini-3.8-flash-high" as "Gemini 3.8 Flash High", "claude-opus-4-6-thinking" as "Claude Opus 4.6 Thinking",
// "gpt-oss-120b-medium" as "GPT OSS 120B Medium": Antigravity's ids carry the thinking level, so it stays in the name
export const modelName = (id: string) => id.replace(/(\d)-(\d)(?=$|-)/g, "$1.$2").split("-").map(word).join(" ");
