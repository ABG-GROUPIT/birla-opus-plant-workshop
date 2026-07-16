import type { Metadata } from "next";
import { WorkshopPresentation } from "./workshop-canvas";

export const metadata: Metadata = {
  title: "Birla Opus Workshop Presentation",
  description:
    "Approved workshop responses from six Birla Opus plants and Head Office (Mumbai).",
};

export default function Home() {
  return <WorkshopPresentation />;
}
