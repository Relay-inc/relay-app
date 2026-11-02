import { test } from "node:test";
import assert from "node:assert/strict";
import { lastRunOf, pipesOf, projectsOf, refOf, toneOf, workspacesOf, worst } from "./rules.ts";

test("statuses read as four tones", () => {
  assert.equal(toneOf("SUCCESSFUL"), "ok");
  assert.equal(toneOf("FAILED"), "fail");
  for (const s of ["INPROGRESS", "ENQUEUED", "INITIAL", "TERMINATING", "WAITING_FOR_APPLY"])
    assert.equal(toneOf(s), "busy");
  for (const s of ["TERMINATED", "SKIPPED", "NOT_EXECUTED", undefined, 3]) assert.equal(toneOf(s), "none");
});

test("pipelines keep only Buddy's own links", () => {
  const pipes = pipesOf({
    pipelines: [
      {
        id: 7,
        name: "Deploy",
        html_url: "https://app.buddy.works/acme/web/pipelines/pipeline/7",
        last_execution_status: "FAILED",
      },
      { id: 8, name: "Tests", html_url: "https://evil.example/x", disabled: true },
    ],
  });
  assert.deepEqual(pipes[0], {
    id: 7,
    name: "Deploy",
    url: "https://app.buddy.works/acme/web/pipelines/pipeline/7",
    tone: "fail",
    disabled: false,
  });
  assert.equal(pipes[1].url, "");
  assert.deepEqual(pipesOf(null), []);
});

test("the worst enabled pipeline sets the project's tone", () => {
  const p = (tone: "ok" | "fail" | "busy" | "none", disabled = false) => ({ id: 1, name: "", url: "", tone, disabled });
  assert.equal(worst([p("ok"), p("busy")]), "busy");
  assert.equal(worst([p("ok"), p("fail", true)]), "ok");
  assert.equal(worst([p("fail"), p("busy")]), "fail");
  assert.equal(worst([]), "none");
});

test("the last run, or null", () => {
  assert.equal(lastRunOf({ executions: [] }), null);
  assert.deepEqual(
    lastRunOf({
      executions: [
        {
          start_date: "2026-01-02T10:00:00Z",
          finish_date: "",
          branch: { name: "main" },
          creator: { name: "Ada" },
          html_url: "https://eu.buddy.works/a",
        },
      ],
    }),
    { started: "2026-01-02T10:00:00Z", finished: "", branch: "main", by: "Ada", url: "https://eu.buddy.works/a" },
  );
});

test("projects as picker options and back", () => {
  assert.deepEqual(workspacesOf({ workspaces: [{ domain: "acme" }, { name: "x" }] }), ["acme"]);
  assert.deepEqual(projectsOf("acme", { projects: [{ name: "web", display_name: "Web" }] }), [
    { id: "acme/web", name: "Web · acme" },
  ]);
  assert.deepEqual(refOf("acme/web"), { workspace: "acme", project: "web" });
  for (const v of ["", "acme", "acme/web/x", "../x", "a b/web"]) assert.equal(refOf(v), null);
});
