import { describe, expect, it } from "vitest";
import {
  buildCiOverview,
  ciOutcome,
  ciRunDurationSeconds,
  describeCiError,
  formatCiDuration,
  type CiRepositoryLike,
  type CiRunLike,
} from "./ci";

/** Fictitious repositories and workflows only. */
const T0 = new Date("2026-09-30T10:00:00Z");
const at = (minutes: number): Date => new Date(T0.getTime() + minutes * 60 * 1000);

function run(overrides: Partial<CiRunLike> = {}): CiRunLike {
  return {
    workflowName: overrides.workflowName ?? "CI",
    branch: overrides.branch ?? "main",
    status: overrides.status ?? "completed",
    conclusion: overrides.conclusion === undefined ? "success" : overrides.conclusion,
    startedAt: overrides.startedAt ?? T0,
    runUpdatedAt: overrides.runUpdatedAt ?? at(4),
  };
}

function repository(overrides: Partial<CiRepositoryLike> = {}): CiRepositoryLike {
  return {
    repository: overrides.repository ?? "acme/app",
    provider: overrides.provider ?? "GITHUB",
    ciCheckedAt: overrides.ciCheckedAt === undefined ? T0 : overrides.ciCheckedAt,
    ciError: overrides.ciError ?? null,
    runs: overrides.runs ?? [],
  };
}

describe("ciOutcome", () => {
  it("reads any non-completed status as running", () => {
    expect(ciOutcome({ status: "queued", conclusion: null })).toBe("running");
    expect(ciOutcome({ status: "in_progress", conclusion: null })).toBe("running");
  });

  it("counts failure, timeout and startup failure as failures", () => {
    for (const conclusion of ["failure", "timed_out", "startup_failure"]) {
      expect(ciOutcome({ status: "completed", conclusion })).toBe("failure");
    }
  });

  it("keeps cancelled, skipped and neutral apart from both success and failure", () => {
    for (const conclusion of ["cancelled", "skipped", "neutral", "action_required", null]) {
      expect(ciOutcome({ status: "completed", conclusion })).toBe("other");
    }
  });

  it("reads success as success", () => {
    expect(ciOutcome({ status: "completed", conclusion: "success" })).toBe("success");
  });
});

describe("ciRunDurationSeconds", () => {
  it("measures a completed run from start to last update", () => {
    expect(ciRunDurationSeconds(run({ runUpdatedAt: at(4) }))).toBe(240);
  });

  it("has no duration while the run is not completed", () => {
    expect(ciRunDurationSeconds(run({ status: "in_progress", conclusion: null }))).toBeNull();
  });

  it("never returns a negative duration on inconsistent dates", () => {
    expect(ciRunDurationSeconds(run({ runUpdatedAt: at(-1) }))).toBe(0);
  });
});

describe("formatCiDuration", () => {
  it("formats seconds, minutes and hours", () => {
    expect(formatCiDuration(52)).toBe("52 s");
    expect(formatCiDuration(245)).toBe("4 min 05 s");
    expect(formatCiDuration(3780)).toBe("1 h 03 min");
  });
});

describe("describeCiError", () => {
  it("explains a permission refusal", () => {
    expect(describeCiError("UNAUTHORIZED (HTTP 403)")).toContain("Actions");
  });

  it("keeps an unknown code visible", () => {
    expect(describeCiError("HTTP_ERROR (HTTP 502)")).toContain("HTTP_ERROR (HTTP 502)");
  });
});

describe("buildCiOverview", () => {
  it("is empty without repositories", () => {
    expect(buildCiOverview([])).toEqual({
      latest: [],
      withoutRuns: [],
      unavailable: [],
      notRead: [],
    });
  });

  it("keeps not read, unavailable and read-without-runs apart", () => {
    const overview = buildCiOverview([
      repository({ repository: "acme/skipped", ciCheckedAt: null }),
      repository({ repository: "acme/forbidden", ciError: "UNAUTHORIZED (HTTP 403)" }),
      repository({ repository: "acme/quiet" }),
    ]);

    expect(overview.notRead.map((row) => row.repository)).toEqual(["acme/skipped"]);
    expect(overview.unavailable.map((row) => row.repository.repository)).toEqual(["acme/forbidden"]);
    expect(overview.withoutRuns.map((row) => row.repository)).toEqual(["acme/quiet"]);
    expect(overview.latest).toEqual([]);
  });

  it("keeps only the latest run of each workflow", () => {
    const overview = buildCiOverview([
      repository({
        runs: [
          run({ workflowName: "CI", startedAt: at(0), conclusion: "failure" }),
          run({ workflowName: "CI", startedAt: at(30), conclusion: "success" }),
          run({ workflowName: "Deploy", startedAt: at(10) }),
        ],
      }),
    ]);

    expect(
      overview.latest.map((entry) => [entry.run.workflowName, entry.run.conclusion]),
    ).toEqual([
      ["CI", "success"],
      ["Deploy", "success"],
    ]);
  });

  it("lists the latest runs most recently started first, whatever their outcome", () => {
    const overview = buildCiOverview([
      repository({
        repository: "acme/a",
        runs: [
          run({ workflowName: "Lint", startedAt: at(50) }),
          run({ workflowName: "Build", startedAt: at(5), conclusion: "failure" }),
          run({ workflowName: "Docs", startedAt: at(40), conclusion: "cancelled" }),
        ],
      }),
      repository({
        repository: "acme/b",
        runs: [
          run({ workflowName: "Test", startedAt: at(20), conclusion: "timed_out" }),
          run({ workflowName: "Release", startedAt: at(1), status: "queued", conclusion: null }),
        ],
      }),
    ]);

    expect(overview.latest.map((entry) => entry.run.workflowName)).toEqual([
      "Lint",
      "Docs",
      "Test",
      "Build",
      "Release",
    ]);
  });

  it("breaks a start-time tie by repository, then workflow", () => {
    const overview = buildCiOverview([
      repository({ repository: "acme/b", runs: [run({ workflowName: "CI", startedAt: at(0) })] }),
      repository({
        repository: "acme/a",
        runs: [
          run({ workflowName: "Lint", startedAt: at(0) }),
          run({ workflowName: "Build", startedAt: at(0) }),
        ],
      }),
    ]);

    expect(
      overview.latest.map((entry) => `${entry.repository.repository} ${entry.run.workflowName}`),
    ).toEqual(["acme/a Build", "acme/a Lint", "acme/b CI"]);
  });
});
