import type { Metadata } from "next";
import { AdminReview } from "../workshop-canvas";

export const metadata: Metadata = {
  title: "Admin Review · Birla Opus Workshop",
  description: "Verify and control presentation visibility for workshop responses.",
};

export default function AdminPage() {
  return <AdminReview />;
}
