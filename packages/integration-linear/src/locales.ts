import type { Locales } from "@vault/board-core";

// Linear's UI strings. The app keeps them as linear.<key> (src/i18n.ts). English is the reference: every
// other language has exactly its keys, or tsc fails.
const en = {
  "token": "API key:",
  "help": "In Linear, create a personal API key under Settings › Account › Security & access (Personal API keys) and paste it here. It sits in the macOS keychain, not in a file. Then pick a team, or one of its projects, per vault project below.",
  "states": "States:",
  "showDone": "Show completed and canceled",
  "allIssues": "All issues",
  "moveRefused": "Linear did not move the issue",
  "connectedAs": "Connected as {name}.",
};
export type Key = keyof typeof en;

export default {
  en,
  nl: {
    "token": "API-sleutel:",
    "help": "Maak in Linear een persoonlijke API-sleutel aan onder Settings › Account › Security & access (Personal API keys) en plak hem hier. Hij staat in de macOS-sleutelhanger, niet in een bestand. Kies daarna hieronder per vault-project een team of een van zijn projecten.",
    "states": "Statussen:",
    "showDone": "Toon afgewerkt en geannuleerd",
    "allIssues": "Alle issues",
    "moveRefused": "Linear heeft het issue niet verplaatst",
    "connectedAs": "Verbonden als {name}.",
  },
  fr: {
    "token": "Clé API :",
    "help": "Dans Linear, créez une clé API personnelle sous Settings › Account › Security & access (Personal API keys) et collez-la ici. Elle est dans le trousseau macOS, pas dans un fichier. Choisissez ensuite ci-dessous une équipe, ou l'un de ses projets, par projet du vault.",
    "states": "États :",
    "showDone": "Afficher terminés et annulés",
    "allIssues": "Toutes les issues",
    "moveRefused": "Linear n'a pas déplacé l'issue",
    "connectedAs": "Connecté en tant que {name}.",
  },
  de: {
    "token": "API-Schlüssel:",
    "help": "Leg in Linear unter Settings › Account › Security & access (Personal API keys) einen persönlichen API-Schlüssel an und füg ihn hier ein. Er liegt im macOS-Schlüsselbund, nicht in einer Datei. Wähl dann unten pro Vault-Projekt ein Team oder eines seiner Projekte.",
    "states": "Status:",
    "showDone": "Erledigte und abgebrochene zeigen",
    "allIssues": "Alle Issues",
    "moveRefused": "Linear hat das Issue nicht verschoben",
    "connectedAs": "Verbunden als {name}.",
  },
} satisfies Locales<Key>;
