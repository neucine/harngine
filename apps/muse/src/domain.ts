import { createHash } from 'node:crypto';
import type { Json } from 'harngine';

export type ResearchMode = 'replay' | 'live';
export type ClaimKind = 'fact' | 'inference' | 'conflict' | 'creative';

export interface ResearchBrief {
  readonly question: string;
  readonly angle: string;
  readonly mode: ResearchMode;
}

export interface EditorialRevision {
  readonly revision: number;
  readonly title: string;
  readonly dek: string;
  readonly selectedOutline: string;
  readonly draft: readonly string[];
}

export interface MuseObjective extends ResearchBrief {
  readonly revision?: EditorialRevision;
}

export interface SourceEnvelope {
  readonly provider: 'openalex' | 'crossref' | 'wikimedia-commons';
  readonly objectId: string;
  readonly fetchedAt: string;
  readonly mode: ResearchMode;
  readonly rights: string;
  readonly sourceUrl: string;
  readonly contentHash: string;
  readonly content: Json;
}

export interface Claim {
  readonly id: string;
  readonly text: string;
  readonly kind: ClaimKind;
  readonly evidence: readonly string[];
  readonly note: string;
}

export interface StudioDocument {
  readonly title: string;
  readonly dek: string;
  readonly brief: ResearchBrief;
  readonly sources: readonly SourceEnvelope[];
  readonly claims: readonly Claim[];
  readonly outlines: readonly { readonly name: string; readonly sections: readonly string[] }[];
  readonly selectedOutline: string;
  readonly draft: readonly { readonly text: string; readonly claimIds: readonly string[] }[];
  readonly critic: readonly string[];
  readonly factCheck: readonly { readonly claimId: string; readonly status: string }[];
  readonly rightsReview: {
    readonly status: 'clear' | 'blocked';
    readonly items: readonly string[];
  };
}

export interface PublicationReceipt {
  readonly target: 'local' | 'github';
  readonly objectId: string;
  readonly url: string;
  readonly contentHash: string;
  readonly publishedAt: string;
}

export function canonical(value: Json): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key]!)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

export function contentHash(value: Json): string {
  return `sha256:${createHash('sha256').update(canonical(value)).digest('hex')}`;
}

export function verifyEnvelope(envelope: SourceEnvelope): SourceEnvelope {
  if (contentHash(envelope.content) !== envelope.contentHash)
    throw new Error(`Replay content hash mismatch for ${envelope.provider}:${envelope.objectId}`);
  return envelope;
}

const source = (
  sources: readonly SourceEnvelope[],
  provider: SourceEnvelope['provider'],
  id: string,
) => {
  const found = sources.find((item) => item.provider === provider && item.objectId === id);
  if (!found) throw new Error(`Required evidence is missing: ${provider}:${id}`);
  return found;
};

export function assembleStudio(
  brief: ResearchBrief,
  sources: readonly SourceEnvelope[],
): StudioDocument {
  const bloom = source(sources, 'openalex', 'W2161708711');
  const hybrid = source(sources, 'openalex', 'W4399567465');
  const bloomMetadata = source(sources, 'crossref', '10.1093/qje/qju032');
  const hybridMetadata = source(sources, 'crossref', '10.1038/s41586-024-07500-2');
  const image = source(
    sources,
    'wikimedia-commons',
    'File:Big Desk Home Office Carrollton New Orleans.jpg',
  );
  const claims: Claim[] = [
    {
      id: 'claim-1',
      kind: 'fact',
      text: 'In a nine-month randomized experiment at Ctrip, home working increased measured performance by 13%.',
      evidence: [bloom.contentHash, bloomMetadata.contentHash],
      note: 'Scoped to volunteer call-centre employees at one Chinese company.',
    },
    {
      id: 'claim-2',
      kind: 'fact',
      text: 'A later randomized trial of 1,612 employees found that two hybrid days at home reduced quit rates by one-third without measurable damage to performance grades.',
      evidence: [hybrid.contentHash, hybridMetadata.contentHash],
      note: 'The intervention was hybrid work, not fully remote work.',
    },
    {
      id: 'claim-3',
      kind: 'conflict',
      text: 'The studies do not establish one universal productivity effect for every kind of remote work.',
      evidence: [bloom.contentHash, hybrid.contentHash],
      note: 'Different jobs, schedules, periods, and outcome measures prevent a single pooled conclusion.',
    },
    {
      id: 'claim-4',
      kind: 'inference',
      text: 'A carefully designed hybrid policy may capture retention benefits with less performance risk than leaders often expect.',
      evidence: [hybrid.contentHash],
      note: 'Editorial inference; it should not be presented as a direct study finding.',
    },
    {
      id: 'claim-5',
      kind: 'creative',
      text: 'The office is becoming a rhythm, not a place.',
      evidence: [],
      note: 'Creative language; intentionally not evidence-backed.',
    },
  ];
  const rightsClear =
    image.rights.includes('CC BY 2.0') && image.rights.includes('attribution required');
  return {
    title: 'What the best remote-work experiments actually show',
    dek: 'Two landmark trials point to real gains—and to the limits of sweeping claims.',
    brief,
    sources,
    claims,
    outlines: [
      {
        name: 'Evidence first',
        sections: [
          'The claim',
          'Two experiments',
          'Why context changes the answer',
          'A practical reading',
        ],
      },
      {
        name: 'Creator narrative',
        sections: [
          'The empty commute',
          'The productivity question',
          'What changed in 2024',
          'The honest answer',
        ],
      },
    ],
    selectedOutline: 'Evidence first',
    draft: [
      {
        text: 'Remote work is often argued as a belief. The strongest evidence asks a narrower question: what changed in a particular job, under a particular schedule?',
        claimIds: ['claim-3'],
      },
      { text: claims[0]!.text, claimIds: ['claim-1'] },
      { text: claims[1]!.text, claimIds: ['claim-2'] },
      {
        text: `${claims[4]!.text} That line is a useful frame, not a finding. ${claims[3]!.text}`,
        claimIds: ['claim-5', 'claim-4'],
      },
    ],
    critic: [
      'Keep the Ctrip result scoped to call-centre work and volunteer participants.',
      'Do not collapse fully remote and hybrid interventions into one treatment.',
      'Retain the explicit creative-language label on the closing phrase.',
    ],
    factCheck: claims.map((claim) => ({
      claimId: claim.id,
      status:
        claim.kind === 'fact' && claim.evidence.length > 0
          ? 'supported'
          : claim.kind === 'conflict'
            ? 'unresolved by design'
            : claim.kind === 'inference'
              ? 'labelled inference'
              : 'not a factual claim',
    })),
    rightsReview: {
      status: rightsClear ? 'clear' : 'blocked',
      items: rightsClear
        ? [
            `Image may be used with attribution: ${String((image.content as Record<string, Json>).artist)} — ${image.rights}.`,
          ]
        : ['Publication blocked: the selected image lacks complete reusable-rights metadata.'],
    },
  };
}

export function assertPublishable(studio: StudioDocument): void {
  if (studio.rightsReview.status !== 'clear') throw new Error('RIGHTS_BLOCKED');
  for (const claim of studio.claims) {
    if (claim.kind === 'fact' && claim.evidence.length === 0)
      throw new Error(`UNSUPPORTED_FACT:${claim.id}`);
    if (
      claim.evidence.some(
        (hash) => !studio.sources.some((sourceItem) => sourceItem.contentHash === hash),
      )
    )
      throw new Error(`UNRETRIEVABLE_EVIDENCE:${claim.id}`);
  }
}

export function applyEditorialRevision(
  studio: StudioDocument,
  revision: EditorialRevision | undefined,
): StudioDocument {
  if (!revision) return studio;
  if (!Number.isSafeInteger(revision.revision) || revision.revision < 1)
    throw new Error('INVALID_REVISION');
  if (!studio.outlines.some((outline) => outline.name === revision.selectedOutline))
    throw new Error('UNKNOWN_OUTLINE');
  if (revision.title.trim().length < 8 || revision.dek.trim().length < 8)
    throw new Error('EDITORIAL_TEXT_TOO_SHORT');
  if (
    revision.draft.length !== studio.draft.length ||
    revision.draft.some((paragraph) => paragraph.trim().length < 12)
  )
    throw new Error('INVALID_DRAFT_STRUCTURE');
  return {
    ...studio,
    title: revision.title.trim(),
    dek: revision.dek.trim(),
    selectedOutline: revision.selectedOutline,
    draft: studio.draft.map((paragraph, index) => ({
      ...paragraph,
      text: revision.draft[index]!.trim(),
    })),
  };
}
