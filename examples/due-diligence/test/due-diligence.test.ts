import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import type { ModelRequest } from 'harngine';
import {
  DocumentLibrary,
  createDueDiligenceDesk,
  dueDiligenceDemoModel,
  runDueDiligence,
  waitForApproval,
} from '../src/app.js';

test('due diligence keeps attachments outside context and publishes only after approval', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'harngine-diligence-test-')));
  const outputDirectory = join(root, 'published');
  const library = new DocumentLibrary();
  const agreement = library.add(
    'agreement.md',
    'The agreement renews automatically unless notice is given 60 days before expiry.',
    'text/markdown',
  );
  const amendmentBytes = new TextEncoder().encode(
    '%PDF-1.7\nApplication-owned signed amendment fixture\n%%EOF\n',
  );
  const amendment = library.addBinary(
    'renewal-amendment.pdf',
    amendmentBytes,
    'application/pdf',
    'Amendment 2 changes the renewal notice period to 90 days.',
  );
  expect(library.read(amendment)).toContain('notice period to 90 days');
  await expect(
    library.resolve(amendment, { signal: new AbortController().signal }),
  ).resolves.toEqual(Uint8Array.from(amendmentBytes));
  const requests: ModelRequest[] = [];
  const demo = dueDiligenceDemoModel();
  const model = {
    ...demo,
    async generate(request: ModelRequest, context: Parameters<typeof demo.generate>[1]) {
      requests.push(request);
      return demo.generate(request, context);
    },
  };
  const desk = createDueDiligenceDesk({
    directory: join(root, 'harngine'),
    outputDirectory,
    library,
    model,
  });

  try {
    const work = await runDueDiligence(desk, {
      question: 'What is the renewal notice period?',
      attachments: [agreement, amendment],
    });
    const approval = await waitForApproval(work);
    expect(requests[0]?.context.artifacts).toEqual([agreement, amendment]);
    expect(JSON.stringify(requests[0]?.context)).not.toContain('renews automatically');
    expect(JSON.stringify(requests[0]?.context)).not.toContain('notice period to 90 days');

    expect(approval).toMatchObject({
      tool: { id: 'diligence.report.publish' },
      details: {
        citations: expect.arrayContaining([
          { source: agreement.id, version: agreement.digest },
          { source: amendment.id, version: amendment.digest },
        ]),
      },
    });
    expect(existsSync(join(outputDirectory, 'due-diligence-report.json'))).toBe(false);

    await work.respond(approval.id, true);
    const result = await work.result();
    expect(result).toMatchObject({
      status: 'review',
      citations: expect.arrayContaining([
        { source: agreement.id, version: agreement.digest },
        { source: amendment.id, version: amendment.digest },
      ]),
      report: {
        object: 'artifact',
        mediaType: 'application/json',
        digest: expect.stringMatching(/^sha256:/),
      },
    });
    const published = readFileSync(join(outputDirectory, 'due-diligence-report.json'), 'utf8');
    expect(JSON.parse(published)).toMatchObject({
      attachments: [agreement, amendment],
      citations: expect.arrayContaining([
        { source: agreement.id, version: agreement.digest },
        { source: amendment.id, version: amendment.digest },
      ]),
    });
    await expect(work.inspect({ detail: 'story' })).resolves.toMatchObject({
      entries: expect.arrayContaining([
        expect.objectContaining({
          type: 'call',
          tool: expect.objectContaining({ id: 'diligence.documents.search' }),
        }),
        expect.objectContaining({
          type: 'call',
          tool: expect.objectContaining({ id: 'diligence.report.publish' }),
        }),
      ]),
    });
  } finally {
    await desk.app.close();
    rmSync(root, { recursive: true, force: true });
  }
});
