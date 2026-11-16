import type { Locales } from "@relay/board-core";

// GitHub Projects' UI strings. The app keeps them as github-projects.<key> (src/i18n.ts). English is the reference:
// every other language has exactly its keys, or tsc fails.
const en = {
  "token": "Token:",
  "help": "1. Click <b>Create token</b>: GitHub opens a new classic token with the scopes <code>project</code>, <code>repo</code> and <code>read:org</code> already ticked.<br>2. Pick an expiry, click <b>Generate token</b>, copy it (it starts with <code>ghp_</code>) and paste it below.<br>Signed in with gh? <code>gh auth refresh -s project</code>, then <code>gh auth token</code> gives one too.<br>Then pick one of your or your organizations' projects per vault project. The columns are the project's Status field. The token sits in the macOS keychain, not in a file.",
  "noStatusColumn": "No status",
  "noStatus": "This project has no single-select field to use as columns",
  "moveRefused": "GitHub did not move the item",
  "createRefused": "GitHub did not create the item",
  "connectedAs": "Connected as {name}, {boards} projects.",
  "getToken": "Create token",
  "badToken": "That isn't a GitHub token: one starts with ghp_, gho_ or github_pat_.",
};
export type Key = keyof typeof en;

export default {
  en,
  nl: {
    "token": "Token:",
    "help": "1. Klik <b>Token maken</b>: GitHub opent een nieuwe classic token met de scopes <code>project</code>, <code>repo</code> en <code>read:org</code> al aangevinkt.<br>2. Kies een vervaldatum, klik <b>Generate token</b>, kopieer hem (begint met <code>ghp_</code>) en plak hem hieronder.<br>Ingelogd met gh? <code>gh auth refresh -s project</code>, daarna geeft <code>gh auth token</code> er ook een.<br>Kies daarna per vaultproject een project van jezelf of van je organisaties. De kolommen zijn het Status-veld van het project. De token staat in de macOS-sleutelhanger, niet in een bestand.",
    "noStatusColumn": "Geen status",
    "noStatus": "Dit project heeft geen keuzeveld om als kolommen te gebruiken",
    "moveRefused": "GitHub heeft het item niet verplaatst",
    "createRefused": "GitHub heeft het item niet aangemaakt",
    "connectedAs": "Verbonden als {name}, {boards} projecten.",
    "getToken": "Token maken",
    "badToken": "Dat is geen GitHub-token: een token begint met ghp_, gho_ of github_pat_.",
  },
  fr: {
    "token": "Jeton :",
    "help": "1. Cliquez sur <b>Créer un jeton</b> : GitHub ouvre un nouveau jeton classique avec les scopes <code>project</code>, <code>repo</code> et <code>read:org</code> déjà cochés.<br>2. Choisissez une expiration, cliquez sur <b>Generate token</b>, copiez-le (il commence par <code>ghp_</code>) et collez-le ci-dessous.<br>Connecté avec gh ? <code>gh auth refresh -s project</code>, puis <code>gh auth token</code> en donne un aussi.<br>Choisissez ensuite un de vos projets ou de ceux de vos organisations, par projet du vault. Les colonnes sont le champ Status du projet. Le jeton est dans le trousseau macOS, pas dans un fichier.",
    "noStatusColumn": "Sans statut",
    "noStatus": "Ce projet n'a aucun champ à choix unique à utiliser comme colonnes",
    "moveRefused": "GitHub n'a pas déplacé l'élément",
    "createRefused": "GitHub n'a pas créé l'élément",
    "connectedAs": "Connecté en tant que {name}, {boards} projets.",
    "getToken": "Créer un jeton",
    "badToken": "Ce n'est pas un jeton GitHub : un jeton commence par ghp_, gho_ ou github_pat_.",
  },
  de: {
    "token": "Token:",
    "help": "1. Klick auf <b>Token erstellen</b>: GitHub öffnet ein neues klassisches Token mit den Scopes <code>project</code>, <code>repo</code> und <code>read:org</code> schon angehakt.<br>2. Wähl ein Ablaufdatum, klick auf <b>Generate token</b>, kopier es (es beginnt mit <code>ghp_</code>) und füg es unten ein.<br>Mit gh angemeldet? <code>gh auth refresh -s project</code>, danach gibt <code>gh auth token</code> auch eins.<br>Wähl dann pro Vault-Projekt eines deiner Projekte oder eines deiner Organisationen. Die Spalten sind das Status-Feld des Projekts. Das Token liegt im macOS-Schlüsselbund, nicht in einer Datei.",
    "noStatusColumn": "Kein Status",
    "noStatus": "Dieses Projekt hat kein Auswahlfeld, das als Spalten dienen kann",
    "moveRefused": "GitHub hat das Element nicht verschoben",
    "createRefused": "GitHub hat das Element nicht angelegt",
    "connectedAs": "Verbunden als {name}, {boards} Projekte.",
    "getToken": "Token erstellen",
    "badToken": "Das ist kein GitHub-Token: eins beginnt mit ghp_, gho_ oder github_pat_.",
  },
} satisfies Locales<Key>;
