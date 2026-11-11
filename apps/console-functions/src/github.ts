/**
 * Updates from the console run the repository's GitHub Actions release workflow (docs/20): the
 * console dispatches it with the target and each client's settings, then follows the run.
 */
export interface GithubConfig {
  owner: string;
  repo: string;
  /** Workflow file name in .github/workflows. */
  workflow: string;
  /** Branch to release from. */
  ref: string;
}

export interface RunInfo {
  id: number;
  url: string;
  status: string;
  conclusion: string | null;
  title: string;
  createdAt: string;
}

type Fetch = typeof fetch;

const api = (token: string, f: Fetch) => async (path: string, init: RequestInit = {}) => {
  const r = await f(`https://api.github.com${path}`, {
    ...init,
    headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "polymath-console", ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`GitHub answered ${r.status}${text ? `: ${text.slice(0, 300)}` : ""}`);
  }
  return r.status === 204 ? null : r.json();
};

/** Starts the release workflow. `requestId` comes back in the run's title so the run can be found. */
export async function dispatchRelease(cfg: GithubConfig, token: string, inputs: { target: string; registry: string; requestId: string }, f: Fetch = fetch): Promise<void> {
  if (!token || token === "none") throw new Error("No GitHub token yet: run `pnpm console:setup --github-token` (Settings → GitHub explains it).");
  await api(token, f)(`/repos/${cfg.owner}/${cfg.repo}/actions/workflows/${encodeURIComponent(cfg.workflow)}/dispatches`, {
    method: "POST",
    body: JSON.stringify({ ref: cfg.ref, inputs: { target: inputs.target, registry: inputs.registry, request_id: inputs.requestId } }),
  });
}

/** Recent runs of the workflow started by workflow_dispatch. */
export async function recentRuns(cfg: GithubConfig, token: string, f: Fetch = fetch): Promise<RunInfo[]> {
  const body = (await api(token, f)(`/repos/${cfg.owner}/${cfg.repo}/actions/workflows/${encodeURIComponent(cfg.workflow)}/runs?event=workflow_dispatch&per_page=30`)) as {
    workflow_runs: { id: number; html_url: string; status: string; conclusion: string | null; display_title: string; created_at: string }[];
  };
  return body.workflow_runs.map((r) => ({ id: r.id, url: r.html_url, status: r.status, conclusion: r.conclusion, title: r.display_title, createdAt: r.created_at }));
}

/** The version on the release branch (apps/web/package.json), for "latest version". */
export async function releaseBranchVersion(cfg: GithubConfig, token: string, f: Fetch = fetch): Promise<string | undefined> {
  const body = (await api(token, f)(`/repos/${cfg.owner}/${cfg.repo}/contents/apps/web/package.json?ref=${encodeURIComponent(cfg.ref)}`)) as { content?: string };
  if (!body.content) return undefined;
  return (JSON.parse(Buffer.from(body.content, "base64").toString("utf8")) as { version?: string }).version;
}
