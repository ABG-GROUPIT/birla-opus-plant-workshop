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

export const VALUE_STREAM_NAMES = [
  "Productivity",
  "Quality",
  "Process Optimization",
  "Reliability",
  "Energy Efficiency",
  "Safety",
  "Sustainability",
  "Supply Chain",
] as const;

export const VALUE_STREAM_CODES = [
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
] as const;

export type PlantName = (typeof PLANT_NAMES)[number];
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];
export type ValueStreamName = (typeof VALUE_STREAM_NAMES)[number];
export type ValueStreamCode = (typeof VALUE_STREAM_CODES)[number];
export type ValueStreamInput = ValueStreamName | ValueStreamCode;

const VALUE_STREAM_NAME_SET = new Set<string>(VALUE_STREAM_NAMES);
const VALUE_STREAM_CODE_SET = new Set<string>(VALUE_STREAM_CODES);

export function canonicalValueStream(value: string): ValueStreamName | null {
  const normalized = value.trim();
  if (VALUE_STREAM_NAME_SET.has(normalized)) return normalized as ValueStreamName;
  if (!VALUE_STREAM_CODE_SET.has(normalized)) return null;
  return VALUE_STREAM_NAMES[Number(normalized) - 1];
}
