import type { Locales } from "@relay/agent-core";

// Claude Code's own UI strings: the Usage view (its limit windows, why they are unavailable) and the settings hint.
// English is the reference; tsc fails on a missing or extra key.
const en = {
  "limits.loading": "Asking Claude for the limits…",
  "off.no-login": "Plan limits are unavailable: no Claude login was found. Sign in with <code>claude</code> in the Terminal.",
  "off.expired": "Plan limits are unavailable: the Claude login has expired. It renews the next time Claude runs.",
  "off.unavailable": "Plan limits are unavailable right now. Token usage below comes from the local transcripts.",
  "limit.session": "Current session, 5 hours",
  "limit.weekly": "This week, all models",
  "limit.weeklyModel": "This week, {name}",
  "tokens.reading": "Reading the transcripts…",
  "set.help": "Claude Code runs as <code>claude -p</code> in the vault, on your claude.ai login. Leave the program empty for <code>~/.local/bin/claude</code>.",
};
export type Key = keyof typeof en;

export const strings: Locales<Key> = {
  en,
  nl: {
    "limits.loading": "Limieten opvragen bij Claude…",
    "off.no-login": "Limieten niet beschikbaar: geen Claude-login gevonden. Log in met <code>claude</code> in Terminal.",
    "off.expired": "Limieten niet beschikbaar: de Claude-login is verlopen. Hij wordt vernieuwd zodra Claude weer draait.",
    "off.unavailable": "Limieten zijn nu niet beschikbaar. Het tokenverbruik hieronder komt uit de lokale transcripts.",
    "limit.session": "Huidige sessie, 5 uur",
    "limit.weekly": "Deze week, alle modellen",
    "limit.weeklyModel": "Deze week, {name}",
    "tokens.reading": "Transcripts lezen…",
    "set.help": "Claude Code draait als <code>claude -p</code> in de vault, op je claude.ai-login. Laat het programma leeg voor <code>~/.local/bin/claude</code>.",
  },
  fr: {
    "limits.loading": "Demande des limites à Claude…",
    "off.no-login": "Limites indisponibles : aucune connexion Claude trouvée. Connectez-vous avec <code>claude</code> dans le Terminal.",
    "off.expired": "Limites indisponibles : la connexion Claude a expiré. Elle se renouvelle au prochain lancement de Claude.",
    "off.unavailable": "Limites indisponibles pour le moment. Les tokens ci-dessous viennent des transcriptions locales.",
    "limit.session": "Session en cours, 5 heures",
    "limit.weekly": "Cette semaine, tous les modèles",
    "limit.weeklyModel": "Cette semaine, {name}",
    "tokens.reading": "Lecture des transcriptions…",
    "set.help": "Claude Code tourne en <code>claude -p</code> dans le coffre, avec votre connexion claude.ai. Laissez le programme vide pour <code>~/.local/bin/claude</code>.",
  },
  de: {
    "limits.loading": "Limits werden bei Claude abgefragt…",
    "off.no-login": "Limits nicht verfügbar: kein Claude-Login gefunden. Melde dich mit <code>claude</code> im Terminal an.",
    "off.expired": "Limits nicht verfügbar: der Claude-Login ist abgelaufen. Er wird beim nächsten Start von Claude erneuert.",
    "off.unavailable": "Limits sind gerade nicht verfügbar. Die Tokens unten stammen aus den lokalen Transkripten.",
    "limit.session": "Aktuelle Sitzung, 5 Stunden",
    "limit.weekly": "Diese Woche, alle Modelle",
    "limit.weeklyModel": "Diese Woche, {name}",
    "tokens.reading": "Transkripte werden gelesen…",
    "set.help": "Claude Code läuft als <code>claude -p</code> im Vault, mit deinem claude.ai-Login. Lass das Programm leer für <code>~/.local/bin/claude</code>.",
  },
};
