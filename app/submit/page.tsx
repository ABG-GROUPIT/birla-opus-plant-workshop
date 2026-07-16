import type { Metadata } from "next";
import { LeaderSubmission } from "../workshop-canvas";

export const metadata: Metadata = {
  title: "Leader Submission · Birla Opus Workshop",
  description: "Submit one workshop use case for a plant or Head Office (Mumbai).",
};

export default function SubmitPage() {
  return <LeaderSubmission />;
}
