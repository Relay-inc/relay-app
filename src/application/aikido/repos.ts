import { reposOf, type AikidoRepo } from "../../domain/aikido/rules";
import * as backend from "../../infrastructure/backend";

// Every code repo the Aikido client sees, read the same way by the main window (application/aikido) and the settings
// window's Save (application/settings/aikido), so what Save reports matched is what the Security tab gets.

// ponytail: up to 5 pages of 200; an Aikido workspace past 1000 code repos is not read in full
const PAGES = 5;
export async function readRepos(): Promise<AikidoRepo[]> {
  const list: AikidoRepo[] = [];
  for (let page = 0; page < PAGES; page++) {
    const answer = await backend.integrationCall("aikido", "GET", `/repositories/code?per_page=200&page=${page}`, null);
    list.push(...reposOf(answer));
    if (!Array.isArray(answer) || answer.length < 200) break;
  }
  return list;
}
