"use client";

import Image from "next/image";
import Link from "next/link";
import {
  createReferenceUploadSession,
  listAdminSubmissions,
  listPresentationSubmissions,
  submitWorkshopResponse,
  updateAdminReference,
  updateAdminSubmission,
  uploadReferenceFile,
} from "@/lib/browser-submission-api";
import type {
  AdminSubmissionUpdateInput,
  BrowserReferenceMedia,
  BrowserValueStream,
  ReferenceManifestInput,
  ReferenceUploadSession,
} from "@/lib/browser-submission-api";
import {
  REFERENCE_FILE_ACCEPT,
  REFERENCE_LIMITS,
  classifyReferenceFile,
  defaultReferenceTitle,
  formatReferenceSize,
  referenceKindLabel,
  validateReferenceSelection,
} from "@/lib/reference-media";
import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type Status = "draft" | "submitted" | "rejected" | "approved";

type Plant = {
  id: string;
  name: string;
  location: string;
  image: string;
  accent: string;
  number: string;
};

type Submission = {
  id: string;
  plant: string;
  submitterName: string;
  submitterEmail: string;
  designation: string;
  useCases: Array<{ id: string; description: string }>;
  valueStreams: string[];
  expectedBenefits: string;
  status: Status;
  isVisible: boolean;
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
  referenceId?: string;
  references: BrowserReferenceMedia[];
};

type ReferenceLinkDraft = {
  id: string;
  title: string;
  url: string;
};

type ReferenceFileDraft = {
  id: string;
  title: string;
  file: File;
};

type FormState = {
  plant: string;
  submitterName: string;
  submitterEmail: string;
  designation: string;
  selectedUseCase: string;
  useCaseDescriptions: Record<string, string>;
  valueStreams: string[];
  expectedBenefits: string;
  referenceLinks: ReferenceLinkDraft[];
};

type AdminEditState = {
  plant: string;
  submitterName: string;
  submitterEmail: string;
  designation: string;
  selectedUseCase: string;
  useCaseDescription: string;
  valueStream: string;
  expectedBenefits: string;
};

type SubmissionPatch = Partial<{
  plant: string;
  submitterName: string;
  submitterEmail: string;
  designation: string;
  useCases: string[];
  valueStreams: string[];
  expectedBenefits: string;
  status: Status;
  isVisible: boolean;
}>;

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

function withBasePath(path: string) {
  if (!path.startsWith("/") || !BASE_PATH) return path;
  return `${BASE_PATH}${path}`;
}

const PLANTS: Plant[] = [
  {
    id: "Panipat",
    name: "Panipat",
    location: "Haryana",
    number: "01",
    accent: "#F36A36",
    image: withBasePath("/plants/panipat.jpg"),
  },
  {
    id: "Ludhiana",
    name: "Ludhiana",
    location: "Punjab",
    number: "02",
    accent: "#D12D73",
    image: withBasePath("/plants/ludhiana.jpg"),
  },
  {
    id: "Cheyyar",
    name: "Cheyyar",
    location: "Tamil Nadu",
    number: "03",
    accent: "#DB5737",
    image: withBasePath("/plants/cheyyar.jpg"),
  },
  {
    id: "Chamarajanagar",
    name: "Chamarajanagar",
    location: "Karnataka",
    number: "04",
    accent: "#13969B",
    image: withBasePath("/plants/chamarajanagar.jpg"),
  },
  {
    id: "Mahad",
    name: "Mahad",
    location: "Maharashtra",
    number: "05",
    accent: "#7152A3",
    image: withBasePath("/plants/mahad.jpg"),
  },
  {
    id: "Kharagpur",
    name: "Kharagpur",
    location: "West Bengal",
    number: "06",
    accent: "#EAA529",
    image: withBasePath("/plants/kharagpur.jpg"),
  },
];

const USE_CASES = ["Use Case 1", "Use Case 2", "Use Case 3", "Use Case 4"];
const VALUE_STREAMS = [
  "Value Stream 1",
  "Value Stream 2",
  "Value Stream 3",
  "Value Stream 4",
];

const LOCAL_DRAFT_KEY = "birla-opus-leader-response-draft-v1";
const ADMIN_CAPABILITY_KEY = "birla-opus-admin-capability-v1";
const SUBMISSION_SYNC_KEY = "birla-opus-submissions-changed-v1";
const SUBMISSION_SYNC_CHANNEL = "birla-opus-workshop-sync-v1";

function announceSubmissionChange() {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(SUBMISSION_SYNC_KEY, String(Date.now()));
  } catch {
    // BroadcastChannel still provides instant same-origin refresh when available.
  }

  if ("BroadcastChannel" in window) {
    const channel = new BroadcastChannel(SUBMISSION_SYNC_CHANNEL);
    channel.postMessage("submissions-changed");
    channel.close();
  }
}

const EMPTY_FORM: FormState = {
  plant: "Panipat",
  submitterName: "",
  submitterEmail: "",
  designation: "",
  selectedUseCase: "",
  useCaseDescriptions: {},
  valueStreams: [],
  expectedBenefits: "",
  referenceLinks: [],
};

function normaliseSubmission(value: Partial<Submission>): Submission {
  const rawUseCases = Array.isArray(value.useCases) ? value.useCases : [];
  return {
    id: String(value.id ?? crypto.randomUUID()),
    referenceId: value.referenceId,
    plant: String(value.plant ?? "Panipat"),
    submitterName: String(value.submitterName ?? "Workshop leader"),
    submitterEmail: String(value.submitterEmail ?? ""),
    designation: String(value.designation ?? ""),
    useCases: rawUseCases.map((item, index) => {
      if (typeof item === "string") {
        return { id: USE_CASES[index] ?? `Use Case ${index + 1}`, description: item };
      }
      return {
        id: String(item?.id ?? USE_CASES[index] ?? `Use Case ${index + 1}`),
        description: String(item?.description ?? ""),
      };
    }).filter((item) => item.description.trim().length > 0),
    valueStreams: Array.isArray(value.valueStreams)
      ? value.valueStreams.map((item) => {
          const text = String(item);
          return /^[1-4]$/.test(text) ? `Value Stream ${text}` : text;
        })
      : [],
    expectedBenefits: String(value.expectedBenefits ?? ""),
    status: (value.status ?? "submitted") as Status,
    isVisible: Boolean(value.isVisible),
    createdAt: String(value.createdAt ?? new Date().toISOString()),
    updatedAt: String(value.updatedAt ?? value.createdAt ?? new Date().toISOString()),
    submittedAt: value.submittedAt ? String(value.submittedAt) : null,
    references: Array.isArray(value.references) ? value.references : [],
  };
}

function apiRows(payload: unknown): Submission[] {
  if (Array.isArray(payload)) return payload.map(normaliseSubmission);
  if (payload && typeof payload === "object") {
    const record = payload as { submissions?: unknown; data?: unknown };
    if (Array.isArray(record.submissions)) return record.submissions.map(normaliseSubmission);
    if (Array.isArray(record.data)) return record.data.map(normaliseSubmission);
  }
  return [];
}

function formatDate(value: string) {
  try {
    return new Intl.DateTimeFormat("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }).format(new Date(value));
  } catch {
    return "—";
  }
}

function formatDateTime(value: string | null) {
  if (!value) return "Not submitted yet";
  try {
    return new Intl.DateTimeFormat("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return "Not available";
  }
}

function formatSyncTime(value: string) {
  try {
    return new Intl.DateTimeFormat("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(new Date(value));
  } catch {
    return "just now";
  }
}

function referenceMeta(reference: BrowserReferenceMedia) {
  if (reference.kind === "link") {
    try {
      return new URL(reference.openUrl).hostname;
    } catch {
      return "HTTPS web link";
    }
  }

  return [
    referenceKindLabel(reference.kind),
    reference.sizeBytes === null
      ? null
      : formatReferenceSize(reference.sizeBytes),
  ].filter(Boolean).join(" · ");
}

function referenceDownloadUrl(reference: BrowserReferenceMedia) {
  if (!reference.openUrl || reference.kind === "link") return reference.openUrl;
  try {
    const url = new URL(reference.openUrl);
    url.searchParams.set("download", reference.fileName ?? reference.title);
    return url.toString();
  } catch {
    return reference.openUrl;
  }
}

function referenceOfficeUrl(reference: BrowserReferenceMedia) {
  const scheme = reference.kind === "powerpoint"
    ? "ms-powerpoint"
    : reference.kind === "word"
      ? "ms-word"
      : reference.kind === "spreadsheet"
        ? "ms-excel"
        : null;
  return scheme && reference.openUrl
    ? `${scheme}:ofv|u|${reference.openUrl}`
    : null;
}

function referenceBadge(kind: BrowserReferenceMedia["kind"]) {
  if (kind === "powerpoint") return "PPT";
  if (kind === "spreadsheet") return "XLS";
  if (kind === "word") return "DOC";
  if (kind === "link") return "URL";
  if (kind === "image") return "IMG";
  return "PDF";
}

function statusLabel(status: Status) {
  if (status === "rejected") return "Needs changes";
  if (status === "submitted") return "Submitted";
  if (status === "approved") return "Approved";
  return "Draft";
}

function getPlant(id: string) {
  return PLANTS.find((plant) => plant.id === id) ?? PLANTS[0];
}

function chosenUseCase(submission: Submission | null) {
  return submission?.useCases.find(
    (item) => item.description.trim().length > 0,
  ) ?? null;
}

function adminEditState(submission: Submission): AdminEditState {
  const useCase = chosenUseCase(submission);
  return {
    plant: submission.plant,
    submitterName: submission.submitterName,
    submitterEmail: submission.submitterEmail,
    designation: submission.designation,
    selectedUseCase: useCase?.id ?? USE_CASES[0],
    useCaseDescription: useCase?.description ?? "",
    valueStream: submission.valueStreams[0] ?? VALUE_STREAMS[0],
    expectedBenefits: submission.expectedBenefits,
  };
}

function hasLocalDraftContent(form: FormState) {
  return Boolean(
    form.submitterName.trim() ||
      form.submitterEmail.trim() ||
      form.designation.trim() ||
      form.selectedUseCase ||
      form.valueStreams.length ||
      form.expectedBenefits.trim() ||
      form.referenceLinks.length,
  );
}

function completion(form: FormState) {
  const checks = [
    Boolean(form.plant),
    Boolean(form.submitterName.trim()),
    Boolean(form.submitterEmail.trim()),
    Boolean(form.designation.trim()),
    Boolean(
      form.selectedUseCase &&
        form.useCaseDescriptions[form.selectedUseCase]?.trim(),
    ),
    form.valueStreams.length === 1,
    Boolean(form.expectedBenefits.trim()),
  ];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}

export function WorkshopPresentation() {
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [activePlant, setActivePlant] = useState<string | null>(null);
  const [responseIndex, setResponseIndex] = useState(0);

  const loadSubmissions = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true);
    try {
      setSubmissions(apiRows(await listPresentationSubmissions()));
      setNotice("");
      setLastUpdatedAt(new Date().toISOString());
    } catch (error) {
      setNotice(
        silent
          ? "Live refresh is paused. Select Refresh now to reconnect."
          : error instanceof Error
            ? error.message
            : "Responses will appear here once the data service is available.",
      );
    } finally {
      if (!silent) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const startup = window.setTimeout(() => void loadSubmissions(), 0);
    const interval = window.setInterval(() => void loadSubmissions(true), 3_000);
    const refreshWhenActive = () => {
      if (document.visibilityState === "visible") void loadSubmissions(true);
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key === SUBMISSION_SYNC_KEY) void loadSubmissions(true);
    };
    const channel = "BroadcastChannel" in window
      ? new BroadcastChannel(SUBMISSION_SYNC_CHANNEL)
      : null;
    channel?.addEventListener("message", refreshWhenActive);
    document.addEventListener("visibilitychange", refreshWhenActive);
    window.addEventListener("focus", refreshWhenActive);
    window.addEventListener("online", refreshWhenActive);
    window.addEventListener("pageshow", refreshWhenActive);
    window.addEventListener("storage", handleStorage);
    return () => {
      window.clearTimeout(startup);
      window.clearInterval(interval);
      channel?.removeEventListener("message", refreshWhenActive);
      channel?.close();
      document.removeEventListener("visibilitychange", refreshWhenActive);
      window.removeEventListener("focus", refreshWhenActive);
      window.removeEventListener("online", refreshWhenActive);
      window.removeEventListener("pageshow", refreshWhenActive);
      window.removeEventListener("storage", handleStorage);
    };
  }, [loadSubmissions]);

  return (
    <main className="app-shell presentation-shell">
      <PresentationView
        submissions={submissions}
        isLoading={isLoading}
        notice={notice}
        lastUpdatedAt={lastUpdatedAt}
        activePlant={activePlant}
        responseIndex={responseIndex}
        onPlantChange={(plant) => {
          setActivePlant(plant);
          setResponseIndex(0);
        }}
        onResponseChange={setResponseIndex}
        onRefresh={() => void loadSubmissions()}
        onExit={() => {
          setActivePlant(null);
          setResponseIndex(0);
        }}
      />
    </main>
  );
}

export function LeaderSubmission() {
  const [notice, setNotice] = useState("");

  return (
    <main className="app-shell operational-shell">
      <SurfaceHeader context="Leader submission" />
      <SubmissionView notice={notice} onSaved={setNotice} />
    </main>
  );
}

export function AdminReview() {
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [capability, setCapability] = useState<string | null>(null);
  const [capabilityChecked, setCapabilityChecked] = useState(false);

  const loadSubmissions = useCallback(async (adminCapability: string) => {
    setIsLoading(true);
    try {
      setSubmissions(apiRows(await listAdminSubmissions(adminCapability)));
      setNotice("");
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Responses could not be loaded.",
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const startup = window.setTimeout(() => {
      const fragmentCapability = window.location.hash.slice(1).trim();
      let storedCapability = "";
      try {
        storedCapability = window.sessionStorage.getItem(ADMIN_CAPABILITY_KEY) ?? "";
        if (fragmentCapability) {
          window.sessionStorage.setItem(ADMIN_CAPABILITY_KEY, fragmentCapability);
        }
      } catch {
        // The URL capability still works if session storage is unavailable.
      }

      const resolvedCapability = fragmentCapability || storedCapability;
      if (fragmentCapability) {
        window.history.replaceState(
          null,
          "",
          `${window.location.pathname}${window.location.search}`,
        );
      }
      setCapability(resolvedCapability || null);
      setCapabilityChecked(true);
    }, 0);
    return () => window.clearTimeout(startup);
  }, []);

  useEffect(() => {
    if (!capabilityChecked || !capability) return;
    const startup = window.setTimeout(() => void loadSubmissions(capability), 0);
    return () => window.clearTimeout(startup);
  }, [capability, capabilityChecked, loadSubmissions]);

  return (
    <main className="app-shell operational-shell">
      <SurfaceHeader context="Admin verification" />
      <ReviewView
        submissions={submissions}
        isLoading={isLoading}
        notice={notice || (capabilityChecked && !capability
          ? "This admin link is incomplete. Open the complete private admin URL provided for the workshop."
          : "")}
        capability={capability}
        onChanged={async (message) => {
          if (capability) await loadSubmissions(capability);
          setNotice(message);
        }}
      />
    </main>
  );
}

function SurfaceHeader({ context }: { context: string }) {
  return (
    <header className="site-header surface-header">
      <BrandIdentity context="Plant Workshop Canvas" />
      <div className="header-note">
        <span className="live-dot" />
        {context}
      </div>
    </header>
  );
}

function BrandIdentity({
  context,
  presentation = false,
}: {
  context: string;
  presentation?: boolean;
}) {
  return (
    <div className={`brand-identity${presentation ? " presentation-identity" : ""}`}>
      <span className="brand-logo-frame">
        <Image
          className="brand-logo-image"
          src={withBasePath("/brand/birla-opus-logo.png")}
          alt="Birla Opus Paints"
          width={256}
          height={148}
          priority={presentation}
          unoptimized
        />
      </span>
      <span className="brand-context">{context}</span>
    </div>
  );
}

function PresentationView({
  submissions,
  isLoading,
  notice,
  lastUpdatedAt,
  activePlant,
  responseIndex,
  onPlantChange,
  onResponseChange,
  onRefresh,
  onExit,
}: {
  submissions: Submission[];
  isLoading: boolean;
  notice: string;
  lastUpdatedAt: string | null;
  activePlant: string | null;
  responseIndex: number;
  onPlantChange: (plant: string) => void;
  onResponseChange: (index: number) => void;
  onRefresh: () => void;
  onExit: () => void;
}) {
  const referenceDialogRef = useRef<HTMLDialogElement>(null);
  const published = useMemo(
    () => submissions.filter((item) => item.status === "approved" && item.isVisible),
    [submissions],
  );

  const movePlant = useCallback(
    (direction: number) => {
      if (!activePlant) return;
      const index = PLANTS.findIndex((plant) => plant.id === activePlant);
      const next = (index + direction + PLANTS.length) % PLANTS.length;
      onPlantChange(PLANTS[next].id);
    },
    [activePlant, onPlantChange],
  );

  const plantResponses = useMemo(() => {
    if (!activePlant) return [];
    return published
      .filter((item) => item.plant === activePlant)
      .sort((left, right) => {
        const leftIndex = USE_CASES.indexOf(chosenUseCase(left)?.id ?? "");
        const rightIndex = USE_CASES.indexOf(chosenUseCase(right)?.id ?? "");
        if (leftIndex !== rightIndex) return leftIndex - rightIndex;
        return left.createdAt.localeCompare(right.createdAt);
      });
  }, [activePlant, published]);

  const moveResponse = useCallback(
    (direction: number) => {
      if (!plantResponses.length) return;
      onResponseChange(
        (responseIndex + direction + plantResponses.length) % plantResponses.length,
      );
    },
    [onResponseChange, plantResponses.length, responseIndex],
  );

  useEffect(() => {
    if (!activePlant) return;
    const handleKey = (event: globalThis.KeyboardEvent) => {
      if (referenceDialogRef.current?.open) {
        if (event.key === "Escape") {
          event.preventDefault();
          referenceDialogRef.current.close();
        }
        return;
      }
      if (event.key === "Escape") {
        onExit();
        return;
      }
      if (event.key.toLowerCase() === "f") {
        void document.documentElement.requestFullscreen?.();
        return;
      }
      const withinScrollRegion =
        event.target instanceof HTMLElement &&
        Boolean(event.target.closest("[data-presentation-scroll]"));
      if (
        withinScrollRegion &&
        ["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"].includes(
          event.key,
        )
      ) {
        return;
      }
      if (event.key === "ArrowLeft") moveResponse(-1);
      if (event.key === "ArrowRight") moveResponse(1);
      if (event.key === "ArrowUp") movePlant(-1);
      if (event.key === "ArrowDown") movePlant(1);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [activePlant, movePlant, moveResponse, onExit]);

  if (!activePlant) {
    return (
      <section className="presentation-index">
        <div className="presentation-brandline">
          <BrandIdentity context="Plant Leadership Workshop" presentation />
        </div>
        <div className="presentation-intro">
          <div>
            <p className="eyebrow">Presentation mode · Six plants</p>
            <h1>One workshop.<br />Six points of view.</h1>
          </div>
          <div className="intro-copy">
            <p>
              Select a plant to open its approved workshop responses. Everything on
              this screen is ready for the room.
            </p>
            <div className="presentation-sync">
              <span>{published.length} responses included</span>
              <button type="button" onClick={onRefresh} disabled={isLoading}>
                {isLoading ? "Syncing…" : "Refresh now ↻"}
              </button>
            </div>
            {lastUpdatedAt && (
              <small className="presentation-sync-time">
                Last checked {formatSyncTime(lastUpdatedAt)}
              </small>
            )}
          </div>
        </div>
        {notice && <p className="quiet-notice">{notice}</p>}
        <div className="plant-grid" aria-label="Select a plant">
          {PLANTS.map((plant) => {
            const count = published.filter((item) => item.plant === plant.id).length;
            return (
              <button
                className="plant-tile"
                key={plant.id}
                onClick={() => onPlantChange(plant.id)}
                type="button"
                style={{
                  "--plant-accent": plant.accent,
                  backgroundImage: `linear-gradient(180deg, rgba(21,13,26,.04), rgba(21,13,26,.84)), url("${plant.image}")`,
                } as React.CSSProperties}
              >
                <span className="plant-number">{plant.number}</span>
                <span className="plant-status">
                  <i className={count ? "ready" : ""} />
                  {isLoading ? "Checking…" : count ? `${count} approved` : "Awaiting approval"}
                </span>
                <span className="plant-title">
                  <strong>{plant.name}</strong>
                  <small>{plant.location}</small>
                </span>
                <span className="tile-arrow" aria-hidden="true">↗</span>
              </button>
            );
          })}
        </div>
        <div className="presentation-footer">
          <span>Birla Opus · Plant Leadership Workshop</span>
          <span>Choose any plant to begin · <Link href="/credits">Photo credits</Link></span>
        </div>
      </section>
    );
  }

  const plant = getPlant(activePlant);
  const response = plantResponses[responseIndex] ?? null;
  const activeUseCase = chosenUseCase(response);
  const visibleReferences = response?.references.filter(
    (reference) => reference.isVisible && Boolean(reference.openUrl),
  ) ?? [];

  return (
    <section className="plant-presentation" style={{ "--plant-accent": plant.accent } as React.CSSProperties}>
      <div
        className="plant-hero"
        style={{
          backgroundImage: `linear-gradient(90deg, rgba(18,12,23,.88) 0%, rgba(18,12,23,.3) 68%, rgba(18,12,23,.7) 100%), url("${plant.image}")`,
        }}
      >
        <div className="hero-identity">
          <BrandIdentity context="Plant Leadership Workshop" presentation />
          <button className="back-link" type="button" onClick={onExit}>← All plants</button>
        </div>
        <div className="plant-hero-copy">
          <p className="eyebrow light">Plant {plant.number} · {plant.location}</p>
          <h1 className={plant.name.length > 10 ? "long-plant-name" : undefined}>{plant.name}</h1>
          <div className="response-meta">
            <span>
              {plantResponses.length
                ? `Response ${String(responseIndex + 1).padStart(2, "0")} of ${String(plantResponses.length).padStart(2, "0")}`
                : "No response published"}
            </span>
            {response && (
              <span>
                {activeUseCase?.id ?? "Use case"} · {response.submitterName}
                {response.designation ? `, ${response.designation}` : ""}
              </span>
            )}
          </div>
        </div>
        <div className="hero-controls">
          <button type="button" onClick={() => movePlant(-1)} aria-label="Previous plant">↑</button>
          <button type="button" onClick={() => movePlant(1)} aria-label="Next plant">↓</button>
          <button
            type="button"
            onClick={onRefresh}
            aria-label="Refresh responses"
            disabled={isLoading}
          >
            ↻
          </button>
          <button
            type="button"
            onClick={() => void document.documentElement.requestFullscreen?.()}
            aria-label="Enter full screen"
          >
            ⛶
          </button>
        </div>
      </div>

      <div className="response-stage response-stage-compact">
        {response ? (
          <>
            <aside className="response-facts">
              <article className="selected-use-case">
                <p className="eyebrow">Chosen use case</p>
                <div className="selected-use-case-heading">
                  <span>
                    {String(
                      Math.max(1, USE_CASES.indexOf(activeUseCase?.id ?? "") + 1),
                    ).padStart(2, "0")}
                  </span>
                  <h2>{activeUseCase?.id ?? "Use case"}</h2>
                </div>
                <p
                  className="selected-use-case-description"
                  data-presentation-scroll
                  tabIndex={0}
                  role="region"
                  aria-label="Use case description"
                >
                  {activeUseCase?.description ?? "No use-case description supplied."}
                </p>
              </article>

              <div className="value-stream-summary">
                <p className="eyebrow">Selected value stream</p>
                <div className="stream-sentence">
                  {response.valueStreams.map((stream) => (
                    <span key={stream}>{stream}</span>
                  ))}
                </div>
              </div>
            </aside>

            <article className="expected-benefits-panel">
              <div className="expected-benefits-heading">
                <div>
                  <p className="eyebrow light">Primary workshop outcome</p>
                  <h2>Expected benefits</h2>
                </div>
                <span>03</span>
              </div>
              <div
                className="expected-benefits-copy"
                data-presentation-scroll
                tabIndex={0}
                role="region"
                aria-label="Expected benefits"
              >
                <span className="benefit-mark" aria-hidden="true">＋</span>
                <blockquote
                  className={
                    response.expectedBenefits.length > 900
                      ? "very-long-copy"
                      : response.expectedBenefits.length > 600
                        ? "long-copy"
                        : response.expectedBenefits.length > 300
                          ? "medium-copy"
                          : ""
                  }
                >
                  {response.expectedBenefits}
                </blockquote>
              </div>
              <div className="expected-benefits-footer">
                <span>{getPlant(response.plant).name}</span>
                <span>Verified response</span>
                {visibleReferences.length > 0 && (
                  <button
                    className="reference-trigger"
                    type="button"
                    onClick={() => referenceDialogRef.current?.showModal()}
                  >
                    Open references ({visibleReferences.length}) <span>↗</span>
                  </button>
                )}
              </div>
            </article>
          </>
        ) : (
          <div className="empty-presentation">
            <span>Pending</span>
            <h2>Responses are being prepared.</h2>
            <p>
              Once an administrator approves and includes a response, its use cases,
              value streams and expected benefits will appear here.
            </p>
          </div>
        )}
      </div>

      <div className="response-navigation">
        <button type="button" onClick={() => moveResponse(-1)} disabled={plantResponses.length < 2}>← Previous response</button>
        <span className="response-position" aria-label="Response position">
          {plantResponses.length
            ? `${String(responseIndex + 1).padStart(2, "0")} / ${String(plantResponses.length).padStart(2, "0")}`
            : "00 / 00"}
        </span>
        <button type="button" onClick={() => moveResponse(1)} disabled={plantResponses.length < 2}>Next response →</button>
      </div>

      <dialog
        className="reference-dialog"
        ref={referenceDialogRef}
        aria-labelledby="reference-dialog-title"
        onClick={(event) => {
          if (event.target === event.currentTarget) event.currentTarget.close();
        }}
      >
        <div className="reference-dialog-shell">
          <div className="reference-dialog-heading">
            <div>
              <p className="eyebrow">Supporting material · {plant.name}</p>
              <h2 id="reference-dialog-title">Reference media</h2>
            </div>
            <button
              type="button"
              aria-label="Close reference media"
              onClick={() => referenceDialogRef.current?.close()}
            >
              ×
            </button>
          </div>
          <div className="reference-list">
            {visibleReferences.map((reference) => {
              const officeUrl = referenceOfficeUrl(reference);
              return (
                <article className="reference-card" key={reference.id}>
                  <span className="reference-card-icon" aria-hidden="true">
                    {referenceBadge(reference.kind)}
                  </span>
                  <div className="reference-card-copy">
                    <strong>{reference.title}</strong>
                    <small>{referenceMeta(reference)}</small>
                  </div>
                  <div className="reference-card-actions">
                    <a
                      className="reference-primary-link"
                      href={reference.openUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {reference.kind === "link" ? "Open link" : `Open ${referenceKindLabel(reference.kind)}`} ↗
                    </a>
                    {officeUrl && (
                      <a className="reference-app-link" href={officeUrl}>
                        Open in app
                      </a>
                    )}
                    {reference.kind !== "link" && (
                      <a
                        className="reference-secondary-link"
                        href={referenceDownloadUrl(reference)}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Download
                      </a>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </dialog>
    </section>
  );
}

function SubmissionView({
  onSaved,
  notice,
}: {
  onSaved: (message: string) => void;
  notice: string;
}) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [isSaving, setIsSaving] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [savedReference, setSavedReference] = useState("");
  const [lastSubmittedAt, setLastSubmittedAt] = useState<string | null>(null);
  const [draftReady, setDraftReady] = useState(false);
  const [referenceFiles, setReferenceFiles] = useState<ReferenceFileDraft[]>([]);
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});
  const [uploadMessage, setUploadMessage] = useState("");
  const [fileInputKey, setFileInputKey] = useState(0);
  const active = getPlant(form.plant);
  const percent = completion(form);
  const totalReferenceItems = referenceFiles.length + form.referenceLinks.length;
  const aggregateUploadProgress = referenceFiles.length
    ? Math.round(
        referenceFiles.reduce(
          (total, reference) => total + (uploadProgress[reference.id] ?? 0),
          0,
        ) / referenceFiles.length * 100,
      )
    : 0;

  useEffect(() => {
    const restoreTimer = window.setTimeout(() => {
      try {
        const stored = window.localStorage.getItem(LOCAL_DRAFT_KEY);
        if (stored) {
          const draft = JSON.parse(stored) as Partial<FormState>;
          const selectedUseCase = USE_CASES.includes(draft.selectedUseCase ?? "")
            ? draft.selectedUseCase ?? ""
            : "";
          const descriptions =
            draft.useCaseDescriptions && typeof draft.useCaseDescriptions === "object"
              ? draft.useCaseDescriptions
              : {};
          const referenceLinks = Array.isArray(draft.referenceLinks)
            ? draft.referenceLinks
                .filter((item): item is ReferenceLinkDraft => Boolean(
                  item && typeof item.title === "string" && typeof item.url === "string",
                ))
                .slice(0, REFERENCE_LIMITS.maxLinks)
                .map((item) => ({
                  id: item.id || crypto.randomUUID(),
                  title: item.title,
                  url: item.url,
                }))
            : [];
          setForm({
            plant: PLANTS.some((plant) => plant.id === draft.plant)
              ? String(draft.plant)
              : EMPTY_FORM.plant,
            submitterName: String(draft.submitterName ?? ""),
            submitterEmail: String(draft.submitterEmail ?? ""),
            designation: String(draft.designation ?? ""),
            selectedUseCase,
            useCaseDescriptions: descriptions,
            valueStreams: Array.isArray(draft.valueStreams)
              ? draft.valueStreams.filter((stream) => VALUE_STREAMS.includes(stream)).slice(0, 1)
              : [],
            expectedBenefits: String(draft.expectedBenefits ?? ""),
            referenceLinks,
          });
          onSaved("Your saved draft was restored on this device.");
        }
      } catch {
        window.localStorage.removeItem(LOCAL_DRAFT_KEY);
      } finally {
        setDraftReady(true);
      }
    }, 0);
    return () => window.clearTimeout(restoreTimer);
  }, [onSaved]);

  useEffect(() => {
    if (!draftReady) return;
    if (hasLocalDraftContent(form)) {
      window.localStorage.setItem(LOCAL_DRAFT_KEY, JSON.stringify(form));
    } else {
      window.localStorage.removeItem(LOCAL_DRAFT_KEY);
    }
  }, [draftReady, form]);

  const selectValueStream = (value: string) => {
    setForm((current) => ({
      ...current,
      valueStreams: [value],
    }));
  };

  const referenceFileInputs = (files: readonly ReferenceFileDraft[]) =>
    files.map((reference) => ({
      name: reference.file.name,
      size: reference.file.size,
      type: reference.file.type,
      title: reference.title,
    }));

  const addReferenceLink = () => {
    if (
      totalReferenceItems >= REFERENCE_LIMITS.maxItems ||
      form.referenceLinks.length >= REFERENCE_LIMITS.maxLinks
    ) return;
    setForm((current) => ({
      ...current,
      referenceLinks: [
        ...current.referenceLinks,
        { id: crypto.randomUUID(), title: "", url: "https://" },
      ],
    }));
  };

  const chooseReferenceFiles = (files: FileList | null) => {
    if (!files?.length) return;
    const available = Math.min(
      REFERENCE_LIMITS.maxFiles - referenceFiles.length,
      REFERENCE_LIMITS.maxItems - totalReferenceItems,
    );
    const additions = Array.from(files)
      .slice(0, Math.max(0, available))
      .map((file) => ({
        id: crypto.randomUUID(),
        title: defaultReferenceTitle(file.name),
        file,
      }));
    const nextFiles = [...referenceFiles, ...additions];
    const validation = validateReferenceSelection(
      referenceFileInputs(nextFiles),
      form.referenceLinks,
    );
    if (!validation.valid) {
      setErrors(validation.errors);
      return;
    }
    setErrors([]);
    setReferenceFiles(nextFiles);
    setUploadProgress({});
  };

  const validate = () => {
    const next: string[] = [];
    if (!form.submitterName.trim()) next.push("Add the leader’s name.");
    if (!/^\S+@\S+\.\S+$/.test(form.submitterEmail)) next.push("Add a valid email address.");
    if (!form.designation.trim()) next.push("Add the leader's designation or role.");
    if (!form.selectedUseCase) {
      next.push("Choose one use case.");
    } else if (!form.useCaseDescriptions[form.selectedUseCase]?.trim()) {
      next.push("Add a short description for the chosen use case.");
    }
    if (form.valueStreams.length !== 1) next.push("Select one value stream.");
    if (!form.expectedBenefits.trim()) next.push("Describe the expected benefits.");
    next.push(
      ...validateReferenceSelection(
        referenceFileInputs(referenceFiles),
        form.referenceLinks,
      ).errors,
    );
    setErrors(next);
    return next.length === 0;
  };

  const submit = async () => {
    if (!validate()) return;
    setIsSaving(true);
    setErrors([]);
    try {
      let mediaSession: ReferenceUploadSession | null = null;
      let uploadedReferences: ReferenceManifestInput[] = [];
      if (referenceFiles.length > 0) {
        setUploadMessage("Preparing secure reference uploads…");
        setUploadProgress(Object.fromEntries(
          referenceFiles.map((reference) => [reference.id, 0]),
        ));
        const activeSession = await createReferenceUploadSession();
        mediaSession = activeSession;
        uploadedReferences = await Promise.all(
          referenceFiles.map(async (reference, index) => {
            setUploadMessage(
              `Uploading ${referenceFiles.length} reference file${referenceFiles.length === 1 ? "" : "s"}…`,
            );
            const uploaded = await uploadReferenceFile(
              activeSession,
              reference.file,
              index + 1,
              (progress) => setUploadProgress((current) => ({
                ...current,
                [reference.id]: progress,
              })),
            );
            return {
              ...uploaded,
              title: reference.title.trim(),
              sortOrder: form.referenceLinks.length + index,
            };
          }),
        );
      }

      setUploadMessage("Saving the response for admin verification…");
      const linkReferences: ReferenceManifestInput[] = form.referenceLinks.map(
        (reference, index) => ({
          title: reference.title.trim(),
          kind: "link",
          externalUrl: reference.url.trim(),
          sortOrder: index,
        }),
      );
      const payload = await submitWorkshopResponse({
        plant: form.plant as AdminSubmissionUpdateInput["plant"],
        submitterName: form.submitterName,
        submitterEmail: form.submitterEmail,
        designation: form.designation,
        useCases: USE_CASES.map((id) =>
          id === form.selectedUseCase
            ? form.useCaseDescriptions[id]?.trim() ?? ""
            : "",
        ) as [string, string, string, string],
        valueStreams: [
          String(VALUE_STREAMS.indexOf(form.valueStreams[0]) + 1) as BrowserValueStream,
        ],
        expectedBenefits: form.expectedBenefits.trim(),
        references: [...linkReferences, ...uploadedReferences],
        mediaSession,
      });
      const reference = payload.submission?.referenceId ?? payload.submission?.id ?? "Saved";
      setSavedReference(reference);
      setLastSubmittedAt(payload.submission?.submittedAt ?? new Date().toISOString());
      onSaved("Response submitted for verification. You can enter another response now.");
      window.localStorage.removeItem(LOCAL_DRAFT_KEY);
      setForm(EMPTY_FORM);
      setReferenceFiles([]);
      setUploadProgress({});
      setFileInputKey((current) => current + 1);
    } catch (error) {
      setErrors([
        error instanceof Error && error.message
          ? error.message
          : "We could not save this response. Your entries are still on screen—please try again.",
      ]);
    } finally {
      setUploadMessage("");
      setIsSaving(false);
    }
  };

  const saveLocalDraft = () => {
    window.localStorage.setItem(LOCAL_DRAFT_KEY, JSON.stringify(form));
    setErrors([]);
    setSavedReference("");
    setLastSubmittedAt(null);
    onSaved(
      referenceFiles.length
        ? "Draft text and links saved. Selected files remain attached only while this tab stays open."
        : "Draft saved on this device.",
    );
  };

  const submitForm = (event: FormEvent) => {
    event.preventDefault();
    void submit();
  };

  return (
    <section className="form-page">
      <div className="form-intro">
        <div>
          <p className="eyebrow">Leader response form</p>
          <h1>Bring your plant’s idea into the room.</h1>
        </div>
        <p>
          Capture the idea once. The workshop team can verify it, prepare it and
          place it into the presentation without retyping a word.
        </p>
      </div>

      <div className="form-layout">
        <aside className="form-context">
          <div
            className="selected-plant-image"
            style={{
              backgroundImage: `linear-gradient(180deg, rgba(23,14,28,.05), rgba(23,14,28,.83)), url("${active.image}")`,
              "--plant-accent": active.accent,
            } as React.CSSProperties}
          >
            <span>{active.number}</span>
            <div>
              <strong>{active.name}</strong>
              <small>{active.location}</small>
            </div>
          </div>
          <div className="completion-card">
            <div>
              <span>Response completeness</span>
              <strong>{percent}%</strong>
            </div>
            <div className="progress-track"><i style={{ width: `${percent}%` }} /></div>
            <p>Your draft may be incomplete. Submission checks every required field.</p>
          </div>
          <div className="safe-note">
            <span aria-hidden="true">✓</span>
            <p><strong>Nothing is published directly.</strong><br />Every response passes through admin verification first.</p>
          </div>
        </aside>

        <form className="response-form" onSubmit={submitForm}>
          {notice && (
            <div className="form-success" role="status">
              {notice}
              {savedReference && ` Reference: ${savedReference}.`}
              {lastSubmittedAt && ` Submitted: ${formatDateTime(lastSubmittedAt)}.`}
            </div>
          )}
          {errors.length > 0 && (
            <div className="form-errors" role="alert">
              <strong>Please complete the response</strong>
              <ul>{errors.map((error) => <li key={error}>{error}</li>)}</ul>
            </div>
          )}

          <fieldset className="form-section">
            <legend><span>01</span><div>Plant Name<small>Select the plant this response belongs to.</small></div></legend>
            <div className="plant-options">
              {PLANTS.map((plant) => (
                <label className={form.plant === plant.id ? "selected" : ""} key={plant.id}>
                  <input
                    type="radio"
                    name="plant"
                    value={plant.id}
                    checked={form.plant === plant.id}
                    onChange={() => setForm((current) => ({ ...current, plant: plant.id }))}
                  />
                  <span>{plant.name}<small>{plant.location}</small></span>
                  <i style={{ background: plant.accent }} />
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="form-section">
            <legend><span>02</span><div>Response owner<small>Used for verification and follow-up.</small></div></legend>
            <div className="two-fields">
              <label>
                <span>Leader name</span>
                <input
                  value={form.submitterName}
                  onChange={(event) => setForm((current) => ({ ...current, submitterName: event.target.value }))}
                  placeholder="Full name"
                  autoComplete="name"
                />
              </label>
              <label>
                <span>Work email</span>
                <input
                  type="email"
                  value={form.submitterEmail}
                  onChange={(event) => setForm((current) => ({ ...current, submitterEmail: event.target.value }))}
                  placeholder="name@company.com"
                  inputMode="email"
                  autoComplete="email"
                />
              </label>
              <label>
                <span>Designation / role</span>
                <input
                  value={form.designation}
                  onChange={(event) => setForm((current) => ({ ...current, designation: event.target.value }))}
                  placeholder="Plant Head, Operations Lead, etc."
                  autoComplete="organization-title"
                  maxLength={160}
                />
              </label>
              <label>
                <span>Submission date / time</span>
                <input value="Recorded automatically on submission" readOnly />
              </label>
            </div>
          </fieldset>

          <fieldset className="form-section">
            <legend><span>03</span><div>Use Case<small>Choose one fixed use case and add a short description.</small></div></legend>
            <div className="choice-stack">
              {USE_CASES.map((useCase, index) => {
                const selected = form.selectedUseCase === useCase;
                return (
                  <div className={`expand-choice ${selected ? "selected" : ""}`} key={useCase}>
                    <label className="choice-heading">
                      <input
                        type="radio"
                        name="useCase"
                        checked={selected}
                        onChange={() =>
                          setForm((current) => ({
                            ...current,
                            selectedUseCase: useCase,
                          }))
                        }
                      />
                      <span className="check-box">{selected ? "✓" : ""}</span>
                      <span className="choice-index">0{index + 1}</span>
                      <strong>{useCase}</strong>
                      <small>{selected ? "Selected" : "Choose"}</small>
                    </label>
                    {selected && (
                      <label className="description-field">
                        <span>Description for {useCase}</span>
                        <textarea
                          value={form.useCaseDescriptions[useCase] ?? ""}
                          onChange={(event) => setForm((current) => ({
                            ...current,
                            useCaseDescriptions: { ...current.useCaseDescriptions, [useCase]: event.target.value },
                          }))}
                          placeholder="Describe the opportunity, intervention or idea in a few clear sentences…"
                          maxLength={300}
                          rows={3}
                        />
                        <small>{form.useCaseDescriptions[useCase]?.length ?? 0}/300</small>
                      </label>
                    )}
                  </div>
                );
              })}
            </div>
          </fieldset>

          <fieldset className="form-section">
            <legend><span>04</span><div>Value Stream<small>Select the one manufacturing aspect this response will help.</small></div></legend>
            <div className="stream-options">
              {VALUE_STREAMS.map((stream, index) => {
                const selected = form.valueStreams.includes(stream);
                return (
                  <label className={selected ? "selected" : ""} key={stream}>
                    <input
                      type="radio"
                      name="valueStream"
                      checked={selected}
                      onChange={() => selectValueStream(stream)}
                    />
                    <span>0{index + 1}</span>
                    <strong>{stream}</strong>
                    <i>✓</i>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <fieldset className="form-section">
            <legend><span>05</span><div>Expected Benefits<small>Describe the expected operational or business benefit.</small></div></legend>
            <label className="benefit-field">
              <textarea
                value={form.expectedBenefits}
                onChange={(event) => setForm((current) => ({ ...current, expectedBenefits: event.target.value }))}
                placeholder="What becomes better if this idea succeeds? Consider quality, speed, cost, safety, reliability or customer value…"
                maxLength={1200}
                rows={8}
              />
              <small>{form.expectedBenefits.length}/1200</small>
            </label>
          </fieldset>

          <fieldset className="form-section">
            <legend>
              <span>06</span>
              <div>
                Reference media
                <small>Optional supporting links and files for the workshop discussion.</small>
              </div>
            </legend>
            <div className="reference-builder">
              <div className="reference-builder-intro">
                <p>
                  <strong>{totalReferenceItems} of {REFERENCE_LIMITS.maxItems} references added.</strong>{" "}
                  Add up to {REFERENCE_LIMITS.maxFiles} files and {REFERENCE_LIMITS.maxLinks} HTTPS links.
                  Files may be PDF, PPTX, DOCX, XLSX, JPG, PNG or WebP; each file is limited to {formatReferenceSize(REFERENCE_LIMITS.maxFileBytes)} and all files together to {formatReferenceSize(REFERENCE_LIMITS.maxTotalFileBytes)}.
                </p>
                <div className="reference-builder-actions">
                  <label
                    className={`reference-upload-control${
                      isSaving ||
                      referenceFiles.length >= REFERENCE_LIMITS.maxFiles ||
                      totalReferenceItems >= REFERENCE_LIMITS.maxItems
                        ? " disabled"
                        : ""
                    }`}
                  >
                    <input
                      key={fileInputKey}
                      type="file"
                      accept={REFERENCE_FILE_ACCEPT}
                      multiple
                      disabled={
                        isSaving ||
                        referenceFiles.length >= REFERENCE_LIMITS.maxFiles ||
                        totalReferenceItems >= REFERENCE_LIMITS.maxItems
                      }
                      onChange={(event) => {
                        chooseReferenceFiles(event.currentTarget.files);
                        event.currentTarget.value = "";
                      }}
                    />
                    + Add files
                  </label>
                  <button
                    className="reference-add-link"
                    type="button"
                    disabled={
                      isSaving ||
                      form.referenceLinks.length >= REFERENCE_LIMITS.maxLinks ||
                      totalReferenceItems >= REFERENCE_LIMITS.maxItems
                    }
                    onClick={addReferenceLink}
                  >
                    + Add HTTPS link
                  </button>
                </div>
              </div>

              {(form.referenceLinks.length > 0 || referenceFiles.length > 0) && (
                <div className="reference-draft-list">
                  {form.referenceLinks.map((reference) => (
                    <article className="reference-draft-item" key={reference.id}>
                      <span className="reference-draft-icon" aria-hidden="true">URL</span>
                      <div className="reference-draft-fields">
                        <label>
                          <span>Display title</span>
                          <input
                            value={reference.title}
                            maxLength={REFERENCE_LIMITS.maxTitleLength}
                            placeholder="What should the workshop see?"
                            onChange={(event) => setForm((current) => ({
                              ...current,
                              referenceLinks: current.referenceLinks.map((item) =>
                                item.id === reference.id
                                  ? { ...item, title: event.target.value }
                                  : item,
                              ),
                            }))}
                          />
                        </label>
                        <label>
                          <span>HTTPS link</span>
                          <input
                            type="url"
                            value={reference.url}
                            maxLength={REFERENCE_LIMITS.maxUrlLength}
                            placeholder="https://…"
                            onChange={(event) => setForm((current) => ({
                              ...current,
                              referenceLinks: current.referenceLinks.map((item) =>
                                item.id === reference.id
                                  ? { ...item, url: event.target.value }
                                  : item,
                              ),
                            }))}
                          />
                        </label>
                        <small className="reference-draft-meta">Web link · opens in a new tab</small>
                      </div>
                      <button
                        className="reference-remove"
                        type="button"
                        aria-label={`Remove ${reference.title || "web link"}`}
                        disabled={isSaving}
                        onClick={() => setForm((current) => ({
                          ...current,
                          referenceLinks: current.referenceLinks.filter((item) => item.id !== reference.id),
                        }))}
                      >
                        ×
                      </button>
                    </article>
                  ))}

                  {referenceFiles.map((reference) => {
                    const classification = classifyReferenceFile(reference.file);
                    return (
                      <article className="reference-draft-item" key={reference.id}>
                        <span className="reference-draft-icon" aria-hidden="true">
                          {classification ? referenceBadge(classification.kind) : "FILE"}
                        </span>
                        <div className="reference-draft-fields">
                          <label>
                            <span>Display title</span>
                            <input
                              value={reference.title}
                              maxLength={REFERENCE_LIMITS.maxTitleLength}
                              onChange={(event) => setReferenceFiles((current) =>
                                current.map((item) => item.id === reference.id
                                  ? { ...item, title: event.target.value }
                                  : item),
                              )}
                            />
                          </label>
                          <div>
                            <span>Selected file</span>
                            <strong>{reference.file.name}</strong>
                            <small className="reference-draft-meta">
                              {classification ? referenceKindLabel(classification.kind) : "File"} · {formatReferenceSize(reference.file.size)} · reattach after reopening a saved draft
                            </small>
                          </div>
                        </div>
                        <button
                          className="reference-remove"
                          type="button"
                          aria-label={`Remove ${reference.file.name}`}
                          disabled={isSaving}
                          onClick={() => {
                            setReferenceFiles((current) => current.filter((item) => item.id !== reference.id));
                            setUploadProgress({});
                          }}
                        >
                          ×
                        </button>
                      </article>
                    );
                  })}
                </div>
              )}

              {uploadMessage && referenceFiles.length > 0 && (
                <div className="upload-progress" role="status" aria-live="polite">
                  <div><span>{uploadMessage}</span><strong>{aggregateUploadProgress}%</strong></div>
                  <span className="upload-progress-track"><i style={{ width: `${aggregateUploadProgress}%` }} /></span>
                </div>
              )}
            </div>
          </fieldset>

          <div className="form-actions">
            <div><span>Local draft</span><small>Saved only on this device until submitted</small></div>
            <button className="secondary-action" type="button" onClick={saveLocalDraft} disabled={isSaving}>Save draft</button>
            <button className="primary-action" type="submit" disabled={isSaving}>{isSaving ? "Saving…" : "Submit for verification"} <span>↗</span></button>
          </div>
        </form>
      </div>
    </section>
  );
}

function AdminReferenceCard({
  reference,
  capability,
  onSaved,
}: {
  reference: BrowserReferenceMedia;
  capability: string | null;
  onSaved: (message: string) => Promise<void>;
}) {
  const [title, setTitle] = useState(reference.title);
  const [externalUrl, setExternalUrl] = useState(reference.externalUrl ?? "");
  const [isVisible, setIsVisible] = useState(reference.isVisible);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!capability) return;
    if (reference.kind === "link") {
      const validation = validateReferenceSelection([], [{ title, url: externalUrl }]);
      if (!validation.valid) {
        setError(validation.errors[0] ?? "Check this reference link.");
        return;
      }
    } else if (!title.trim()) {
      setError("Reference title is required.");
      return;
    }

    setIsSaving(true);
    setError("");
    try {
      await updateAdminReference(capability, {
        id: reference.id,
        title: title.trim(),
        externalUrl: reference.kind === "link" ? externalUrl.trim() : null,
        isVisible,
      });
      announceSubmissionChange();
      await onSaved("Reference media updated.");
    } catch (updateError) {
      setError(
        updateError instanceof Error && updateError.message
          ? updateError.message
          : "This reference could not be updated.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <article className="admin-reference-card">
      <div className="admin-reference-heading">
        <span>{referenceMeta(reference)}</span>
        {reference.openUrl && (
          <a href={reference.openUrl} target="_blank" rel="noopener noreferrer">
            Open reference ↗
          </a>
        )}
      </div>
      <form className="admin-reference-form" onSubmit={save}>
        <label>
          <span>Display title</span>
          <input
            type="text"
            value={title}
            maxLength={REFERENCE_LIMITS.maxTitleLength}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        {reference.kind === "link" && (
          <label className="reference-url-field">
            <span>HTTPS URL</span>
            <input
              type="url"
              value={externalUrl}
              maxLength={REFERENCE_LIMITS.maxUrlLength}
              onChange={(event) => setExternalUrl(event.target.value)}
            />
          </label>
        )}
        <label className="reference-visibility">
          <input
            type="checkbox"
            checked={isVisible}
            onChange={(event) => setIsVisible(event.target.checked)}
          />
          Include with the approved response
        </label>
        <button type="submit" disabled={isSaving || !capability}>
          {isSaving ? "Saving…" : "Save reference"}
        </button>
        {error && <small className="reference-draft-meta" role="alert">{error}</small>}
      </form>
    </article>
  );
}

function ReviewView({
  submissions,
  isLoading,
  notice,
  capability,
  onChanged,
}: {
  submissions: Submission[];
  isLoading: boolean;
  notice: string;
  capability: string | null;
  onChanged: (message: string) => Promise<void>;
}) {
  const [filter, setFilter] = useState<"all" | Status>("submitted");
  const [selectedId, setSelectedId] = useState("");
  const [isUpdating, setIsUpdating] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState<AdminEditState | null>(null);

  const filtered = submissions.filter((item) => {
    if (filter === "all") return true;
    return item.status === filter;
  });
  const selected = submissions.find((item) => item.id === selectedId) ?? filtered[0] ?? null;

  const update = async (changes: SubmissionPatch, message: string) => {
    if (!selected || !capability) return;
    setIsUpdating(true);
    try {
      const useCases = (changes.useCases ?? USE_CASES.map((id) =>
        selected.useCases.find((item) => item.id === id)?.description ?? "",
      )) as [string, string, string, string];
      const selectedStreams = changes.valueStreams ?? selected.valueStreams;
      const stream = selectedStreams[0] ?? "";
      const valueStream = (/^[1-4]$/.test(stream)
        ? stream
        : String(VALUE_STREAMS.indexOf(stream) + 1)) as BrowserValueStream;

      await updateAdminSubmission(capability, {
        id: selected.id,
        expectedUpdatedAt: selected.updatedAt,
        plant: (changes.plant ?? selected.plant) as AdminSubmissionUpdateInput["plant"],
        submitterName: changes.submitterName ?? selected.submitterName,
        submitterEmail: changes.submitterEmail ?? selected.submitterEmail,
        designation: changes.designation ?? selected.designation,
        useCases,
        valueStreams: [valueStream],
        expectedBenefits: changes.expectedBenefits ?? selected.expectedBenefits,
        status: changes.status ?? selected.status,
      });
      announceSubmissionChange();
      setIsEditing(false);
      await onChanged(message);
    } catch {
      await onChanged("The response could not be updated. Please try again.");
    } finally {
      setIsUpdating(false);
    }
  };

  const saveEdits = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected || !editForm) return;
    const valueStreamIndex = VALUE_STREAMS.indexOf(editForm.valueStream);
    await update(
      {
        plant: editForm.plant,
        submitterName: editForm.submitterName,
        submitterEmail: editForm.submitterEmail,
        designation: editForm.designation,
        useCases: USE_CASES.map((useCase) =>
          useCase === editForm.selectedUseCase
            ? editForm.useCaseDescription.trim()
            : "",
        ),
        valueStreams:
          valueStreamIndex >= 0 ? [String(valueStreamIndex + 1)] : [],
        expectedBenefits: editForm.expectedBenefits,
      },
      "Response details updated.",
    );
  };

  const counts = {
    submitted: submissions.filter((item) => item.status === "submitted").length,
    approved: submissions.filter((item) => item.status === "approved").length,
    rejected: submissions.filter((item) => item.status === "rejected").length,
  };

  return (
    <section className="review-page">
      <div className="review-intro">
        <div>
          <p className="eyebrow">Admin verification desk</p>
          <h1>Only presentation-ready ideas make the room.</h1>
        </div>
        <div className="review-metrics">
          <div><strong>{counts.submitted}</strong><span>Awaiting review</span></div>
          <div><strong>{counts.approved}</strong><span>Approved</span></div>
          <div><strong>{counts.rejected}</strong><span>Needs changes</span></div>
        </div>
      </div>
      {notice && <div className="review-notice" role="status">{notice}</div>}

      <div className="review-filters" aria-label="Filter responses">
        {[
          ["submitted", "Submitted"],
          ["rejected", "Needs changes"],
          ["approved", "Approved"],
          ["all", "All responses"],
        ].map(([id, label]) => (
          <button type="button" aria-pressed={filter === id} className={filter === id ? "active" : ""} key={id} onClick={() => {
            setFilter(id as typeof filter);
            setIsEditing(false);
            setEditForm(null);
          }}>
            {label}
          </button>
        ))}
      </div>

      <div className="review-layout">
        <div className="review-queue">
          <div className="queue-heading"><span>{filtered.length} responses</span><button type="button">Newest first ↓</button></div>
          {isLoading ? (
            <div className="queue-empty">Loading responses…</div>
          ) : filtered.length === 0 ? (
            <div className="queue-empty"><span>✓</span><strong>This queue is clear.</strong><small>Responses will appear here when their status changes.</small></div>
          ) : filtered.map((item) => {
            const plant = getPlant(item.plant);
            return (
              <button className={`queue-item ${selected?.id === item.id ? "active" : ""}`} key={item.id} type="button" onClick={() => {
                setSelectedId(item.id);
                setIsEditing(false);
                setEditForm(null);
              }}>
                <span className="queue-accent" style={{ background: plant.accent }} />
                <span className="queue-content">
                  <span><strong>{plant.name}</strong><small>{formatDate(item.updatedAt)}</small></span>
                  <b>{item.submitterName || "Unnamed leader"}</b>
                  <span className="queue-meta"><i className={`status-${item.status}`} />{statusLabel(item.status)} · {chosenUseCase(item)?.id ?? "No use case"}</span>
                </span>
                <span className="queue-arrow">→</span>
              </button>
            );
          })}
        </div>

        <div className="review-detail">
          {selected ? (
            <>
              <div className="detail-heading">
                <div>
                  <p className="eyebrow">{selected.referenceId ?? `Response ${selected.id.slice(0, 8).toUpperCase()}`}</p>
                  <h2>{getPlant(selected.plant).name}</h2>
                  <span>
                    {getPlant(selected.plant).location} · Submitted by {selected.submitterName}
                    {selected.designation ? `, ${selected.designation}` : ""}
                    <br />
                    {formatDateTime(selected.submittedAt)}
                  </span>
                </div>
                <span className={`detail-status status-${selected.status}`}>{statusLabel(selected.status)}</span>
                <button
                  className="secondary-action"
                  type="button"
                  disabled={isUpdating}
                  onClick={() => {
                    setEditForm(adminEditState(selected));
                    setIsEditing((current) => !current);
                  }}
                >
                  {isEditing ? "Close editor" : "Edit response"}
                </button>
              </div>

              {isEditing && editForm && (
                <form className="response-form" onSubmit={saveEdits}>
                  <fieldset className="form-section">
                    <legend><span>01</span><div>Owner and plant<small>Edit the submitted response directly.</small></div></legend>
                    <div className="two-fields">
                      <label>
                        <span>Leader name</span>
                        <input
                          value={editForm.submitterName}
                          onChange={(event) => setEditForm((current) => current ? ({ ...current, submitterName: event.target.value }) : current)}
                          required
                        />
                      </label>
                      <label>
                        <span>Work email</span>
                        <input
                          type="email"
                          value={editForm.submitterEmail}
                          onChange={(event) => setEditForm((current) => current ? ({ ...current, submitterEmail: event.target.value }) : current)}
                          required
                        />
                      </label>
                      <label>
                        <span>Designation / role</span>
                        <input
                          value={editForm.designation}
                          onChange={(event) => setEditForm((current) => current ? ({ ...current, designation: event.target.value }) : current)}
                          required
                        />
                      </label>
                      <label>
                        <span>Plant</span>
                        <select
                          value={editForm.plant}
                          onChange={(event) => setEditForm((current) => current ? ({ ...current, plant: event.target.value }) : current)}
                        >
                          {PLANTS.map((plant) => <option key={plant.id} value={plant.id}>{plant.name}</option>)}
                        </select>
                      </label>
                    </div>
                  </fieldset>

                  <fieldset className="form-section">
                    <legend><span>02</span><div>Use case and value stream<small>Exactly one of each is required.</small></div></legend>
                    <div className="two-fields">
                      <label>
                        <span>Use case</span>
                        <select
                          value={editForm.selectedUseCase}
                          onChange={(event) => setEditForm((current) => current ? ({ ...current, selectedUseCase: event.target.value }) : current)}
                        >
                          {USE_CASES.map((useCase) => <option key={useCase} value={useCase}>{useCase}</option>)}
                        </select>
                      </label>
                      <label>
                        <span>Value stream</span>
                        <select
                          value={editForm.valueStream}
                          onChange={(event) => setEditForm((current) => current ? ({ ...current, valueStream: event.target.value }) : current)}
                        >
                          {VALUE_STREAMS.map((stream) => <option key={stream} value={stream}>{stream}</option>)}
                        </select>
                      </label>
                    </div>
                    <label className="description-field">
                      <span>Use-case description</span>
                      <textarea
                        value={editForm.useCaseDescription}
                        onChange={(event) => setEditForm((current) => current ? ({ ...current, useCaseDescription: event.target.value }) : current)}
                        rows={4}
                        required
                      />
                    </label>
                  </fieldset>

                  <fieldset className="form-section">
                    <legend><span>03</span><div>Expected benefits<small>Update the full presentation copy.</small></div></legend>
                    <label className="benefit-field">
                      <textarea
                        value={editForm.expectedBenefits}
                        onChange={(event) => setEditForm((current) => current ? ({ ...current, expectedBenefits: event.target.value }) : current)}
                        rows={8}
                        required
                      />
                    </label>
                  </fieldset>

                  <div className="form-actions">
                    <div><span>Submitted</span><small>{formatDateTime(selected.submittedAt)}</small></div>
                    <button className="secondary-action" type="button" onClick={() => setIsEditing(false)} disabled={isUpdating}>Cancel</button>
                    <button className="primary-action" type="submit" disabled={isUpdating}>{isUpdating ? "Saving..." : "Save edits"}</button>
                  </div>
                </form>
              )}

              <div className="detail-section">
                <div className="detail-label"><span>01</span><strong>Use Case</strong></div>
                <div className="detail-use-cases">
                  {selected.useCases.map((item, index) => (
                    <article key={`${item.id}-${index}`}><span>0{index + 1}</span><div><strong>{item.id}</strong><p>{item.description}</p></div></article>
                  ))}
                </div>
              </div>

              <div className="detail-section detail-columns">
                <div>
                  <div className="detail-label"><span>02</span><strong>Value Stream</strong></div>
                  <div className="detail-streams">{selected.valueStreams.map((stream) => <span key={stream}>{stream}</span>)}</div>
                </div>
                <div>
                  <div className="detail-label"><span>03</span><strong>Expected Benefits</strong></div>
                  <p className="detail-benefits">{selected.expectedBenefits}</p>
                </div>
              </div>

              {selected.references.length > 0 && (
                <div className="detail-section">
                  <div className="detail-label"><span>04</span><strong>Reference media</strong></div>
                  <div className="admin-reference-list">
                    {selected.references.map((reference) => (
                      <AdminReferenceCard
                        key={`${reference.id}-${reference.title}-${reference.externalUrl ?? ""}-${reference.isVisible}`}
                        reference={reference}
                        capability={capability}
                        onSaved={onChanged}
                      />
                    ))}
                  </div>
                </div>
              )}

              <div className="verification-bar">
                <div>
                  <span>Verification controls</span>
                  <small>Approved responses appear in the presentation automatically.</small>
                </div>
                <button
                  className="request-action"
                  type="button"
                  disabled={isUpdating || selected.status === "rejected"}
                  onClick={() => void update(
                    { status: "rejected", isVisible: false },
                    "Response rejected and removed from the presentation.",
                  )}
                >
                  Reject response
                </button>
                <button
                  className="approve-action"
                  type="button"
                  disabled={isUpdating || selected.status === "approved"}
                  onClick={() => void update(
                    { status: "approved", isVisible: true },
                    "Response approved and included in the presentation.",
                  )}
                >
                  Approve response
                </button>
              </div>
            </>
          ) : (
            <div className="detail-empty"><span>03</span><h2>Select a response to verify.</h2><p>The full submission and all publishing controls will appear here.</p></div>
          )}
        </div>
      </div>
    </section>
  );
}
