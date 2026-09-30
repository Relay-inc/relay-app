import type { Locales } from "@vault/agent-core";

// OpenCode's own UI strings: the Usage view (it has no plan limits, only tokens and cost), the settings hint and
// option. English is the reference; tsc fails on a missing or extra key.
const en = {
  "limits.loading": "OpenCode reports no plan limits.",
  "off.none": "OpenCode reports no plan or rate limits: those are your model providers'. Tokens and cost below come from OpenCode's local storage.",
  "off.unavailable": "OpenCode reports no plan or rate limits. Tokens and cost below come from OpenCode's local storage.",
  "tokens.reading": "Reading OpenCode's storage…",
  "set.help": "OpenCode runs as a private <code>opencode serve</code> in the vault, with the providers you set up in OpenCode (<code>opencode auth login</code>, or an API key in the environment; OpenCode Zen's free models need neither). Not installed yet: <code>npm install -g opencode-ai</code>, <code>brew install sst/tap/opencode</code> or <code>curl -fsSL https://opencode.ai/install | bash</code>, then Check again. Leave the program empty for the installed <code>opencode</code>.",
  "opt.permissions": "Ask",
  "opt.permissions.ask": "Before edits, commands and web fetches",
  "opt.permissions.config": "As set in your OpenCode config",
};
export type Key = keyof typeof en;

export const strings: Locales<Key> = {
  en,
  nl: {
    "limits.loading": "OpenCode meldt geen planlimieten.",
    "off.none": "OpenCode meldt geen plan- of snelheidslimieten: die zijn van je modelproviders. Tokens en kosten hieronder komen uit de lokale opslag van OpenCode.",
    "off.unavailable": "OpenCode meldt geen plan- of snelheidslimieten. Tokens en kosten hieronder komen uit de lokale opslag van OpenCode.",
    "tokens.reading": "Opslag van OpenCode lezen…",
    "set.help": "OpenCode draait als een eigen <code>opencode serve</code> in de vault, met de providers die je in OpenCode instelde (<code>opencode auth login</code>, of een API-sleutel in de omgeving; de gratis modellen van OpenCode Zen hebben geen van beide nodig). Nog niet geïnstalleerd: <code>npm install -g opencode-ai</code>, <code>brew install sst/tap/opencode</code> of <code>curl -fsSL https://opencode.ai/install | bash</code>, daarna Opnieuw controleren. Laat het programma leeg voor de geïnstalleerde <code>opencode</code>.",
    "opt.permissions": "Vragen",
    "opt.permissions.ask": "Voor wijzigingen, commando's en webverzoeken",
    "opt.permissions.config": "Zoals ingesteld in je OpenCode-config",
  },
  fr: {
    "limits.loading": "OpenCode ne signale pas de limites de forfait.",
    "off.none": "OpenCode ne signale ni limites de forfait ni limites de débit : ce sont celles de vos fournisseurs de modèles. Les jetons et le coût ci-dessous viennent du stockage local d’OpenCode.",
    "off.unavailable": "OpenCode ne signale ni limites de forfait ni limites de débit. Les jetons et le coût ci-dessous viennent du stockage local d’OpenCode.",
    "tokens.reading": "Lecture du stockage d’OpenCode…",
    "set.help": "OpenCode tourne comme un <code>opencode serve</code> privé dans le coffre, avec les fournisseurs configurés dans OpenCode (<code>opencode auth login</code>, ou une clé d’API dans l’environnement ; les modèles gratuits d’OpenCode Zen n’en ont pas besoin). Pas encore installé : <code>npm install -g opencode-ai</code>, <code>brew install sst/tap/opencode</code> ou <code>curl -fsSL https://opencode.ai/install | bash</code>, puis Vérifier à nouveau. Laissez le programme vide pour l’<code>opencode</code> installé.",
    "opt.permissions": "Demander",
    "opt.permissions.ask": "Avant les modifications, les commandes et les requêtes web",
    "opt.permissions.config": "Comme dans votre configuration OpenCode",
  },
  de: {
    "limits.loading": "OpenCode meldet keine Tariflimits.",
    "off.none": "OpenCode meldet keine Tarif- oder Ratenlimits: Das sind die deiner Modellanbieter. Tokens und Kosten unten stammen aus dem lokalen Speicher von OpenCode.",
    "off.unavailable": "OpenCode meldet keine Tarif- oder Ratenlimits. Tokens und Kosten unten stammen aus dem lokalen Speicher von OpenCode.",
    "tokens.reading": "Speicher von OpenCode wird gelesen…",
    "set.help": "OpenCode läuft als eigenes <code>opencode serve</code> im Vault, mit den Anbietern, die du in OpenCode eingerichtet hast (<code>opencode auth login</code> oder ein API-Schlüssel in der Umgebung; die kostenlosen Modelle von OpenCode Zen brauchen beides nicht). Noch nicht installiert: <code>npm install -g opencode-ai</code>, <code>brew install sst/tap/opencode</code> oder <code>curl -fsSL https://opencode.ai/install | bash</code>, dann Erneut prüfen. Lass das Programm leer für das installierte <code>opencode</code>.",
    "opt.permissions": "Fragen",
    "opt.permissions.ask": "Vor Änderungen, Befehlen und Webabrufen",
    "opt.permissions.config": "Wie in deiner OpenCode-Konfiguration",
  },
};
