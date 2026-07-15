import {
  getSubmission,
  parseUpdateSubmission,
  submissionErrorResponse,
  updateSubmission,
} from "@/lib/submissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

type RouteContext = { params: Promise<{ id: string }> | { id: string } };

async function responseId(context: RouteContext): Promise<string> {
  const { id } = await context.params;
  return id;
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const submission = await getSubmission(await responseId(context));
    return Response.json({ submission }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return submissionErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const payload = await request.json();
    const submission = await updateSubmission(
      await responseId(context),
      parseUpdateSubmission(payload),
    );
    return Response.json({ submission }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return submissionErrorResponse(error);
  }
}
