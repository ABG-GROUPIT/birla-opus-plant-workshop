import { withSupabase } from "npm:@supabase/server@1.4.1";

const REFERENCE_BUCKET = "workshop-references";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-max-age": "600",
};

type AccessPayload = {
  referenceId?: unknown;
  capability?: unknown;
  disposition?: unknown;
};

type AuthorizedReference = {
  referenceId: string;
  objectPath: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
};

type WorkshopAdminClient = {
  rpc: (
    functionName: "workshop_reference_access",
    parameters: { p_reference_id: string; p_capability: string | null },
  ) => Promise<{
    data: unknown;
    error: { code?: string } | null;
  }>;
  storage: {
    from: (bucket: string) => {
      download: (path: string) => Promise<{
        data: Blob | null;
        error: unknown;
      }>;
    };
  };
};

function jsonResponse(status: number, message: string, code?: string) {
  return new Response(JSON.stringify({ message, ...(code ? { code } : {}) }), {
    status,
    headers: {
      ...corsHeaders,
      "cache-control": "private, no-store, max-age=0",
      "content-type": "application/json; charset=utf-8",
    },
  });
}

function safeFileName(value: string) {
  const cleaned = value
    .replace(/[\r\n"\\/]/g, "_")
    .replace(/[\u0000-\u001f\u007f]/g, "_")
    .trim();
  return cleaned || "workshop-reference";
}

function contentDisposition(fileName: string, download: boolean) {
  const safeName = safeFileName(fileName);
  const asciiName = safeName.replace(/[^\x20-\x7e]/g, "_");
  return `${download ? "attachment" : "inline"}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(safeName)}`;
}

async function requestPayload(request: Request): Promise<AccessPayload> {
  if (request.method === "GET") {
    const url = new URL(request.url);
    return {
      referenceId: url.searchParams.get("id"),
      capability: null,
      disposition: url.searchParams.get("disposition"),
    };
  }

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > 4096) {
    throw new Error("request_too_large");
  }
  return await request.json() as AccessPayload;
}

function parseAuthorizedReference(value: unknown): AuthorizedReference | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (
    typeof row.referenceId !== "string" ||
    typeof row.objectPath !== "string" ||
    typeof row.fileName !== "string" ||
    typeof row.mimeType !== "string" ||
    typeof row.sizeBytes !== "number"
  ) {
    return null;
  }
  return row as AuthorizedReference;
}

const handleRequest = withSupabase({ auth: "none" }, async (request, context) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (request.method !== "GET" && request.method !== "POST") {
    return jsonResponse(405, "Method not allowed.");
  }

  let input: AccessPayload;
  try {
    input = await requestPayload(request);
  } catch {
    return jsonResponse(400, "Invalid request.");
  }

  const referenceId = typeof input.referenceId === "string"
    ? input.referenceId.trim()
    : "";
  const capability = typeof input.capability === "string"
    ? input.capability.trim()
    : null;
  const isAdminRequest = request.method === "POST" && Boolean(capability);
  if (!UUID_PATTERN.test(referenceId)) {
    return jsonResponse(400, "A valid reference ID is required.");
  }

  const adminClient = context.supabaseAdmin as unknown as WorkshopAdminClient;
  const { data: authorizationData, error: authorizationError } =
    await adminClient.rpc("workshop_reference_access", {
      p_reference_id: referenceId,
      p_capability: isAdminRequest ? capability : null,
    });

  if (authorizationError) {
    // Do not reveal whether a private reference exists.
    return jsonResponse(
      isAdminRequest ? 403 : 404,
      "Reference file is not available.",
      isAdminRequest && authorizationError.code === "28000" ? "28000" : undefined,
    );
  }

  const authorized = parseAuthorizedReference(authorizationData);
  if (!authorized || authorized.referenceId !== referenceId) {
    return jsonResponse(502, "Reference metadata is invalid.");
  }

  const { data: objectData, error: objectError } = await adminClient
    .storage
    .from(REFERENCE_BUCKET)
    .download(authorized.objectPath);

  if (objectError || !objectData) {
    return jsonResponse(404, "Reference file is not available.");
  }

  const responseHeaders = new Headers(corsHeaders);
  responseHeaders.set("cache-control", "private, no-store, max-age=0");
  responseHeaders.set("content-type", authorized.mimeType);
  responseHeaders.set(
    "content-disposition",
    contentDisposition(
      authorized.fileName,
      input.disposition === "attachment" || input.disposition === "download",
    ),
  );
  responseHeaders.set("x-content-type-options", "nosniff");
  responseHeaders.set("content-length", String(objectData.size));

  return new Response(objectData.stream(), {
    status: 200,
    headers: responseHeaders,
  });
});

export default { fetch: handleRequest };
