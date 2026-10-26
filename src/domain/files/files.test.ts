import { test } from "node:test";
import assert from "node:assert/strict";
import { gitLetters, opensOutside, vaultNote } from "./files.ts";
import type { GitRepo } from "../git/git.ts";

test("gitLetters keys git's letter by the file's absolute path", () => {
  const repo = {
    repo: "/code/beacon",
    files: [
      { path: "src/a.php", status: "M" },
      { path: "new.txt", status: "?" },
    ],
  } as GitRepo;
  assert.deepEqual(gitLetters([repo]), { "/code/beacon/src/a.php": "M", "/code/beacon/new.txt": "?" });
});

test("documents, pictures and archives open in their own app, code and text do not", () => {
  for (const name of ["Offerte.docx", "plan.PDF", "logo.png", "dump.sql.gz"]) assert.ok(opensOutside(name), name);
  for (const name of ["index.php", "README.md", ".gitignore", "logo.svg", "Dockerfile"])
    assert.ok(!opensOutside(name), name);
});

test("vaultNote: a markdown file in the vault as its note path, anything else none", () => {
  assert.equal(vaultNote("/v/Contexts/P/P.md", "/v"), "Contexts/P/P.md");
  assert.equal(vaultNote("/v/Contexts/P/plan.html", "/v"), "");
  assert.equal(vaultNote("/code/README.md", "/v"), "");
  assert.equal(vaultNote("/vault2/a.md", "/v"), "");
});
