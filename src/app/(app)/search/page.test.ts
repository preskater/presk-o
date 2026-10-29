import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchGroup } from "@/modules/search/domain";

/**
 * Rendering of the search page: grouping, bounds, and the distinct states the search
 * page must tell apart. The repository is mocked so each state is rendered exactly.
 */
const requireUserMock = vi.fn();
const searchAllMock = vi.fn();
const providerStateMock = vi.fn();

vi.mock("@/lib/auth/guard", () => ({ requireUser: () => requireUserMock() }));
vi.mock("@/modules/search/repository", () => ({
  searchAll: (input: unknown) => searchAllMock(input),
  getProviderSearchState: () => providerStateMock(),
}));

const { default: SearchPage } = await import("./page");

function session(modules: string[] = ["budget", "real-estate", "development"]) {
  return {
    id: "owner-1",
    email: "owner@example.test",
    name: null,
    sessionId: "session-1",
    workspace: {
      id: "ws-owner",
      name: "Personnel",
      kind: "PERSONAL",
      role: "OWNER",
      modules,
    },
  };
}

async function render(params: Record<string, string> = {}): Promise<string> {
  const element = await SearchPage({ searchParams: Promise.resolve(params) });
  return renderToStaticMarkup(element as never);
}

const transactionGroup: SearchGroup = {
  kind: "transaction",
  items: [
    {
      id: "transaction-1",
      kind: "transaction",
      title: "Loyer",
      detail: "05/10/2026 · −950,00 €",
      href: "/budget?tab=operations&month=2026-10&q=Loyer",
      external: false,
    },
    {
      id: "transaction-2",
      kind: "transaction",
      title: "Loyer garage",
      detail: "05/10/2026 · −80,00 €",
      href: "/budget?tab=operations&month=2026-10&q=Loyer",
      external: false,
    },
  ],
  truncated: true,
  seeAllHref: "/budget?tab=operations&all=1&q=loyer",
};

const projectGroup: SearchGroup = {
  kind: "project",
  items: [
    {
      id: "project-1",
      kind: "project",
      title: "owner/test-project",
      detail: "GitHub",
      href: "https://github.test/owner/test-project",
      external: true,
    },
  ],
  truncated: false,
  seeAllHref: "/integrations",
};

beforeEach(() => {
  requireUserMock.mockReset().mockResolvedValue(session());
  searchAllMock.mockReset();
  providerStateMock.mockReset();
});

describe("search page", () => {
  it("groups results, states the bound and links provider rows to their source", async () => {
    searchAllMock.mockResolvedValue({ groups: [transactionGroup, projectGroup], total: 3 });
    providerStateMock.mockResolvedValue({
      kind: "ok",
      lastSyncedAt: new Date("2026-10-28T10:00:00Z"),
      stale: false,
    });

    const html = await render({ q: "loyer" });

    expect(searchAllMock).toHaveBeenCalledWith({
      workspaceId: "ws-owner",
      query: "loyer",
      kinds: ["transaction", "account", "property", "project", "issue", "milestone"],
    });
    expect(html).toContain('role="search"');
    expect(html).toContain("Opérations");
    expect(html).toContain("Projets");
    expect(html).toContain("Seuls les 2 premiers résultats sont affichés");
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noreferrer noopener"');
    expect(html).toContain("Dernière synchronisation des fournisseurs");
  });

  it("tells a provider failure apart from an empty result", async () => {
    searchAllMock.mockResolvedValue({ groups: [], total: 0 });
    providerStateMock.mockResolvedValue({
      kind: "error",
      providers: ["GITHUB"],
      lastSyncedAt: null,
    });

    const html = await render({ q: "loyer" });

    expect(html).toContain("Aucun résultat");
    expect(html).toContain("La dernière synchronisation a échoué pour GitHub");
    expect(html).toContain("Les résultats des fournisseurs sont indisponibles");
  });

  it("tells a disconnected provider apart from an empty result", async () => {
    searchAllMock.mockResolvedValue({ groups: [], total: 0 });
    providerStateMock.mockResolvedValue({ kind: "not_connected" });

    const html = await render({ q: "loyer" });

    expect(html).toContain("Aucune connexion GitHub ou GitLab");
    expect(html).toContain("Aucune connexion GitHub ou GitLab n&#x27;est configurée");
  });

  it("flags an outdated synchronisation instead of showing it as current", async () => {
    searchAllMock.mockResolvedValue({ groups: [transactionGroup], total: 2 });
    providerStateMock.mockResolvedValue({
      kind: "ok",
      lastSyncedAt: new Date("2026-10-26T10:00:00Z"),
      stale: true,
    });

    const html = await render({ q: "loyer" });

    expect(html).toContain("Ces résultats peuvent être obsolètes");
  });

  it("reads nothing for a query shorter than the minimum", async () => {
    const html = await render({ q: "a" });

    expect(searchAllMock).not.toHaveBeenCalled();
    expect(providerStateMock).not.toHaveBeenCalled();
    expect(html).toContain("Recherche trop courte");
  });

  it("searches only the kinds whose module is active", async () => {
    requireUserMock.mockResolvedValue(session(["budget"]));
    searchAllMock.mockResolvedValue({ groups: [], total: 0 });

    await render({ q: "loyer" });

    expect(searchAllMock).toHaveBeenCalledWith({
      workspaceId: "ws-owner",
      query: "loyer",
      kinds: ["transaction", "account"],
    });
    // The development module is disabled: provider freshness is not even read.
    expect(providerStateMock).not.toHaveBeenCalled();
  });

  it("says no module is searchable instead of showing an empty result", async () => {
    requireUserMock.mockResolvedValue(session([]));

    const html = await render({ q: "loyer" });

    expect(searchAllMock).not.toHaveBeenCalled();
    expect(html).toContain("Aucun module à rechercher");
    expect(html).not.toContain("Aucun résultat");
  });
});
