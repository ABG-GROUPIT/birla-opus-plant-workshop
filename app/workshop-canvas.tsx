"use client";

import {
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

type View = "present" | "submit" | "review";
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
  useCases: Array<{ id: string; description: string }>;
  valueStreams: string[];
  expectedBenefits: string;
  status: Status;
  isVisible: boolean;
  createdAt: string;
  updatedAt: string;
  referenceId?: string;
};

type FormState = {
  plant: string;
  submitterName: string;
  submitterEmail: string;
  useCaseDescriptions: Record<string, string>;
  valueStreams: string[];
  expectedBenefits: string;
};

const PLANTS: Plant[] = [
  {
    id: "Panipat",
    name: "Panipat",
    location: "Haryana",
    number: "01",
    accent: "#F36A36",
    image: "/plants/panipat.jpg",
  },
  {
    id: "Ludhiana",
    name: "Ludhiana",
    location: "Punjab",
    number: "02",
    accent: "#D12D73",
    image: "/plants/ludhiana.jpg",
  },
  {
    id: "Cheyyar",
    name: "Cheyyar",
    location: "Tamil Nadu",
    number: "03",
    accent: "#DB5737",
    image: "/plants/cheyyar.jpg",
  },
  {
    id: "Chamarajanagar",
    name: "Chamarajanagar",
    location: "Karnataka",
    number: "04",
    accent: "#13969B",
    image: "/plants/chamarajanagar.jpg",
  },
  {
    id: "Mahad",
    name: "Mahad",
    location: "Maharashtra",
    number: "05",
    accent: "#7152A3",
    image: "/plants/mahad.jpg",
  },
  {
    id: "Kharagpur",
    name: "Kharagpur",
    location: "West Bengal",
    number: "06",
    accent: "#EAA529",
    image: "/plants/kharagpur.jpg",
  },
];

const USE_CASES = ["Use Case 1", "Use Case 2", "Use Case 3", "Use Case 4"];
const VALUE_STREAMS = [
  "Value Stream 1",
  "Value Stream 2",
  "Value Stream 3",
  "Value Stream 4",
];

const EMPTY_FORM: FormState = {
  plant: "Panipat",
  submitterName: "",
  submitterEmail: "",
  useCaseDescriptions: {},
  valueStreams: [],
  expectedBenefits: "",
};

const NAV_ITEMS: Array<{ id: View; label: string; eyebrow: string }> = [
  { id: "present", label: "Present", eyebrow: "Workshop view" },
  { id: "submit", label: "Respond", eyebrow: "Leader form" },
  { id: "review", label: "Review", eyebrow: "Admin desk" },
];

function normaliseSubmission(value: Partial<Submission>): Submission {
  const rawUseCases = Array.isArray(value.useCases) ? value.useCases : [];
  return {
    id: String(value.id ?? crypto.randomUUID()),
    referenceId: value.referenceId,
    plant: String(value.plant ?? "Panipat"),
    submitterName: String(value.submitterName ?? "Workshop leader"),
    submitterEmail: String(value.submitterEmail ?? ""),
    useCases: rawUseCases.map((item, index) => {
      if (typeof item === "string") {
        return { id: USE_CASES[index] ?? `Use Case ${index + 1}`, description: item };
      }
      return {
        id: String(item?.id ?? USE_CASES[index] ?? `Use Case ${index + 1}`),
        description: String(item?.description ?? ""),
      };
    }),
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

function statusLabel(status: Status) {
  if (status === "rejected") return "Needs changes";
  if (status === "submitted") return "Submitted";
  if (status === "approved") return "Approved";
  return "Draft";
}

function getPlant(id: string) {
  return PLANTS.find((plant) => plant.id === id) ?? PLANTS[0];
}

function completion(form: FormState) {
  const checks = [
    Boolean(form.plant),
    Boolean(form.submitterName.trim()),
    Boolean(form.submitterEmail.trim()),
    USE_CASES.every((id) => form.useCaseDescriptions[id]?.trim()),
    form.valueStreams.length > 0,
    Boolean(form.expectedBenefits.trim()),
  ];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}

export function WorkshopCanvas() {
  const [view, setView] = useState<View>("present");
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [activePlant, setActivePlant] = useState<string | null>(null);
  const [responseIndex, setResponseIndex] = useState(0);

  const loadSubmissions = useCallback(async (mode: View) => {
    setIsLoading(true);
    try {
      const endpoint =
        mode === "present"
          ? "/api/submissions?presentation=true"
          : "/api/submissions";
      const response = await fetch(endpoint, { cache: "no-store" });
      if (!response.ok) throw new Error("Unable to load responses");
      setSubmissions(apiRows(await response.json()));
    } catch {
      setNotice("Responses will appear here once the data service is available.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (view !== "submit") void loadSubmissions(view);
  }, [loadSubmissions, view]);

  const switchView = (next: View) => {
    setView(next);
    setNotice("");
    if (next !== "present") setActivePlant(null);
  };

  return (
    <main className={`app-shell view-${view}`}>
      <Header view={view} onViewChange={switchView} />
      {view === "present" && (
        <PresentationView
          submissions={submissions}
          isLoading={isLoading}
          notice={notice}
          activePlant={activePlant}
          responseIndex={responseIndex}
          onPlantChange={(plant) => {
            setActivePlant(plant);
            setResponseIndex(0);
          }}
          onResponseChange={setResponseIndex}
          onExit={() => {
            setActivePlant(null);
            setResponseIndex(0);
          }}
        />
      )}
      {view === "submit" && (
        <SubmissionView
          onSaved={(message) => {
            setNotice(message);
            void loadSubmissions("review");
          }}
          notice={notice}
        />
      )}
      {view === "review" && (
        <ReviewView
          submissions={submissions}
          isLoading={isLoading}
          notice={notice}
          onChanged={async (message) => {
            setNotice(message);
            await loadSubmissions("review");
          }}
        />
      )}
    </main>
  );
}

function Header({
  view,
  onViewChange,
}: {
  view: View;
  onViewChange: (view: View) => void;
}) {
  return (
    <header className="site-header">
      <button className="brand" type="button" onClick={() => onViewChange("present")}>
        <span className="brand-mark" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span>
          <strong>Birla Opus</strong>
          <small>Plant Workshop Canvas</small>
        </span>
      </button>
      <nav className="main-nav" aria-label="Primary navigation">
        {NAV_ITEMS.map((item) => (
          <button
            className={view === item.id ? "active" : ""}
            key={item.id}
            onClick={() => onViewChange(item.id)}
            type="button"
          >
            <small>{item.eyebrow}</small>
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
      <div className="header-note">
        <span className="live-dot" />
        Workshop ready
      </div>
    </header>
  );
}

function PresentationView({
  submissions,
  isLoading,
  notice,
  activePlant,
  responseIndex,
  onPlantChange,
  onResponseChange,
  onExit,
}: {
  submissions: Submission[];
  isLoading: boolean;
  notice: string;
  activePlant: string | null;
  responseIndex: number;
  onPlantChange: (plant: string) => void;
  onResponseChange: (index: number) => void;
  onExit: () => void;
}) {
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

  const plantResponses = activePlant
    ? published.filter((item) => item.plant === activePlant)
    : [];

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
      if (event.key === "Escape") onExit();
      if (event.key === "ArrowLeft") moveResponse(-1);
      if (event.key === "ArrowRight") moveResponse(1);
      if (event.key === "ArrowUp") movePlant(-1);
      if (event.key === "ArrowDown") movePlant(1);
      if (event.key.toLowerCase() === "f") void document.documentElement.requestFullscreen?.();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [activePlant, movePlant, moveResponse, onExit]);

  if (!activePlant) {
    return (
      <section className="presentation-index">
        <div className="presentation-intro">
          <div>
            <p className="eyebrow light">Presentation mode · Six plants</p>
            <h1>One workshop.<br />Six points of view.</h1>
          </div>
          <div className="intro-copy">
            <p>
              Select a plant to open its approved workshop responses. Everything on
              this screen is ready for the room.
            </p>
            <span>{published.length} responses included</span>
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
          <span>Choose any plant to begin · <a href="/credits">Photo credits</a></span>
        </div>
      </section>
    );
  }

  const plant = getPlant(activePlant);
  const response = plantResponses[responseIndex] ?? null;

  return (
    <section className="plant-presentation" style={{ "--plant-accent": plant.accent } as React.CSSProperties}>
      <div
        className="plant-hero"
        style={{
          backgroundImage: `linear-gradient(90deg, rgba(18,12,23,.88) 0%, rgba(18,12,23,.3) 68%, rgba(18,12,23,.7) 100%), url("${plant.image}")`,
        }}
      >
        <button className="back-link" type="button" onClick={onExit}>← All plants</button>
        <div className="plant-hero-copy">
          <p className="eyebrow light">Plant {plant.number} · {plant.location}</p>
          <h1>{plant.name}</h1>
          <div className="response-meta">
            <span>
              {plantResponses.length
                ? `Response ${String(responseIndex + 1).padStart(2, "0")} of ${String(plantResponses.length).padStart(2, "0")}`
                : "No response published"}
            </span>
            {response && <span>Submitted by {response.submitterName}</span>}
          </div>
        </div>
        <div className="hero-controls">
          <button type="button" onClick={() => movePlant(-1)} aria-label="Previous plant">↑</button>
          <button type="button" onClick={() => movePlant(1)} aria-label="Next plant">↓</button>
          <button
            type="button"
            onClick={() => void document.documentElement.requestFullscreen?.()}
            aria-label="Enter full screen"
          >
            ⛶
          </button>
        </div>
      </div>

      <div className="response-stage">
        {response ? (
          <>
            <div className="use-case-panel">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Workshop response</p>
                  <h2>Use cases</h2>
                </div>
                <span>{response.useCases.length} selected</span>
              </div>
              <div className="use-case-grid">
                {response.useCases.map((item, index) => (
                  <article className="use-case-card" key={`${item.id}-${index}`}>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <h3>{item.id}</h3>
                    <p>{item.description}</p>
                  </article>
                ))}
              </div>
            </div>

            <aside className="benefit-panel">
              <div>
                <p className="eyebrow light">Manufacturing aspect</p>
                <h2>Value streams</h2>
                <div className="stream-list">
                  {response.valueStreams.map((stream) => <span key={stream}>{stream}</span>)}
                </div>
              </div>
              <div className="benefit-copy">
                <span className="benefit-mark" aria-hidden="true">＋</span>
                <p className="eyebrow light">Expected benefits</p>
                <blockquote>{response.expectedBenefits}</blockquote>
              </div>
            </aside>
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
        <div className="response-dots" aria-label="Response position">
          {plantResponses.map((item, index) => (
            <button
              type="button"
              key={item.id}
              className={index === responseIndex ? "active" : ""}
              onClick={() => onResponseChange(index)}
              aria-label={`Open response ${index + 1}`}
            />
          ))}
        </div>
        <button type="button" onClick={() => moveResponse(1)} disabled={plantResponses.length < 2}>Next response →</button>
      </div>
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
  const active = getPlant(form.plant);
  const percent = completion(form);

  const toggleValueStream = (value: string) => {
    setForm((current) => ({
      ...current,
      valueStreams: current.valueStreams.includes(value)
        ? current.valueStreams.filter((item) => item !== value)
        : [...current.valueStreams, value],
    }));
  };

  const validate = () => {
    const next: string[] = [];
    if (!form.submitterName.trim()) next.push("Add the leader’s name.");
    if (!/^\S+@\S+\.\S+$/.test(form.submitterEmail)) next.push("Add a valid email address.");
    if (USE_CASES.some((id) => !form.useCaseDescriptions[id]?.trim())) {
      next.push("Describe all four use cases.");
    }
    if (!form.valueStreams.length) next.push("Select at least one value stream.");
    if (!form.expectedBenefits.trim()) next.push("Describe the expected benefits.");
    setErrors(next);
    return next.length === 0;
  };

  const save = async (action: "draft" | "submit") => {
    if (action === "submit" && !validate()) return;
    setIsSaving(true);
    setErrors([]);
    try {
      const response = await fetch("/api/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plant: form.plant,
          submitterName: form.submitterName,
          submitterEmail: form.submitterEmail,
          useCases: USE_CASES.map((id) => form.useCaseDescriptions[id]?.trim() ?? ""),
          valueStreams: form.valueStreams.map(
            (stream) => String(VALUE_STREAMS.indexOf(stream) + 1),
          ),
          expectedBenefits: form.expectedBenefits.trim(),
          action,
        }),
      });
      if (!response.ok) throw new Error("Save failed");
      const payload = (await response.json()) as { id?: string; referenceId?: string; submission?: { id?: string; referenceId?: string } };
      const reference = payload.referenceId ?? payload.submission?.referenceId ?? payload.id ?? payload.submission?.id ?? "Saved";
      setSavedReference(reference);
      onSaved(action === "draft" ? "Draft saved safely." : "Response submitted for verification.");
      if (action === "submit") setForm(EMPTY_FORM);
    } catch {
      setErrors(["We could not save this response. Your entries are still on screen—please try again."]);
    } finally {
      setIsSaving(false);
    }
  };

  const submitForm = (event: FormEvent) => {
    event.preventDefault();
    void save("submit");
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
          {notice && <div className="form-success" role="status">{notice}{savedReference && ` Reference: ${savedReference}`}</div>}
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
                  value={form.submitterEmail}
                  onChange={(event) => setForm((current) => ({ ...current, submitterEmail: event.target.value }))}
                  placeholder="name@company.com"
                  inputMode="email"
                  autoComplete="email"
                />
              </label>
            </div>
          </fieldset>

          <fieldset className="form-section">
            <legend><span>03</span><div>Use Cases<small>Briefly describe each fixed use case.</small></div></legend>
            <div className="choice-stack">
              {USE_CASES.map((useCase, index) => (
                  <div className="expand-choice selected" key={useCase}>
                    <div className="choice-heading">
                      <span className="check-box">✓</span>
                      <span className="choice-index">0{index + 1}</span>
                      <strong>{useCase}</strong>
                      <small>Fixed field</small>
                    </div>
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
                  </div>
              ))}
            </div>
          </fieldset>

          <fieldset className="form-section">
            <legend><span>04</span><div>Value Streams<small>Select all manufacturing aspects this response will help.</small></div></legend>
            <div className="stream-options">
              {VALUE_STREAMS.map((stream, index) => {
                const selected = form.valueStreams.includes(stream);
                return (
                  <label className={selected ? "selected" : ""} key={stream}>
                    <input type="checkbox" checked={selected} onChange={() => toggleValueStream(stream)} />
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
                maxLength={600}
                rows={6}
              />
              <small>{form.expectedBenefits.length}/600</small>
            </label>
          </fieldset>

          <div className="form-actions">
            <div><span>Secure draft</span><small>Last changes are kept on this response</small></div>
            <button className="secondary-action" type="button" onClick={() => void save("draft")} disabled={isSaving}>Save draft</button>
            <button className="primary-action" type="submit" disabled={isSaving}>{isSaving ? "Saving…" : "Submit for verification"} <span>↗</span></button>
          </div>
        </form>
      </div>
    </section>
  );
}

function ReviewView({
  submissions,
  isLoading,
  notice,
  onChanged,
}: {
  submissions: Submission[];
  isLoading: boolean;
  notice: string;
  onChanged: (message: string) => Promise<void>;
}) {
  const [filter, setFilter] = useState<"all" | Status | "live">("submitted");
  const [selectedId, setSelectedId] = useState("");
  const [isUpdating, setIsUpdating] = useState(false);

  const filtered = submissions.filter((item) => {
    if (filter === "all") return true;
    if (filter === "live") return item.status === "approved" && item.isVisible;
    return item.status === filter;
  });
  const selected = submissions.find((item) => item.id === selectedId) ?? filtered[0] ?? null;

  useEffect(() => {
    if (filtered.length && !filtered.some((item) => item.id === selectedId)) {
      setSelectedId(filtered[0].id);
    }
  }, [filtered, selectedId]);

  const update = async (changes: Partial<Pick<Submission, "status" | "isVisible">>, message: string) => {
    if (!selected) return;
    setIsUpdating(true);
    try {
      const response = await fetch(`/api/submissions/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(changes),
      });
      if (!response.ok) throw new Error("Update failed");
      await onChanged(message);
    } catch {
      await onChanged("The response could not be updated. Please try again.");
    } finally {
      setIsUpdating(false);
    }
  };

  const counts = {
    submitted: submissions.filter((item) => item.status === "submitted").length,
    approved: submissions.filter((item) => item.status === "approved").length,
    live: submissions.filter((item) => item.status === "approved" && item.isVisible).length,
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
          <div><strong>{counts.live}</strong><span>In presentation</span></div>
        </div>
      </div>
      {notice && <div className="review-notice" role="status">{notice}</div>}

      <div className="review-filters" role="tablist" aria-label="Filter responses">
        {[
          ["submitted", "Submitted"],
          ["rejected", "Needs changes"],
          ["approved", "Approved"],
          ["live", "In presentation"],
          ["all", "All responses"],
        ].map(([id, label]) => (
          <button type="button" role="tab" aria-selected={filter === id} className={filter === id ? "active" : ""} key={id} onClick={() => setFilter(id as typeof filter)}>
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
              <button className={`queue-item ${selected?.id === item.id ? "active" : ""}`} key={item.id} type="button" onClick={() => setSelectedId(item.id)}>
                <span className="queue-accent" style={{ background: plant.accent }} />
                <span className="queue-content">
                  <span><strong>{plant.name}</strong><small>{formatDate(item.updatedAt)}</small></span>
                  <b>{item.submitterName || "Unnamed leader"}</b>
                  <span className="queue-meta"><i className={`status-${item.status}`} />{statusLabel(item.status)} · {item.useCases.length} use cases</span>
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
                  <span>{getPlant(selected.plant).location} · Submitted by {selected.submitterName}</span>
                </div>
                <span className={`detail-status status-${selected.status}`}>{statusLabel(selected.status)}</span>
              </div>

              <div className="detail-section">
                <div className="detail-label"><span>01</span><strong>Use Cases</strong></div>
                <div className="detail-use-cases">
                  {selected.useCases.map((item, index) => (
                    <article key={`${item.id}-${index}`}><span>0{index + 1}</span><div><strong>{item.id}</strong><p>{item.description}</p></div></article>
                  ))}
                </div>
              </div>

              <div className="detail-section detail-columns">
                <div>
                  <div className="detail-label"><span>02</span><strong>Value Streams</strong></div>
                  <div className="detail-streams">{selected.valueStreams.map((stream) => <span key={stream}>{stream}</span>)}</div>
                </div>
                <div>
                  <div className="detail-label"><span>03</span><strong>Expected Benefits</strong></div>
                  <p className="detail-benefits">{selected.expectedBenefits}</p>
                </div>
              </div>

              <div className="verification-bar">
                <div>
                  <span>Verification controls</span>
                  <small>Approval and presentation visibility are recorded separately.</small>
                </div>
                {selected.status !== "approved" ? (
                  <>
                    <button className="request-action" type="button" disabled={isUpdating} onClick={() => void update({ status: "rejected", isVisible: false }, "Changes requested from the response owner.")}>Request changes</button>
                    <button className="approve-action" type="button" disabled={isUpdating} onClick={() => void update({ status: "approved", isVisible: true }, "Response approved and included in the presentation.")}>Approve & include <span>✓</span></button>
                  </>
                ) : (
                  <>
                    <button className="request-action" type="button" disabled={isUpdating} onClick={() => void update({ status: "rejected", isVisible: false }, "Response returned for changes.")}>Return for changes</button>
                    <button className={selected.isVisible ? "visibility-action live" : "visibility-action"} type="button" disabled={isUpdating} onClick={() => void update({ isVisible: !selected.isVisible }, selected.isVisible ? "Response removed from the presentation." : "Response included in the presentation.")}>{selected.isVisible ? "Included in presentation" : "Include in presentation"}<span>{selected.isVisible ? "On" : "Off"}</span></button>
                  </>
                )}
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

export function handleChipKey(event: ReactKeyboardEvent, action: () => void) {
  if (event.key === " " || event.key === "Enter") {
    event.preventDefault();
    action();
  }
}
