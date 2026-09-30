import type { Locales } from "@vault/board-core";

// Trello's UI strings. The app keeps them as trello.<key> (src/i18n.ts). English is the reference: every
// other language has exactly its keys, or tsc fails.
const en = {
  "token": "User token:",
  "key": "API key:",
  "cards": "Cards:",
  "mine": "Only cards assigned to me",
  "personal": "Personal and shared boards",
  "help": "Create a Power-Up at trello.com/power-ups/admin, copy its API key, then use the Token link next to it to allow access and copy the token. Both sit in the macOS keychain, not in a file.",
  "connectedAs": "Connected as {name}.",
};
export type Key = keyof typeof en;

export default {
  en,
  nl: {
    "token": "Gebruikerstoken:",
    "key": "API-sleutel:",
    "cards": "Kaarten:",
    "mine": "Enkel kaarten die aan mij toegewezen zijn",
    "personal": "Persoonlijke en gedeelde borden",
    "help": "Maak een Power-Up aan op trello.com/power-ups/admin, kopieer de API-sleutel en gebruik de Token-link ernaast om toegang te geven en het token te kopiëren. Beide staan in de macOS-sleutelhanger, niet in een bestand.",
    "connectedAs": "Verbonden als {name}.",
  },
  fr: {
    "token": "Jeton utilisateur :",
    "key": "Clé API :",
    "cards": "Cartes :",
    "mine": "Seulement les cartes qui me sont assignées",
    "personal": "Tableaux personnels et partagés",
    "help": "Créez un Power-Up sur trello.com/power-ups/admin, copiez sa clé API, puis utilisez le lien Token à côté pour autoriser l'accès et copier le jeton. Les deux sont dans le trousseau macOS, pas dans un fichier.",
    "connectedAs": "Connecté en tant que {name}.",
  },
  de: {
    "token": "Benutzer-Token:",
    "key": "API-Schlüssel:",
    "cards": "Karten:",
    "mine": "Nur mir zugewiesene Karten",
    "personal": "Persönliche und geteilte Boards",
    "help": "Leg unter trello.com/power-ups/admin ein Power-Up an, kopier dessen API-Schlüssel und nutz dann den Token-Link daneben, um den Zugriff zu erlauben und das Token zu kopieren. Beides liegt im macOS-Schlüsselbund, nicht in einer Datei.",
    "connectedAs": "Verbunden als {name}.",
  },
} satisfies Locales<Key>;
