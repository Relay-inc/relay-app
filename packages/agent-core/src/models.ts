const word = (s: string) => (/^(gpt|glm|ai)$/i.test(s) ? s.toUpperCase() : s.charAt(0).toUpperCase() + s.slice(1));

/** A `provider/model` id as "Claude Sonnet 5.5 (Anthropic)": the usage view names a model with its provider, since the
 *  same model can come through several. `providers` maps a provider id to its display name (else the id is shown). */
export const modelName = (id: string, providers: Record<string, string>) => {
  const cut = id.indexOf("/");
  if (cut < 0) return id;
  const [provider, model] = [id.slice(0, cut), id.slice(cut + 1)];
  // version numbers written with dashes (5-5) read as 5.5
  const name = model.replace(/(\d)-(\d)(?=$|-)/g, "$1.$2").split("-").map(word).join(" ");
  return `${name} (${providers[provider] ?? provider})`;
};
