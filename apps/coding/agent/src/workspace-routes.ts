import { execFile } from 'node:child_process';
import { readFile, realpath } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
function reply(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(body));
}
export function workspaceRoutes(root: string) {
  return async (
    request: IncomingMessage,
    response: ServerResponse,
    _principal: string,
    url: URL,
  ): Promise<boolean> => {
    if (!url.pathname.startsWith('/workspace/')) return false;
    if (request.method !== 'GET') {
      reply(response, 405, { error: 'Method not allowed' });
      return true;
    }
    try {
      if (url.pathname === '/workspace/files') {
        const { stdout } = await run(
          'rg',
          [
            '--files',
            '--hidden',
            '-g',
            '!.git',
            '-g',
            '!.harngine',
            '-g',
            '!node_modules',
            '-g',
            '!build',
          ],
          { cwd: root, timeout: 10000, maxBuffer: 1024 * 1024 },
        );
        reply(response, 200, { files: stdout.split('\n').filter(Boolean).slice(0, 500).sort() });
        return true;
      }
      if (url.pathname === '/workspace/git') {
        const [branch, status] = await Promise.all([
          run('git', ['branch', '--show-current'], { cwd: root, timeout: 10000, maxBuffer: 4096 }),
          run('git', ['status', '--short', '--untracked-files=normal'], {
            cwd: root,
            timeout: 10000,
            maxBuffer: 100000,
          }),
        ]);
        reply(response, 200, {
          branch: branch.stdout.trim() || '(detached)',
          changes: status.stdout.split('\n').filter(Boolean).slice(0, 200),
        });
        return true;
      }
      if (url.pathname === '/workspace/file') {
        const path = url.searchParams.get('path');
        if (!path || path.length > 1000 || isAbsolute(path)) throw new Error('Invalid file path');
        const target = resolve(root, path);
        const relativePath = relative(root, target);
        if (
          !relativePath ||
          relativePath === '..' ||
          relativePath.startsWith(`..${sep}`) ||
          relativePath === '.git' ||
          relativePath.startsWith(`.git${sep}`) ||
          relativePath === '.harngine' ||
          relativePath.startsWith(`.harngine${sep}`)
        )
          throw new Error('File is outside the workspace');
        const actual = await realpath(target);
        const actualRelative = relative(root, actual);
        if (actualRelative === '..' || actualRelative.startsWith(`..${sep}`))
          throw new Error('Symlink leaves the workspace');
        const data = await readFile(actual);
        if (data.includes(0)) throw new Error('Binary file preview is unavailable');
        reply(response, 200, {
          path: relativePath,
          content: data.toString('utf8', 0, 20000),
          truncated: data.length > 20000,
        });
        return true;
      }
      reply(response, 404, { error: 'Not found' });
    } catch (error) {
      reply(response, 400, { error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  };
}
