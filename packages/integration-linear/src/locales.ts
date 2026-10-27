import type { Locales } from "@relay/board-core";

// Linear's UI strings. The app keeps them as linear.<key> (src/i18n.ts). English is the reference: every
// other language has exactly its keys, or tsc fails.
const en = {
  "token": "API key:",
  "help": "1. Open <a href=\"https://linear.app/settings/account/security\">Settings › Security &amp; access</a> in Linear, or click <b>Create key</b>.<br>2. Under <b>Personal API keys</b>, click <b>New API key</b>, name it Relay and give it read and write access.<br>3. Copy the key (it starts with <code>lin_api_</code>, Linear shows it only once) and paste it below.<br>Then pick a team, one of its cycles or one of its projects, per vault project. The key sits in the macOS keychain, not in a file.",
  "states": "States:",
  "showDone": "Show completed and canceled",
  "allIssues": "All issues",
  "currentCycle": "Current cycle",
  "cycle": "Cycle {number}",
  "moveRefused": "Linear did not move the issue",
  "createRefused": "Linear did not create the issue",
  "connectedAs": "Connected as {name}.",
  "getToken": "Create key",
  "badToken": "That isn't a Linear API key: a personal key starts with lin_api_. Create one under Settings › Security & access.",
};
export type Key = keyof typeof en;

export default {
  en,
  nl: {
    "token": "API-sleutel:",
    "help": "1. Open <a href=\"https://linear.app/settings/account/security\">Settings › Security &amp; access</a> in Linear, of klik <b>Sleutel maken</b>.<br>2. Klik onder <b>Personal API keys</b> op <b>New API key</b>, noem hem Relay en geef lees- en schrijftoegang.<br>3. Kopieer de sleutel (begint met <code>lin_api_</code>, Linear toont hem maar één keer) en plak hem hieronder.<br>Kies daarna per vaultproject een team, een van zijn cycles of een van zijn projecten. De sleutel staat in de macOS-sleutelhanger, niet in een bestand.",
    "states": "Statussen:",
    "showDone": "Toon afgewerkt en geannuleerd",
    "allIssues": "Alle issues",
    "currentCycle": "Huidige cycle",
    "cycle": "Cycle {number}",
    "moveRefused": "Linear heeft het issue niet verplaatst",
    "createRefused": "Linear heeft het issue niet aangemaakt",
    "connectedAs": "Verbonden als {name}.",
    "getToken": "Sleutel maken",
    "badToken": "Dat is geen Linear API-sleutel: een persoonlijke sleutel begint met lin_api_. Maak er een onder Settings › Security & access.",
  },
  fr: {
    "token": "Clé API :",
    "help": "1. Ouvrez <a href=\"https://linear.app/settings/account/security\">Settings › Security &amp; access</a> dans Linear, ou cliquez sur <b>Créer une clé</b>.<br>2. Sous <b>Personal API keys</b>, cliquez sur <b>New API key</b>, nommez-la Relay et donnez-lui l'accès en lecture et en écriture.<br>3. Copiez la clé (elle commence par <code>lin_api_</code>, Linear ne l'affiche qu'une fois) et collez-la ci-dessous.<br>Choisissez ensuite une équipe, l'un de ses cycles ou l'un de ses projets, par projet du vault. La clé est dans le trousseau macOS, pas dans un fichier.",
    "states": "États :",
    "showDone": "Afficher terminés et annulés",
    "allIssues": "Toutes les issues",
    "currentCycle": "Cycle en cours",
    "cycle": "Cycle {number}",
    "moveRefused": "Linear n'a pas déplacé l'issue",
    "createRefused": "Linear n'a pas créé l'issue",
    "connectedAs": "Connecté en tant que {name}.",
    "getToken": "Créer une clé",
    "badToken": "Ce n'est pas une clé API Linear : une clé personnelle commence par lin_api_. Créez-en une sous Settings › Security & access.",
  },
  de: {
    "token": "API-Schlüssel:",
    "help": "1. Öffne <a href=\"https://linear.app/settings/account/security\">Settings › Security &amp; access</a> in Linear, oder klick auf <b>Schlüssel erstellen</b>.<br>2. Klick unter <b>Personal API keys</b> auf <b>New API key</b>, nenn ihn Relay und gib ihm Lese- und Schreibzugriff.<br>3. Kopier den Schlüssel (er beginnt mit <code>lin_api_</code>, Linear zeigt ihn nur einmal) und füg ihn unten ein.<br>Wähl dann pro Vault-Projekt ein Team, einen seiner Cycles oder eines seiner Projekte. Der Schlüssel liegt im macOS-Schlüsselbund, nicht in einer Datei.",
    "states": "Status:",
    "showDone": "Erledigte und abgebrochene zeigen",
    "allIssues": "Alle Issues",
    "currentCycle": "Aktueller Cycle",
    "cycle": "Cycle {number}",
    "moveRefused": "Linear hat das Issue nicht verschoben",
    "createRefused": "Linear hat das Issue nicht angelegt",
    "connectedAs": "Verbunden als {name}.",
    "getToken": "Schlüssel erstellen",
    "badToken": "Das ist kein Linear-API-Schlüssel: ein persönlicher Schlüssel beginnt mit lin_api_. Erstell einen unter Settings › Security & access.",
  },
} satisfies Locales<Key>;
