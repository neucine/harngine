import type { Claim, SourceEnvelope, StudioDocument } from './domain.js';

export type MaterialKind = 'source' | 'fact' | 'tension' | 'inference' | 'motif' | 'fragment';
export type PerspectiveId = 'archivist' | 'contrarian' | 'metaphorist';

export interface MaterialNode {
  readonly id: string;
  readonly kind: MaterialKind;
  readonly title: string;
  readonly body: string;
  readonly x: number;
  readonly y: number;
  readonly evidence: readonly string[];
  dormant: boolean;
}

export interface MaterialRelation {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly label: 'supports' | 'complicates' | 'echoes' | 'juxtaposes';
}

export interface LineageEvent {
  readonly id: string;
  readonly at: string;
  readonly verb: string;
  readonly detail: string;
  readonly nodeIds: readonly string[];
}

export interface MaterialConversation {
  readonly id: string;
  readonly at: string;
  readonly perspective: PerspectiveId;
  readonly nodeId: string;
  readonly prompt: string;
  readonly response: string;
}

export interface CreativeSpark {
  readonly id: string;
  readonly at: string;
  readonly seed: string;
  readonly perspective: PerspectiveId;
  readonly nodeIds: readonly string[];
  readonly title: string;
  readonly body: string;
  readonly tension: string;
  readonly evidence: readonly string[];
  saved: boolean;
}

export interface CreativeSpace {
  readonly nodes: MaterialNode[];
  readonly relations: MaterialRelation[];
  readonly lineage: LineageEvent[];
  readonly conversations: MaterialConversation[];
  readonly sparks: CreativeSpark[];
}

const positions = [
  [12, 18],
  [39, 9],
  [68, 18],
  [83, 41],
  [63, 59],
  [34, 66],
  [11, 51],
  [46, 36],
] as const;

function sourceTitle(source: SourceEnvelope): string {
  if (source.provider === 'wikimedia-commons') return 'A room arranged for work';
  const content = source.content as Record<string, unknown>;
  return String(content.title ?? source.objectId);
}

function claimKind(claim: Claim): MaterialKind {
  if (claim.kind === 'conflict') return 'tension';
  if (claim.kind === 'creative') return 'motif';
  return claim.kind;
}

export function createCreativeSpace(
  studio: StudioDocument,
  at = new Date().toISOString(),
): CreativeSpace {
  const sourceNodes = studio.sources.slice(0, 3).map(
    (source, index): MaterialNode => ({
      id: `source-${index + 1}`,
      kind: 'source',
      title: sourceTitle(source),
      body: `${source.provider} · ${source.rights}`,
      x: positions[index]![0],
      y: positions[index]![1],
      evidence: [source.contentHash],
      dormant: false,
    }),
  );
  const claimNodes = studio.claims.map(
    (claim, index): MaterialNode => ({
      id: claim.id,
      kind: claimKind(claim),
      title:
        claim.kind === 'creative'
          ? 'A phrase looking for a home'
          : claim.kind === 'conflict'
            ? 'The studies resist merging'
            : `Reading ${index + 1}`,
      body: claim.text,
      x: positions[index + 3]![0],
      y: positions[index + 3]![1],
      evidence: claim.evidence,
      dormant: false,
    }),
  );
  const relations: MaterialRelation[] = [];
  for (const claim of studio.claims) {
    for (const hash of claim.evidence) {
      const sourceIndex = studio.sources
        .slice(0, 3)
        .findIndex((source) => source.contentHash === hash);
      if (sourceIndex >= 0)
        relations.push({
          id: `relation-${relations.length + 1}`,
          from: `source-${sourceIndex + 1}`,
          to: claim.id,
          label: claim.kind === 'conflict' ? 'complicates' : 'supports',
        });
    }
  }
  return {
    nodes: [...sourceNodes, ...claimNodes],
    relations,
    conversations: [],
    sparks: [],
    lineage: [
      {
        id: 'arrival',
        at,
        verb: 'Material arrived',
        detail: `${studio.sources.length} source records opened into ${studio.claims.length} readings. Nothing has been committed to a story.`,
        nodeIds: [...sourceNodes, ...claimNodes].map((node) => node.id),
      },
    ],
  };
}

export function createSpark(
  id: string,
  seed: string,
  perspective: PerspectiveId,
  nodes: readonly MaterialNode[],
  at = new Date().toISOString(),
): CreativeSpark {
  const evidence = [...new Set(nodes.flatMap((node) => node.evidence))];
  const names = nodes.map((node) => node.title);
  const titles: Record<PerspectiveId, string> = {
    archivist: 'Design the boundary, not the rule',
    contrarian: 'The office may be a coordination tax',
    metaphorist: 'A workplace made of rhythm',
  };
  const bodies: Record<PerspectiveId, string> = {
    archivist: `The useful idea is not “remote works” or “offices work.” It is to name the conditions that make each result possible, then design policy around those boundaries. ${names.join(' and ')} become a map of contexts rather than a verdict.`,
    contrarian: `Put ${names.join(' beside ')} and a sharper possibility appears: presence may matter less as a location than as a deliberately timed coordination cost. The strongest evidence does not settle the argument; it changes what the argument should be about.`,
    metaphorist: `Imagine work as a score rather than a building: concentration, encounter, and recovery each enter at different moments. ${names.join(' and ')} supply the beats; the seed supplies the question the rhythm is trying to answer.`,
  };
  return {
    id,
    at,
    seed,
    perspective,
    nodeIds: nodes.map((node) => node.id),
    title: titles[perspective],
    body: bodies[perspective],
    tension: `Sparked from ${nodes.length} unlike fragments. ${evidence.length} provenance trace${evidence.length === 1 ? ' remains' : 's remain'} attached; the synthesis itself is an interpretation.`,
    evidence,
    saved: false,
  };
}

export function perspectiveResponse(
  perspective: PerspectiveId,
  node: MaterialNode,
  prompt: string,
): string {
  if (perspective === 'archivist') {
    return node.evidence.length > 0
      ? `Keep this close to its conditions. It carries ${node.evidence.length} evidence link${node.evidence.length === 1 ? '' : 's'}, but the useful question is what the material does not license us to generalize. “${prompt}” should be answered without loosening that boundary.`
      : `This is a created fragment, not a finding. Preserve that label as you follow “${prompt}”; its freedom comes from not pretending to be evidence.`;
  }
  if (perspective === 'contrarian') {
    return `The live tension is not whether this is true, but what changes when its opposite is granted a fair hearing. Put “${node.title}” beside the least compatible material and ask which context makes each one useful.`;
  }
  return `I hear an image inside this: ${node.kind === 'source' ? 'the archive as a room with movable walls' : 'work as a rhythm whose rests matter as much as its beats'}. Let “${prompt}” become a phrase first; decide later whether it belongs in an argument.`;
}
