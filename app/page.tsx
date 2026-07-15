import type { Metadata } from "next";
import { WorkshopPresentation } from "./workshop-canvas";

export const metadata: Metadata = {
  title: "Birla Opus Workshop Presentation",
  description: "Approved workshop responses from six Birla Opus plants.",
};

export default function Home() {
  return <WorkshopPresentation />;
}
