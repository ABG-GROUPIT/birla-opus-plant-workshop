import assert from "node:assert/strict";
import { after, test } from "node:test";

import {
  BrowserSubmissionApiError,
  createReferenceUploadSession,
  listAdminSubmissions,
  listPresentationSubmissions,
  referenceUploadTransport,
  submitWorkshopResponse,
  updateAdminReference,
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
  createdAt: "2026-07-16T10:00:00.000Z",
  useCaseTitle: "Predictive maintenance",
  useCaseTheme: "Short use case",
  useCases: ["", "Short use case", "", ""],
  valueStreams: ["3"],
  expectedBenefits: "Faster planning.",
  status: "approved",
  isVisible: true,
  references: [
    {
      id: "26b8d5f0-8c6a-41ce-bbd6-7113cc184b95",
      title: "Line planning deck",
      kind: "powerpoint",
      externalUrl: null,
      objectPath: "session-a/plant planning deck.pptx",
      fileName: "plant planning deck.pptx",
      mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      sizeBytes: 512000,
      isVisible: true,
      sortOrder: 0,
      openUrl:
        "https://example.supabase.co/storage/v1/object/public/workshop-references/session-a/plant%20planning%20deck.pptx",
    },
    {
      id: "df65694e-5129-4a91-b86b-378c1439bd36",
      title: "Supplier reference",
      kind: "link",
      externalUrl: "https://example.org/reference",
      objectPath: null,
      fileName: null,
      mimeType: null,
      sizeBytes: null,
      isVisible: true,
      sortOrder: 1,
      openUrl: "https://example.org/reference",
    },
  ],
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
    submissions: [{
      ...publicSubmission,
      references: publicSubmission.references.map((reference) =>
        Object.fromEntries(
          Object.entries(reference).filter(([key]) => key !== "openUrl"),
        )),
    }],
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

test("submits one named use case and value stream through the references-aware RPC", async (t) => {
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
    useCaseTitle: "Predictive maintenance",
    useCaseTheme: "Short use case",
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
    "https://example.supabase.co/rest/v1/rpc/workshop_submit_single_use_case_with_references",
  );
  assert.deepEqual(JSON.parse(requests[0].init.body), {
    p_plant: "Panipat",
    p_submitter_name: "Plant leader",
    p_submitter_email: "leader@example.com",
    p_designation: "Plant Head",
    p_use_case_title: "Predictive maintenance",
    p_use_case_theme: "Short use case",
    p_value_stream: "3",
    p_expected_benefits: "Faster planning.",
    p_media_session_id: null,
    p_media_upload_token: null,
    p_references: [],
  });
});

test("rejects zero or multiple value streams before making a request", async (t) => {
  const requests = captureFetch(t, {});
  const baseInput = {
    plant: "Panipat",
    submitterName: "Plant leader",
    submitterEmail: "leader@example.com",
    designation: "Plant Head",
    useCaseTitle: "Predictive maintenance",
    useCaseTheme: "Short use case",
    expectedBenefits: "Faster planning.",
  };

  for (const valueStreams of [[], ["1", "2"]]) {
    await assert.rejects(
      submitWorkshopResponse({ ...baseInput, valueStreams }),
      (error) =>
        error instanceof BrowserSubmissionApiError &&
        error.code === "invalid_value_stream",
    );
  }
  assert.equal(requests.length, 0);
});

test("creates and parses a media upload session", async (t) => {
  const requests = captureFetch(t, {
    session: {
      sessionId: "c1a68276-3d94-48e3-849b-dc63add47d94",
      uploadToken: "unguessable-media-token",
      expiresAt: "2026-07-16T13:00:00.000Z",
    },
  });

  assert.deepEqual(await createReferenceUploadSession(), {
    sessionId: "c1a68276-3d94-48e3-849b-dc63add47d94",
    uploadToken: "unguessable-media-token",
    expiresAt: "2026-07-16T13:00:00.000Z",
  });
  assert.equal(
    requests[0].input,
    "https://example.supabase.co/rest/v1/rpc/workshop_media_session_create",
  );
  assert.deepEqual(JSON.parse(requests[0].init.body), {});
});

test("uses the direct Storage TUS endpoint and browser-safe upload headers", () => {
  const transport = referenceUploadTransport({
    sessionId: "c1a68276-3d94-48e3-849b-dc63add47d94",
    uploadToken: "unguessable-media-token",
    expiresAt: "2026-07-16T13:00:00.000Z",
  }, 2);

  assert.deepEqual(transport, {
    endpoint: "https://example.storage.supabase.co/storage/v1/upload/resumable",
    headers: {
      apikey: "sb_publishable_browser_safe",
      authorization: "Bearer sb_publishable_browser_safe",
    },
    objectPath:
      "c1a68276-3d94-48e3-849b-dc63add47d94/unguessable-media-token/2",
  });
  assert.equal("x-signature" in transport.headers, false);
});

test("rejects upload slots outside the three capability-scoped paths", () => {
  assert.throws(
    () => referenceUploadTransport({
      sessionId: "c1a68276-3d94-48e3-849b-dc63add47d94",
      uploadToken: "unguessable-media-token",
      expiresAt: null,
    }, 4),
    (error) =>
      error instanceof BrowserSubmissionApiError &&
      error.code === "invalid_reference_slot",
  );
});

test("submits link and uploaded-file manifests with the media capability", async (t) => {
  const requests = captureFetch(t, {
    submission: {
      id: publicSubmission.id,
      referenceId: "BO-F01CF1C7",
      submittedAt: "2026-07-16T10:00:00.000Z",
    },
  });

  await submitWorkshopResponse({
    plant: "Panipat",
    submitterName: "Plant leader",
    submitterEmail: "leader@example.com",
    designation: "Plant Head",
    useCaseTitle: "Predictive maintenance",
    useCaseTheme: "Short use case",
    valueStreams: ["3"],
    expectedBenefits: "Faster planning.",
    mediaSession: {
      sessionId: "c1a68276-3d94-48e3-849b-dc63add47d94",
      uploadToken: "unguessable-media-token",
      expiresAt: "2026-07-16T13:00:00.000Z",
    },
    references: [
      {
        title: "Supplier reference",
        kind: "link",
        externalUrl: "https://example.org/reference",
        sortOrder: 0,
      },
      {
        title: "Line planning deck",
        kind: "powerpoint",
        objectPath: "session-a/plant-planning-deck.pptx",
        fileName: "plant-planning-deck.pptx",
        mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        sizeBytes: 512000,
        sortOrder: 1,
      },
    ],
  });

  const body = JSON.parse(requests[0].init.body);
  assert.equal(body.p_media_session_id, "c1a68276-3d94-48e3-849b-dc63add47d94");
  assert.equal(body.p_media_upload_token, "unguessable-media-token");
  assert.deepEqual(body.p_references, [
    {
      title: "Supplier reference",
      kind: "link",
      externalUrl: "https://example.org/reference",
      objectPath: null,
      fileName: null,
      mimeType: null,
      sizeBytes: null,
      sortOrder: 0,
    },
    {
      title: "Line planning deck",
      kind: "powerpoint",
      externalUrl: null,
      objectPath: "session-a/plant-planning-deck.pptx",
      fileName: "plant-planning-deck.pptx",
      mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      sizeBytes: 512000,
      sortOrder: 1,
    },
  ]);
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
      useCaseTitle: "Predictive maintenance",
      useCaseTheme: "Short use case",
      valueStreams: ["3"],
      expectedBenefits: "Faster planning.",
      status: "rejected",
    }),
    { submission: updated },
  );

  assert.equal(
    requests[0].input,
    "https://example.supabase.co/rest/v1/rpc/workshop_admin_single_use_case_update",
  );
  assert.deepEqual(JSON.parse(requests[0].init.body), {
    p_capability: "unguessable-capability",
    p_id: adminSubmission.id,
    p_expected_updated_at: adminSubmission.updatedAt,
    p_plant: "Panipat",
    p_submitter_name: "Plant leader",
    p_submitter_email: "leader@example.com",
    p_designation: "Plant Head",
    p_use_case_title: "Predictive maintenance",
    p_use_case_theme: "Short use case",
    p_value_stream: "3",
    p_expected_benefits: "Faster planning.",
    p_status: "rejected",
  });
});

test("updates one admin reference without putting the capability in the URL", async (t) => {
  const updatedReference = {
    ...publicSubmission.references[1],
    title: "Approved supplier reference",
    externalUrl: "https://example.org/approved-reference",
    isVisible: false,
    openUrl: "https://example.org/approved-reference",
  };
  const requests = captureFetch(t, { reference: updatedReference });

  assert.deepEqual(
    await updateAdminReference("unguessable-capability", {
      id: updatedReference.id,
      title: updatedReference.title,
      externalUrl: updatedReference.externalUrl,
      isVisible: false,
    }),
    { reference: updatedReference },
  );
  assert.equal(
    requests[0].input,
    "https://example.supabase.co/rest/v1/rpc/workshop_admin_reference_update",
  );
  assert.deepEqual(JSON.parse(requests[0].init.body), {
    p_capability: "unguessable-capability",
    p_reference_id: updatedReference.id,
    p_title: "Approved supplier reference",
    p_external_url: "https://example.org/approved-reference",
    p_is_visible: false,
  });
  assert.equal(requests[0].input.includes("unguessable-capability"), false);
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
