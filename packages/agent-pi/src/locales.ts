import type { Locales } from "@relay/agent-core";

// Pi's own UI strings: the Usage view (it has no plan limits, only tokens and cost) and the settings hint. English is
// the reference; tsc fails on a missing or extra key.
const en = {
  "limits.loading": "Pi reports no plan limits.",
  "off.none": "Pi reports no plan or rate limits: those are your model providers'. Tokens and cost below come from Pi's session files.",
  "off.unavailable": "Pi reports no plan or rate limits. Tokens and cost below come from Pi's session files.",
  "tokens.reading": "Reading Pi's sessions…",
  "set.help": "Pi runs as <code>pi --mode rpc</code> in the vault, with the providers you set up in Pi (<code>/login</code> inside <code>pi</code>, or an API key in the environment). Pi never asks before it edits or runs a command. Not installed yet: <code>npm install -g @earendil-works/pi-coding-agent</code>, then Check again. Leave the program empty for the installed <code>pi</code>.",
};
export type Key = keyof typeof en;

export const strings: Locales<Key> = {
  en,
  nl: {
    "limits.loading": "Pi meldt geen planlimieten.",
    "off.none": "Pi meldt geen plan- of snelheidslimieten: die zijn van je modelproviders. Tokens en kosten hieronder komen uit de sessiebestanden van Pi.",
    "off.unavailable": "Pi meldt geen plan- of snelheidslimieten. Tokens en kosten hieronder komen uit de sessiebestanden van Pi.",
    "tokens.reading": "Sessies van Pi lezen…",
    "set.help": "Pi draait als <code>pi --mode rpc</code> in de vault, met de providers die je in Pi instelde (<code>/login</code> in <code>pi</code>, of een API-sleutel in de omgeving). Pi vraagt nooit toestemming voor het wijzigen van bestanden of het uitvoeren van commando's. Nog niet geïnstalleerd: <code>npm install -g @earendil-works/pi-coding-agent</code>, daarna Opnieuw controleren. Laat het programma leeg voor de geïnstalleerde <code>pi</code>.",
  },
  fr: {
    "limits.loading": "Pi ne signale pas de limites de forfait.",
    "off.none": "Pi ne signale ni limites de forfait ni limites de débit : ce sont celles de vos fournisseurs de modèles. Les jetons et le coût ci-dessous viennent des fichiers de session de Pi.",
    "off.unavailable": "Pi ne signale ni limites de forfait ni limites de débit. Les jetons et le coût ci-dessous viennent des fichiers de session de Pi.",
    "tokens.reading": "Lecture des sessions de Pi…",
    "set.help": "Pi tourne comme <code>pi --mode rpc</code> dans le coffre, avec les fournisseurs configurés dans Pi (<code>/login</code> dans <code>pi</code>, ou une clé d’API dans l’environnement). Pi ne demande jamais avant de modifier un fichier ou d’exécuter une commande. Pas encore installé : <code>npm install -g @earendil-works/pi-coding-agent</code>, puis Vérifier à nouveau. Laissez le programme vide pour le <code>pi</code> installé.",
  },
  de: {
    "limits.loading": "Pi meldet keine Tariflimits.",
    "off.none": "Pi meldet keine Tarif- oder Ratenlimits: Das sind die deiner Modellanbieter. Tokens und Kosten unten stammen aus den Sitzungsdateien von Pi.",
    "off.unavailable": "Pi meldet keine Tarif- oder Ratenlimits. Tokens und Kosten unten stammen aus den Sitzungsdateien von Pi.",
    "tokens.reading": "Sitzungen von Pi werden gelesen…",
    "set.help": "Pi läuft als <code>pi --mode rpc</code> im Vault, mit den Anbietern, die du in Pi eingerichtet hast (<code>/login</code> in <code>pi</code> oder ein API-Schlüssel in der Umgebung). Pi fragt nie, bevor es Dateien ändert oder Befehle ausführt. Noch nicht installiert: <code>npm install -g @earendil-works/pi-coding-agent</code>, dann Erneut prüfen. Lass das Programm leer für das installierte <code>pi</code>.",
  },
};
