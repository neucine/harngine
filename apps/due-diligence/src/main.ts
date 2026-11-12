import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DocumentLibrary,
  createDueDiligenceDesk,
  runDueDiligence,
  waitForApproval,
} from './app.js';

const root = realpathSync(mkdtempSync(join(tmpdir(), 'harngine-diligence-')));
const library = new DocumentLibrary();
const agreement = library.add(
  'master-services-agreement.md',
  'The initial term ends on 31 March 2027. Renewal requires written notice 60 days before expiry.\n\nEither party may terminate for material breach after 30 days without cure.',
  'text/markdown',
);
const amendment = library.add(
  'renewal-amendment.md',
  'Amendment 2 replaces the renewal notice period with 90 days. The termination-for-breach clause is unchanged.\n\nThe amendment was signed on 14 May 2026.',
  'text/markdown',
);
const desk = createDueDiligenceDesk({
  directory: join(root, 'harngine'),
  outputDirectory: join(root, 'published'),
  library,
});

try {
  const work = await runDueDiligence(desk, {
    question: 'When must renewal notice be given, and did the amendment change it?',
    attachments: [agreement, amendment],
  });
  const approval = await waitForApproval(work);
  await work.respond(approval.id, true);
  const result = await work.result();
  const reportText = readFileSync(join(root, 'published', 'due-diligence-report.json'), 'utf8');
  console.log(
    JSON.stringify(
      {
        attachments: [agreement, amendment],
        approval,
        result,
        report: JSON.parse(reportText),
        evidence: (await work.inspect({ detail: 'story' })).entries.filter(
          (entry) =>
            entry.type === 'call' &&
            ['diligence.documents.search', 'diligence.report.publish'].includes(
              entry.tool?.id ?? '',
            ),
        ),
      },
      null,
      2,
    ),
  );
} finally {
  await desk.app.close();
  rmSync(root, { recursive: true, force: true });
}
