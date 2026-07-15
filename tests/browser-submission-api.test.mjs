import assert from "node:assert/strict";
import { after, test } from "node:test";

import {
  BrowserSubmissionApiError,
  listAdminSubmissions,
  listPresentationSubmissions,
  submitWorkshopResponse,
  updateAdminSubmission,
} from "../lib/browser-submission-api.ts";

const originalEnvironment = {
  url: process.env.NEXT_PUBLIC_SUPABASE_URL,
  key: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
};

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co/";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_browser_safe";

after(() => {
  if (originalEnvironment.url === undefined) {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  } else {
    process.env.NEXT_PUBLIC_SUPABASE_URL = originalEnvironment.url;
  }
  if (originalEnvironment.key === undefined) {
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  } else {
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = originalEnvironment.key;
  }
});

function captureFetch(t, payload, status = 200) {
  const requests = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    requests.push({ input: String(input), init });
    return Response.json(payload, { status });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  return requests;
}

const publicSubmission = {
  id: "f0f2bb80-074e-43a9-afaf-f01cf1c7e500",
  plant: "Panipat",
  submitterName: "Plant leader",
  useCases: ["", "Short use case", "", ""],
  valueStreams: ["3"],
  expectedBenefits: "Faster planning.",
  status: "approved",
  isVisible: true,
};

const adminSubmission = {
  ...publicSubmission,
  submitterEmail: "leader@example.com",
  designation: "Plant Head",
  createdAt: "2026-07-16T10:00:00.000Z",
  updatedAt: "2026-07-16T10:05:00.000Z",
  submittedAt: "2026-07-16T10:00:00.000Z",
  reviewedAt: "2026-07-16T10:05:00.000Z",
};

test("reads presentation rows through the public RPC with only the publishable key", async (t) => {
  const requests = captureFetch(t, {
    submissions: [publicSubmission],
    count: 1,
  });

  assert.deepEqual(await listPresentationSubmissions(), {
    submissions: [publicSubmission],
    count: 1,
  });
  assert.equal(
    requests[0].input,
    "https://example.supabase.co/rest/v1/rpc/workshop_public_list",
  );
  assert.equal(requests[0].init.method, "POST");
  assert.equal(requests[0].init.cache, "no-store");
  assert.deepEqual(JSON.parse(requests[0].init.body), {});

  const headers = new Headers(requests[0].init.headers);
  assert.equal(headers.get("apikey"), "sb_publishable_browser_safe");
  assert.equal(headers.get("authorization"), null);
});

test("submits one fixed use case and value stream through workshop_submit", async (t) => {
  const requests = captureFetch(t, {
    submission: {
      id: publicSubmission.id,
      referenceId: "BO-F01CF1C7",
      submittedAt: "2026-07-16T10:00:00.000Z",
    },
  }, 201);

  const result = await submitWorkshopResponse({
    plant: "Panipat",
    submitterName: "Plant leader",
    submitterEmail: "leader@example.com",
    designation: "Plant Head",
    useCases: ["", "Short use case", "", ""],
    valueStreams: ["3"],
    expectedBenefits: "Faster planning.",
  });

  assert.deepEqual(result, {
    submission: {
      id: publicSubmission.id,
      referenceId: "BO-F01CF1C7",
      submittedAt: "2026-07-16T10:00:00.000Z",
    },
  });
  assert.equal(
    requests[0].input,
    "https://example.supabase.co/rest/v1/rpc/workshop_submit",
  );
  assert.deepEqual(JSON.parse(requests[0].init.body), {
    p_plant: "Panipat",
    p_submitter_name: "Plant leader",
    p_submitter_email: "leader@example.com",
    p_designation: "Plant Head",
    p_use_cases: ["", "Short use case", "", ""],
    p_value_stream: "3",
    p_expected_benefits: "Faster planning.",
  });
});

test("passes the URL capability only in admin RPC request bodies", async (t) => {
  const requests = captureFetch(t, { submissions: [adminSubmission], count: 1 });

  assert.deepEqual(await listAdminSubmissions("unguessable-capability"), {
    submissions: [adminSubmission],
    count: 1,
  });
  assert.equal(
    requests[0].input,
    "https://example.supabase.co/rest/v1/rpc/workshop_admin_list",
  );
  assert.deepEqual(JSON.parse(requests[0].init.body), {
    p_capability: "unguessable-capability",
  });
  assert.equal(requests[0].input.includes("unguessable-capability"), false);
});

test("sends a complete optimistic admin update and unwraps the updated row", async (t) => {
  const updated = {
    ...adminSubmission,
    status: "rejected",
    isVisible: false,
    updatedAt: "2026-07-16T10:10:00.000Z",
  };
  const requests = captureFetch(t, { submission: updated });

  assert.deepEqual(
    await updateAdminSubmission("unguessable-capability", {
      id: adminSubmission.id,
      expectedUpdatedAt: adminSubmission.updatedAt,
      plant: "Panipat",
      submitterName: "Plant leader",
      submitterEmail: "leader@example.com",
      designation: "Plant Head",
      useCases: ["", "Short use case", "", ""],
      valueStreams: ["3"],
      expectedBenefits: "Faster planning.",
      status: "rejected",
    }),
    { submission: updated },
  );

  assert.equal(
    requests[0].input,
    "https://example.supabase.co/rest/v1/rpc/workshop_admin_update",
  );
  assert.deepEqual(JSON.parse(requests[0].init.body), {
    p_capability: "unguessable-capability",
    p_id: adminSubmission.id,
    p_expected_updated_at: adminSubmission.updatedAt,
    p_plant: "Panipat",
    p_submitter_name: "Plant leader",
    p_submitter_email: "leader@example.com",
    p_designation: "Plant Head",
    p_use_cases: ["", "Short use case", "", ""],
    p_value_stream: "3",
    p_expected_benefits: "Faster planning.",
    p_status: "rejected",
  });
});

test("surfaces useful PostgREST errors without leaking an authorization header", async (t) => {
  const requests = captureFetch(t, {
    code: "28000",
    message: "The admin link is invalid or has expired.",
    details: "Capability rejected",
  }, 401);

  await assert.rejects(
    listAdminSubmissions("wrong-capability"),
    (error) => {
      assert.ok(error instanceof BrowserSubmissionApiError);
      assert.equal(error.message, "The admin link is invalid or has expired.");
      assert.equal(error.status, 401);
      assert.equal(error.code, "28000");
      assert.equal(error.details, "Capability rejected");
      return true;
    },
  );

  const headers = new Headers(requests[0].init.headers);
  assert.equal(headers.get("authorization"), null);
});
