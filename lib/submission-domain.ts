export const PLANT_NAMES = [
  "Panipat",
  "Ludhiana",
  "Cheyyar",
  "Chamarajanagar",
  "Mahad",
  "Kharagpur",
  "Head Office (Mumbai)",
] as const;

export const SUBMISSION_STATUSES = [
  "draft",
  "submitted",
  "approved",
  "rejected",
] as const;

export type PlantName = (typeof PLANT_NAMES)[number];
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];
