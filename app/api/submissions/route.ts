import {
  createSubmission,
  listSubmissions,
  parseBooleanFilter,
  parseCreateSubmission,
  parsePlantFilter,
  parseStatusFilter,
  submissionErrorResponse,
} from "@/lib/submissions";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  try {
    const searchParams = new URL(request.url).searchParams;
    const presentation = parseBooleanFilter(
      searchParams.get("presentation"),
      "presentation",
    );
    const isVisible = parseBooleanFilter(
      searchParams.get("isVisible") ?? searchParams.get("visible"),
      "isVisible",
    );
    const submissions = await listSubmissions({
      presentation,
      plant: parsePlantFilter(searchParams.get("plant")),
      status: parseStatusFilter(searchParams.get("status")),
      isVisible,
    });
    const responseSubmissions = presentation
      ? submissions.map((submission) => ({
          id: submission.id,
          plant: submission.plant,
          submitterName: submission.submitterName,
          useCases: submission.useCases,
          valueStreams: submission.valueStreams,
          expectedBenefits: submission.expectedBenefits,
          status: submission.status,
          isVisible: submission.isVisible,
        }))
      : submissions;

    return Response.json(
      { submissions: responseSubmissions, count: responseSubmissions.length },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    return submissionErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const submission = await createSubmission(parseCreateSubmission(payload));
    return Response.json(
      { submission },
      { status: 201, headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    return submissionErrorResponse(error);
  }
}
