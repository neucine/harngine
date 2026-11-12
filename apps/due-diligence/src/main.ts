import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DocumentLibrary,
  createDueDiligenceDesk,
  runDueDiligence,
  waitForApproval,
} from './app.js';

function demoPdf(lines: readonly string[]): Uint8Array {
  const escape = (text: string) =>
    text.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');
  const commands = [
    'BT',
    '/F1 12 Tf',
    '72 740 Td',
    '16 TL',
    ...lines.flatMap((line, index) => [
      `(${escape(line)}) Tj`,
      ...(index === lines.length - 1 ? [] : ['T*']),
    ]),
    'ET',
  ].join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(commands, 'utf8')} >>\nstream\n${commands}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (const [index, body] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

const root = realpathSync(mkdtempSync(join(tmpdir(), 'harngine-diligence-')));
const library = new DocumentLibrary();
const agreement = library.add(
  'master-services-agreement.md',
  'The initial term ends on 31 March 2027. Renewal requires written notice 60 days before expiry.\n\nEither party may terminate for material breach after 30 days without cure.',
  'text/markdown',
);
const amendment = library.addBinary(
  'renewal-amendment.pdf',
  demoPdf([
    'Amendment 2 replaces the renewal notice period with 90 days.',
    'The termination-for-breach clause is unchanged.',
    'The amendment was signed on 14 May 2026.',
  ]),
  'application/pdf',
  'Amendment 2 replaces the renewal notice period with 90 days. The termination-for-breach clause is unchanged.\n\nThe amendment was signed on 14 May 2026.',
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
