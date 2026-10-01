import type { Locales } from "@relay/board-core";

// Trello's UI strings. The app keeps them as trello.<key> (src/i18n.ts). English is the reference: every
// other language has exactly its keys, or tsc fails.
const en = {
  "token": "User token:",
  "key": "API key:",
  "cards": "Cards:",
  "mine": "Only cards assigned to me",
  "personal": "Personal and shared boards",
  "help": "Trello gives API keys out per Power-Up, so Relay needs one of your own. You don't need OAuth or the Secret.<br>1. <a href=\"https://trello.com/power-ups/admin\">Create a Power-Up</a> (New): name it Relay, pick your workspace and fill in the contact fields. The iframe connector URL can stay empty.<br>2. In the Power-Up, open <b>API key</b> › <b>Generate a new API key</b> and paste the API key below.<br>3. Click <b>Get token</b>, allow Relay in Trello and paste the token it shows.<br>Creating a Power-Up needs admin rights in a Trello workspace. Key and token sit in the macOS keychain, not in a file.",
  "connectedAs": "Connected as {name}.",
  "getToken": "Get token",
  "needKey": "Paste the API key first",
  "keyIsToken": "That's a token (it starts with ATTA), not the API key. The API key is 32 characters, on the Power-Up's API key tab; the token goes in the field below it.",
  "keyIsSecret": "That is 64 characters: the Power-Up's Secret or a token. The API key is the 32-character one above the Secret.",
  "badKey": "An API key is 32 characters, 0–9 and a–f. Copy it from the Power-Up's API key tab.",
  "badToken": "That isn't a Trello token. Click Get token, allow Relay and copy the long code Trello shows (it starts with ATTA).",
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
    "help": "Trello geeft API-sleutels per Power-Up, dus Relay heeft er een van jou nodig. OAuth of de Secret heb je niet nodig.<br>1. <a href=\"https://trello.com/power-ups/admin\">Maak een Power-Up aan</a> (New): noem hem Relay, kies je workspace en vul de contactvelden in. De iframe connector URL mag leeg blijven.<br>2. Open in de Power-Up <b>API key</b> › <b>Generate a new API key</b> en plak de API-sleutel hieronder.<br>3. Klik <b>Token ophalen</b>, sta Relay toe in Trello en plak het token dat je ziet.<br>Een Power-Up aanmaken vraagt adminrechten in een Trello-workspace. Sleutel en token staan in de macOS-sleutelhanger, niet in een bestand.",
    "connectedAs": "Verbonden als {name}.",
    "getToken": "Token ophalen",
    "needKey": "Plak eerst de API-sleutel",
    "keyIsToken": "Dat is een token (begint met ATTA), niet de API-sleutel. De API-sleutel is 32 tekens, in de API key-tab van de Power-Up; het token hoort in het veld eronder.",
    "keyIsSecret": "Dat zijn 64 tekens: de Secret van de Power-Up of een token. De API-sleutel is die van 32 tekens boven de Secret.",
    "badKey": "Een API-sleutel is 32 tekens, 0–9 en a–f. Kopieer hem uit de API key-tab van de Power-Up.",
    "badToken": "Dat is geen Trello-token. Klik Token ophalen, sta Relay toe en kopieer de lange code die Trello toont (begint met ATTA).",
  },
  fr: {
    "token": "Jeton utilisateur :",
    "key": "Clé API :",
    "cards": "Cartes :",
    "mine": "Seulement les cartes qui me sont assignées",
    "personal": "Tableaux personnels et partagés",
    "help": "Trello attribue les clés API par Power-Up, Relay a donc besoin du vôtre. Ni OAuth ni le Secret ne sont nécessaires.<br>1. <a href=\"https://trello.com/power-ups/admin\">Créez un Power-Up</a> (New) : nommez-le Relay, choisissez votre espace de travail et remplissez les champs de contact. L'iframe connector URL peut rester vide.<br>2. Dans le Power-Up, ouvrez <b>API key</b> › <b>Generate a new API key</b> et collez la clé API ci-dessous.<br>3. Cliquez sur <b>Obtenir le jeton</b>, autorisez Relay dans Trello et collez le jeton affiché.<br>Créer un Power-Up demande les droits d'administrateur d'un espace de travail Trello. Clé et jeton sont dans le trousseau macOS, pas dans un fichier.",
    "connectedAs": "Connecté en tant que {name}.",
    "getToken": "Obtenir le jeton",
    "needKey": "Collez d'abord la clé API",
    "keyIsToken": "C'est un jeton (il commence par ATTA), pas la clé API. La clé API fait 32 caractères, dans l'onglet API key du Power-Up ; le jeton va dans le champ en dessous.",
    "keyIsSecret": "Cela fait 64 caractères : le Secret du Power-Up ou un jeton. La clé API est celle de 32 caractères au-dessus du Secret.",
    "badKey": "Une clé API fait 32 caractères, 0–9 et a–f. Copiez-la depuis l'onglet API key du Power-Up.",
    "badToken": "Ce n'est pas un jeton Trello. Cliquez sur Obtenir le jeton, autorisez Relay et copiez le long code affiché par Trello (il commence par ATTA).",
  },
  de: {
    "token": "Benutzer-Token:",
    "key": "API-Schlüssel:",
    "cards": "Karten:",
    "mine": "Nur mir zugewiesene Karten",
    "personal": "Persönliche und geteilte Boards",
    "help": "Trello vergibt API-Schlüssel pro Power-Up, Relay braucht also eins von dir. OAuth oder das Secret brauchst du nicht.<br>1. <a href=\"https://trello.com/power-ups/admin\">Leg ein Power-Up an</a> (New): nenn es Relay, wähl deinen Workspace und füll die Kontaktfelder aus. Die Iframe-Connector-URL darf leer bleiben.<br>2. Öffne im Power-Up <b>API key</b> › <b>Generate a new API key</b> und füg den API-Schlüssel unten ein.<br>3. Klick auf <b>Token holen</b>, erlaube Relay in Trello und füg das angezeigte Token ein.<br>Ein Power-Up anlegen braucht Adminrechte in einem Trello-Workspace. Schlüssel und Token liegen im macOS-Schlüsselbund, nicht in einer Datei.",
    "connectedAs": "Verbunden als {name}.",
    "getToken": "Token holen",
    "needKey": "Füg zuerst den API-Schlüssel ein",
    "keyIsToken": "Das ist ein Token (beginnt mit ATTA), nicht der API-Schlüssel. Der API-Schlüssel hat 32 Zeichen, im API-key-Tab des Power-Ups; das Token gehört ins Feld darunter.",
    "keyIsSecret": "Das sind 64 Zeichen: das Secret des Power-Ups oder ein Token. Der API-Schlüssel ist der mit 32 Zeichen über dem Secret.",
    "badKey": "Ein API-Schlüssel hat 32 Zeichen, 0–9 und a–f. Kopier ihn aus dem API-key-Tab des Power-Ups.",
    "badToken": "Das ist kein Trello-Token. Klick auf Token holen, erlaube Relay und kopier den langen Code, den Trello zeigt (er beginnt mit ATTA).",
  },
} satisfies Locales<Key>;
