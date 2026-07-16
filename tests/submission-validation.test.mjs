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
  useCaseTitle: "Predictive maintenance",
  useCaseTheme: "Use equipment signals to intervene before a stoppage.",
  valueStreams: ["1"],
  expectedBenefits: "A measurable expected benefit.",
};

test("accepts one titled use case with a defined theme", () => {
  assert.deepEqual(getSubmissionCompletionErrors(completeResponse), []);
});

test("requires completeness only for submitted and approved records", () => {
  assert.equal(requiresCompleteResponse("draft"), false);
  assert.equal(requiresCompleteResponse("rejected"), false);
  assert.equal(requiresCompleteResponse("submitted"), true);
  assert.equal(requiresCompleteResponse("approved"), true);
});

test("requires the use-case title", () => {
  const errors = getSubmissionCompletionErrors({
    ...completeResponse,
    useCaseTitle: "",
  });

  assert.ok(errors.includes("useCaseTitle is required"));
});

test("requires the use-case theme", () => {
  const errors = getSubmissionCompletionErrors({
    ...completeResponse,
    useCaseTheme: "",
  });

  assert.ok(errors.includes("useCaseTheme is required"));
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
