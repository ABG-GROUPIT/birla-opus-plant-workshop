import assert from "node:assert/strict";
import test from "node:test";

import {
  getSubmissionCompletionErrors,
  requiresCompleteResponse,
} from "../lib/submission-validation.ts";

const completeResponse = {
  submitterName: "Plant leader",
  submitterEmail: "leader@example.com",
  designation: "Plant Head",
  useCases: ["", "Short use-case description", "", ""],
  valueStreams: ["1"],
  expectedBenefits: "A measurable expected benefit.",
};

test("accepts exactly one described use-case slot", () => {
  assert.deepEqual(getSubmissionCompletionErrors(completeResponse), []);
});

test("requires completeness only for submitted and approved records", () => {
  assert.equal(requiresCompleteResponse("draft"), false);
  assert.equal(requiresCompleteResponse("rejected"), false);
  assert.equal(requiresCompleteResponse("submitted"), true);
  assert.equal(requiresCompleteResponse("approved"), true);
});

test("requires a selected use case and its description", () => {
  const errors = getSubmissionCompletionErrors({
    ...completeResponse,
    useCases: ["", "", "", ""],
  });

  assert.ok(errors.includes("Choose one use case and provide its description"));
});

test("rejects responses with descriptions in multiple use-case slots", () => {
  const errors = getSubmissionCompletionErrors({
    ...completeResponse,
    useCases: ["First", "", "Third", ""],
  });

  assert.ok(errors.includes("Only one use case may have a description"));
});

test("requires exactly one fixed value stream", () => {
  const errors = getSubmissionCompletionErrors({
    ...completeResponse,
    valueStreams: [],
  });
  assert.ok(errors.includes("Select one value stream"));

  const multipleErrors = getSubmissionCompletionErrors({
    ...completeResponse,
    valueStreams: ["1", "4"],
  });
  assert.ok(multipleErrors.includes("Only one value stream may be selected"));
});

test("requires the leader designation", () => {
  const errors = getSubmissionCompletionErrors({
    ...completeResponse,
    designation: "",
  });
  assert.ok(errors.includes("designation is required"));
});
