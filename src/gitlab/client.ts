import { FileDiff, MrInfo } from '../types';
import { extractChangedSymbols, countDiffLines } from '../diff/parser';
import { logger } from '../logger';

export interface MrListItem {
  iid: number;
  title: string;
  sourceBranch: string;
  author: string;
  updatedAt: string;
}

export class GitLabError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
  }
}

export class GitLabClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token?: string
  ) {}

  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl.replace(/\/$/, '')}/api/v4${path}`;
    const headers: Record<string, string> = {};
    if (this.token) {
      headers['PRIVATE-TOKEN'] = this.token;
    }
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    logger.info(`GitLab: ${method} ${url}`);
    const started = Date.now();
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      logger.error(`GitLab: request to ${url} failed: ${(e as Error).message}`);
      throw new GitLabError(`GitLab request failed: ${(e as Error).message}`);
    }
    logger.info(`GitLab: ${res.status} in ${Date.now() - started}ms for ${path}`);
    if (!res.ok) {
      const hint =
        res.status === 401 || res.status === 403
          ? method === 'POST'
            ? ' (posting comments needs a token with `api` scope: "MR Lens: Set GitLab Token")'
            : ' (check your GitLab token: "MR Lens: Set GitLab Token")'
          : res.status === 404
            ? ' (check mrLens.gitlab.url / projectId; private projects need a token)'
            : '';
      throw new GitLabError(`GitLab API ${res.status} for ${path}${hint}`, res.status);
    }
    return (await res.json()) as T;
  }

  private get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  async listOpenMergeRequests(projectId: string): Promise<MrListItem[]> {
    const id = encodeURIComponent(projectId);
    const mrs = await this.get<any[]>(
      `/projects/${id}/merge_requests?state=opened&order_by=updated_at&per_page=30`
    );
    return mrs.map((mr) => ({
      iid: mr.iid,
      title: mr.title,
      sourceBranch: mr.source_branch,
      author: mr.author?.name ?? 'unknown',
      updatedAt: mr.updated_at,
    }));
  }

  async getMergeRequestChanges(
    projectId: string,
    iid: number
  ): Promise<{ mr: MrInfo; changes: FileDiff[] }> {
    const id = encodeURIComponent(projectId);
    const data = await this.get<any>(`/projects/${id}/merge_requests/${iid}/changes`);
    const webUrl: string = data.web_url ?? '';
    const mr: MrInfo = {
      projectId,
      iid,
      title: data.title ?? '',
      description: data.description ?? '',
      webUrl,
      projectWebUrl: webUrl.replace(/\/-\/merge_requests\/.*$/, ''),
      sourceBranch: data.source_branch ?? '',
      targetBranch: data.target_branch ?? '',
      headSha: data.diff_refs?.head_sha ?? data.sha ?? '',
      baseSha: data.diff_refs?.base_sha ?? '',
      startSha: data.diff_refs?.start_sha ?? '',
      author: data.author?.name ?? 'unknown',
    };
    const changes: FileDiff[] = (data.changes ?? []).map((c: any) => {
      const counts = countDiffLines(c.diff ?? '');
      return {
        oldPath: c.old_path,
        newPath: c.new_path,
        diff: c.diff ?? '',
        isNew: !!c.new_file,
        isDeleted: !!c.deleted_file,
        isRenamed: !!c.renamed_file,
        changedSymbols: extractChangedSymbols(c.diff ?? ''),
        addedLines: counts.added,
        removedLines: counts.removed,
      };
    });
    return { mr, changes };
  }

  /** Post a general comment (note) on the merge request. */
  async postMergeRequestNote(projectId: string, iid: number, body: string): Promise<void> {
    const id = encodeURIComponent(projectId);
    await this.request('POST', `/projects/${id}/merge_requests/${iid}/notes`, { body });
  }

  /**
   * Post an inline comment (diff discussion) anchored to a line on the NEW side
   * of the diff. Requires the MR's diff_refs SHAs; GitLab rejects positions that
   * don't fall on a line present in the diff (400).
   */
  async postMergeRequestInlineComment(
    projectId: string,
    iid: number,
    body: string,
    position: { baseSha: string; startSha: string; headSha: string; filePath: string; line: number }
  ): Promise<void> {
    const id = encodeURIComponent(projectId);
    await this.request('POST', `/projects/${id}/merge_requests/${iid}/discussions`, {
      body,
      position: {
        position_type: 'text',
        base_sha: position.baseSha,
        start_sha: position.startSha,
        head_sha: position.headSha,
        old_path: position.filePath,
        new_path: position.filePath,
        new_line: position.line,
      },
    });
  }
}
