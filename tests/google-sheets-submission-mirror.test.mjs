import assert from "node:assert/strict";
import test from "node:test";

import { createGoogleSheetsSubmissionMirror } from "../lib/google-sheets-submission-mirror.ts";

test("queues a versioned Sheet event without awaiting the webhook", async () => {
  let scheduled;
  let body;
  const mirror = createGoogleSheetsSubmissionMirror(
    {
      webhookUrl: "https://script.google.com/macros/s/example/exec",
      webhookSecret: "shared-secret",
    },
    (task) => {
      scheduled = task;
    },
    {
      fetch: async (_input, init) => {
        body = JSON.parse(init.body);
        return Response.json({ ok: true });
      },
    },
  );

  mirror.queue("submission.created", {
    id: "f0f2bb80-074e-43a9-afaf-f01cf1c7e500",
    plant: "Panipat",
    submitterName: "Plant leader",
    submitterEmail: "leader@example.com",
    designation: "Plant Head",
    useCaseTitle: "Predictive maintenance",
    useCaseTheme: "Use case",
    useCases: ["Use case", "", "", ""],
    valueStreams: ["1"],
    expectedBenefits: "Benefit",
    status: "submitted",
    isVisible: false,
    createdAt: "2026-07-16T10:00:00.000Z",
    updatedAt: "2026-07-16T10:00:00.000Z",
    submittedAt: "2026-07-16T10:00:00.000Z",
    reviewedAt: null,
  });

  assert.ok(scheduled instanceof Promise);
  assert.equal(body.version, 1);
  assert.equal(body.secret, "shared-secret");
  assert.equal(body.event, "submission.created");
  await scheduled;
});
