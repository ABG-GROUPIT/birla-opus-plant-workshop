import type { Metadata } from "next";
import { LeaderSubmission } from "../workshop-canvas";

export const metadata: Metadata = {
  title: "Leader Submission · Birla Opus Workshop",
  description: "Submit a plant workshop response for verification.",
};

export default function SubmitPage() {
  return <LeaderSubmission />;
}
