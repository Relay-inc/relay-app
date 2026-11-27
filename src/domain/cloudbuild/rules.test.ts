import { test } from "node:test";
import assert from "node:assert/strict";
import { projectsOf, refOf, toneOf, triggersOf, worst } from "./rules.ts";

test("statuses read as four tones", () => {
  assert.equal(toneOf("SUCCESS"), "ok");
  for (const s of ["FAILURE", "INTERNAL_ERROR", "TIMEOUT"]) assert.equal(toneOf(s), "fail");
  for (const s of ["QUEUED", "PENDING", "WORKING"]) assert.equal(toneOf(s), "busy");
  for (const s of ["CANCELLED", "EXPIRED", "STATUS_UNKNOWN", undefined, 3]) assert.equal(toneOf(s), "none");
});

test("the newest build of each trigger is its run, builds without a trigger are Manual", () => {
  const log = (id: string) => `https://console.cloud.google.com/cloud-build/builds/${id}?project=northwind-web`;
  const triggers = triggersOf({
    builds: [
      { buildTriggerId: "t1", status: "SUCCESS", createTime: "2026-01-01T10:00:00Z", logUrl: log("old") },
      {
        buildTriggerId: "t1",
        status: "FAILURE",
        createTime: "2026-01-02T10:00:00Z",
        startTime: "2026-01-02T10:00:05Z",
        finishTime: "2026-01-02T10:03:00Z",
        logUrl: log("new"),
        substitutions: { TRIGGER_NAME: "Deploy production", BRANCH_NAME: "main", SHORT_SHA: "a1b2c3d" },
      },
      { id: "m", status: "WORKING", createTime: "2026-01-03T10:00:00Z", logUrl: "https://evil.example/x" },
    ],
  });
  assert.deepEqual(triggers, [
    {
      id: "",
      name: "",
      tone: "busy",
      run: { started: "2026-01-03T10:00:00Z", finished: "", branch: "", commit: "", url: "" },
    },
    {
      id: "t1",
      name: "Deploy production",
      tone: "fail",
      run: {
        started: "2026-01-02T10:00:05Z",
        finished: "2026-01-02T10:03:00Z",
        branch: "main",
        commit: "a1b2c3d",
        url: log("new"),
      },
    },
  ]);
  assert.deepEqual(triggersOf(null), []);
});

test("the worst trigger sets the project's tone", () => {
  const x = (tone: "ok" | "fail" | "busy" | "none") => ({ id: "", name: "", tone, run: {} as never });
  assert.equal(worst([x("ok"), x("busy")]), "busy");
  assert.equal(worst([x("busy"), x("fail")]), "fail");
  assert.equal(worst([x("none")]), "none");
  assert.equal(worst([]), "none");
});

test("projects as picker options, refs back", () => {
  assert.deepEqual(
    projectsOf({
      projects: [
        { projectId: "northwind-web", name: "Northwind Web", lifecycleState: "ACTIVE" },
        { projectId: "northwind-old", lifecycleState: "DELETE_REQUESTED" },
      ],
    }),
    [{ id: "northwind-web", name: "northwind-web" }],
  );
  assert.deepEqual(refOf("northwind-web", ""), { project: "northwind-web", location: "global" });
  assert.deepEqual(refOf("northwind-web", "europe-west1"), { project: "northwind-web", location: "europe-west1" });
  for (const [p, l] of [
    ["", ""],
    ["Northwind", ""],
    ["northwind-web", "../x"],
    ["abc", ""],
    ["northwind-web", "a b"],
  ])
    assert.equal(refOf(p, l), null);
});
