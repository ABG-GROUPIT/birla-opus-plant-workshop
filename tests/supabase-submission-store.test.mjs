import assert from "node:assert/strict";
import test from "node:test";

import { createSupabaseSubmissionStore } from "../lib/supabase-submission-store.ts";

const stored = {
  id: "f0f2bb80-074e-43a9-afaf-f01cf1c7e500",
  plant: "Panipat",
  submitterName: "Plant leader",
  submitterEmail: "leader@example.com",
  designation: "Plant Head",
  useCaseTitle: "Predictive maintenance",
  useCaseTheme: "Selected use case",
  useCases: ["Selected use case", "", "", ""],
  valueStreams: ["3"],
  expectedBenefits: "Faster planning with fewer manual handoffs.",
  status: "submitted",
  isVisible: false,
  createdAt: "2026-07-16T10:00:00.000Z",
  updatedAt: "2026-07-16T10:00:00.000Z",
  submittedAt: "2026-07-16T10:00:00.000Z",
  reviewedAt: null,
};

const row = {
  id: stored.id,
  plant: stored.plant,
  submitter_name: stored.submitterName,
  submitter_email: stored.submitterEmail,
  designation: stored.designation,
  use_case_title: stored.useCaseTitle,
  use_case_theme: stored.useCaseTheme,
  use_case_1: "Selected use case",
  use_case_2: "",
  use_case_3: "",
  use_case_4: "",
  value_stream_1_selected: false,
  value_stream_2_selected: false,
  value_stream_3_selected: true,
  value_stream_4_selected: false,
  expected_benefits: stored.expectedBenefits,
  status: stored.status,
  is_visible: false,
  created_at: stored.createdAt,
  updated_at: stored.updatedAt,
  submitted_at: stored.submittedAt,
  reviewed_at: null,
};

test("creates a Supabase row without exposing a new secret key as Bearer auth", async () => {
  let captured;
  const store = createSupabaseSubmissionStore(
    {
      url: "https://example.supabase.co",
      secretKey: "sb_secret_server_only",
    },
    {
      fetch: async (input, init) => {
        captured = { input: String(input), init };
        return Response.json([row]);
      },
    },
  );

  assert.deepEqual(await store.create(stored), stored);
  assert.equal(captured.init.method, "POST");
  const headers = new Headers(captured.init.headers);
  assert.equal(headers.get("apikey"), "sb_secret_server_only");
  assert.equal(headers.get("authorization"), null);
  const body = JSON.parse(captured.init.body);
  assert.equal(body.designation, "Plant Head");
  assert.equal(body.use_case_title, "Predictive maintenance");
  assert.equal(body.use_case_theme, "Selected use case");
  assert.equal(body.value_stream_3_selected, true);
});

test("hard-filters the presentation query to approved and visible rows", async () => {
  let requestedUrl;
  const store = createSupabaseSubmissionStore(
    {
      url: "https://example.supabase.co",
      secretKey: "sb_secret_server_only",
    },
    {
      fetch: async (input) => {
        requestedUrl = new URL(String(input));
        return Response.json([]);
      },
    },
  );

  assert.deepEqual(await store.list({ presentation: true }), []);
  assert.deepEqual(requestedUrl.searchParams.getAll("status"), ["eq.approved"]);
  assert.deepEqual(requestedUrl.searchParams.getAll("is_visible"), ["eq.true"]);
});

test("uses updated_at for optimistic concurrency on direct admin edits", async () => {
  let requestedUrl;
  const store = createSupabaseSubmissionStore(
    {
      url: "https://example.supabase.co",
      secretKey: "sb_secret_server_only",
    },
    {
      fetch: async (input) => {
        requestedUrl = new URL(String(input));
        return Response.json([]);
      },
    },
  );

  assert.equal(await store.update(stored, stored.updatedAt), null);
  assert.equal(requestedUrl.searchParams.get("id"), `eq.${stored.id}`);
  assert.equal(
    requestedUrl.searchParams.get("updated_at"),
    `eq.${stored.updatedAt}`,
  );
});
