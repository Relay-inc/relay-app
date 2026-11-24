import type { Locales } from "@relay/agent-core";

// Antigravity's own UI strings: the Usage view (it reports its plan, not what is left of it), the settings hint and
// the mode option. English is the reference; tsc fails on a missing or extra key.
const en = {
  "limits.loading": "Reading the Antigravity plan…",
  "limits.none": "Antigravity reports its plan, not how much of it is left. Tokens below come from the conversations Relay ran.",
  "off.unavailable": "The plan shows once a conversation has run on Antigravity. Tokens below come from the conversations Relay ran.",
  "tokens.reading": "Reading the conversation logs…",
  "set.help": "Antigravity runs as <code>agy acp</code> in the vault, on the login of the Antigravity CLI. Not installed yet: <code>curl -fsSL https://antigravity.google/cli/install.sh | bash</code>, then <code>agy acp --login</code> in the Terminal and Check again. Leave the program empty for the installed <code>agy</code>.",
  "opt.mode": "Ask",
  "opt.mode.default": "Before every edit and command",
  "opt.mode.accept-edits": "Before commands, edits in the vault go through",
  "opt.mode.auto": "Only before what cannot be undone (Antigravity decides)",
};
export type Key = keyof typeof en;

export const strings: Locales<Key> = {
  en,
  nl: {
    "limits.loading": "Het Antigravity-plan lezen…",
    "limits.none": "Antigravity meldt zijn plan, niet hoeveel ervan over is. Tokens hieronder komen uit de gesprekken die Relay draaide.",
    "off.unavailable": "Het plan verschijnt zodra een gesprek op Antigravity gedraaid heeft. Tokens hieronder komen uit de gesprekken die Relay draaide.",
    "tokens.reading": "Gesprekslogs lezen…",
    "set.help": "Antigravity draait als <code>agy acp</code> in de vault, op de login van de Antigravity CLI. Nog niet geïnstalleerd: <code>curl -fsSL https://antigravity.google/cli/install.sh | bash</code>, daarna <code>agy acp --login</code> in de Terminal en Opnieuw controleren. Laat het programma leeg voor de geïnstalleerde <code>agy</code>.",
    "opt.mode": "Vragen",
    "opt.mode.default": "Voor elke wijziging en elk commando",
    "opt.mode.accept-edits": "Voor commando's, wijzigingen in de vault gaan door",
    "opt.mode.auto": "Enkel voor wat niet terug te draaien is (Antigravity beslist)",
  },
  fr: {
    "limits.loading": "Lecture du forfait Antigravity…",
    "limits.none": "Antigravity indique son forfait, pas ce qu’il en reste. Les jetons ci-dessous viennent des conversations que Relay a lancées.",
    "off.unavailable": "Le forfait apparaît dès qu’une conversation a tourné sur Antigravity. Les jetons ci-dessous viennent des conversations que Relay a lancées.",
    "tokens.reading": "Lecture des journaux de conversation…",
    "set.help": "Antigravity tourne comme <code>agy acp</code> dans le coffre, avec la connexion de l’Antigravity CLI. Pas encore installé : <code>curl -fsSL https://antigravity.google/cli/install.sh | bash</code>, puis <code>agy acp --login</code> dans le Terminal et Vérifier à nouveau. Laissez le programme vide pour le <code>agy</code> installé.",
    "opt.mode": "Demander",
    "opt.mode.default": "Avant chaque modification et chaque commande",
    "opt.mode.accept-edits": "Avant les commandes, les modifications dans le coffre passent",
    "opt.mode.auto": "Seulement avant ce qui est irréversible (Antigravity décide)",
  },
  de: {
    "limits.loading": "Antigravity-Tarif wird gelesen…",
    "limits.none": "Antigravity meldet seinen Tarif, nicht wie viel davon übrig ist. Die Tokens unten stammen aus den Unterhaltungen, die Relay ausgeführt hat.",
    "off.unavailable": "Der Tarif erscheint, sobald eine Unterhaltung auf Antigravity gelaufen ist. Die Tokens unten stammen aus den Unterhaltungen, die Relay ausgeführt hat.",
    "tokens.reading": "Unterhaltungsprotokolle werden gelesen…",
    "set.help": "Antigravity läuft als <code>agy acp</code> im Vault, mit der Anmeldung der Antigravity CLI. Noch nicht installiert: <code>curl -fsSL https://antigravity.google/cli/install.sh | bash</code>, dann <code>agy acp --login</code> im Terminal und Erneut prüfen. Lass das Programm leer für das installierte <code>agy</code>.",
    "opt.mode": "Fragen",
    "opt.mode.default": "Vor jeder Änderung und jedem Befehl",
    "opt.mode.accept-edits": "Vor Befehlen, Änderungen im Vault gehen durch",
    "opt.mode.auto": "Nur vor dem, was sich nicht rückgängig machen lässt (Antigravity entscheidet)",
  },
};
