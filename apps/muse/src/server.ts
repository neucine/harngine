import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createServer, type IncomingMessage } from 'node:http';
import { resolve } from 'node:path';
import type { App, Json, Work, Workflow } from 'harngine';
import type { EditorialRevision, ResearchBrief, StudioDocument } from './domain.js';
import { musePage } from './page.js';
import {
  createCreativeSpace,
  createSpark,
  perspectiveResponse,
  type CreativeSpace,
  type MaterialRelation,
  type PerspectiveId,
} from './space.js';

export interface MuseServerOptions {
  readonly app: App;
  readonly workflow: Workflow<Json, Json>;
  readonly defaultMode?: 'replay' | 'live';
  readonly port?: number;
}

async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Object required');
  return value as Record<string, unknown>;
}

const editorialStudio = (snapshot: Awaited<ReturnType<Work['snapshot']>>) => {
  const interaction = snapshot.interactions.find((item) => item.type === 'approval') ?? null;
  const details =
    interaction?.type === 'approval' &&
    interaction.details &&
    typeof interaction.details === 'object' &&
    !Array.isArray(interaction.details)
      ? interaction.details
      : null;
  const studio =
    details?.studio ??
    (snapshot.result && typeof snapshot.result === 'object' && !Array.isArray(snapshot.result)
      ? snapshot.result
      : null);
  return { interaction, studio: studio as StudioDocument | null };
};

export async function serveMuse(options: MuseServerOptions) {
  const token = randomBytes(24).toString('hex');
  let origin = '';
  let work: Work | null = null;
  let revision = 0;
  let space: CreativeSpace | null = null;
  const defaults: ResearchBrief = {
    question: 'What does the strongest experimental evidence say about remote-work productivity?',
    angle:
      'Give creators a useful answer without flattening fully remote and hybrid work into one claim.',
    mode: options.defaultMode ?? 'replay',
  };
  const start = async (brief: ResearchBrief, editorialRevision?: EditorialRevision) => {
    work = await options.app.start(options.workflow, {
      ...brief,
      ...(editorialRevision ? { revision: editorialRevision } : {}),
    } as unknown as Json);
    return work;
  };
  const server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    );
    const json = (status: number, value: unknown) => {
      response.writeHead(status, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(value));
    };
    try {
      if (
        request.headers.host !== new URL(origin).host ||
        (request.headers.origin && request.headers.origin !== origin)
      )
        return json(403, { error: 'Local origin required' });
      if (request.method === 'GET' && request.url === '/') {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end(musePage(token));
        return;
      }
      if (
        request.method === 'GET' &&
        ['/main.mjs', '/App.mjs', '/styles.css'].includes(request.url ?? '')
      ) {
        const assetPath = resolve(process.cwd(), 'apps/muse/public', request.url!.slice(1));
        if (!existsSync(assetPath)) return json(404, { error: 'UI asset not built' });
        response.writeHead(200, {
          'Content-Type':
            request.url === '/styles.css'
              ? 'text/css; charset=utf-8'
              : 'text/javascript; charset=utf-8',
        });
        response.end(readFileSync(assetPath));
        return;
      }
      if (request.headers['x-muse-token'] !== token)
        return json(403, { error: 'Open the Muse page first' });
      if (request.method === 'GET' && request.url === '/api/state') {
        if (!work) return json(200, { status: 'idle', defaults, revision: 0 });
        const snapshot = await work.snapshot();
        const { interaction, studio } = editorialStudio(snapshot);
        if (studio && !space) space = createCreativeSpace(studio);
        const inspection = (await work.inspect({ detail: 'story', limit: 100 })).entries;
        return json(200, { ...snapshot, interaction, studio, space, inspection, revision });
      }
      if (request.method === 'POST' && request.url === '/api/research') {
        if (work && !['completed', 'failed', 'canceled'].includes((await work.snapshot()).status))
          return json(409, { error: 'Finish or return the current story first' });
        const input = await body(request);
        const brief: ResearchBrief = {
          question: String(input.question ?? ''),
          angle: String(input.angle ?? ''),
          mode: input.mode === 'live' ? 'live' : 'replay',
        };
        if (!/(remote|work(?:ing)? from home|hybrid)/i.test(brief.question))
          return json(400, {
            error: 'This reference slice currently supports remote-work and hybrid-work questions.',
          });
        revision = 0;
        space = null;
        await start(brief);
        return json(202, { accepted: true, workId: work!.id });
      }
      if (request.method === 'POST' && request.url === '/api/gesture') {
        if (!space) return json(409, { error: 'The material is still arriving' });
        const input = await body(request);
        const action = String(input.action ?? '');
        const nodeIds = Array.isArray(input.nodeIds) ? input.nodeIds.map(String).slice(0, 2) : [];
        const nodes = nodeIds.map((id) => space!.nodes.find((node) => node.id === id));
        if (nodes.some((node) => !node)) return json(404, { error: 'Material node not found' });
        if (action === 'sleep' || action === 'revive') {
          if (nodes.length !== 1) return json(400, { error: 'Choose one material node' });
          nodes[0]!.dormant = action === 'sleep';
          space.lineage.push({
            id: randomBytes(8).toString('hex'),
            at: new Date().toISOString(),
            verb: action === 'sleep' ? 'Direction set aside' : 'Dormant direction revived',
            detail: nodes[0]!.title,
            nodeIds,
          });
        } else if (action === 'juxtapose') {
          if (nodes.length !== 2 || nodeIds[0] === nodeIds[1])
            return json(400, { error: 'Choose two different pieces of material' });
          const relation: MaterialRelation = {
            id: randomBytes(8).toString('hex'),
            from: nodeIds[0]!,
            to: nodeIds[1]!,
            label: 'juxtaposes',
          };
          if (
            !space.relations.some(
              (item) =>
                item.from === relation.from &&
                item.to === relation.to &&
                item.label === relation.label,
            )
          )
            space.relations.push(relation);
          space.lineage.push({
            id: randomBytes(8).toString('hex'),
            at: new Date().toISOString(),
            verb: 'Materials held together',
            detail: `${nodes[0]!.title} ↔ ${nodes[1]!.title}`,
            nodeIds,
          });
        } else return json(400, { error: 'Unknown creative gesture' });
        return json(200, { space });
      }
      if (request.method === 'POST' && request.url === '/api/conversation') {
        if (!space) return json(409, { error: 'The material is still arriving' });
        const input = await body(request);
        const nodeId = String(input.nodeId ?? '');
        const prompt = String(input.prompt ?? '').trim();
        const perspective = String(input.perspective ?? '') as PerspectiveId;
        const node = space.nodes.find((item) => item.id === nodeId);
        if (!node) return json(404, { error: 'Material node not found' });
        if (!['archivist', 'contrarian', 'metaphorist'].includes(perspective))
          return json(400, { error: 'Unknown perspective' });
        if (prompt.length < 3)
          return json(400, { error: 'Give the material a little more to work with' });
        const conversation = {
          id: randomBytes(8).toString('hex'),
          at: new Date().toISOString(),
          perspective,
          nodeId,
          prompt,
          response: perspectiveResponse(perspective, node, prompt),
        };
        space.conversations.push(conversation);
        space.lineage.push({
          id: randomBytes(8).toString('hex'),
          at: conversation.at,
          verb: `${perspective} entered the material`,
          detail: prompt,
          nodeIds: [nodeId],
        });
        return json(200, { space, conversation });
      }
      if (request.method === 'POST' && request.url === '/api/spark') {
        if (!space) return json(409, { error: 'The material is still arriving' });
        const input = await body(request);
        const seed = String(input.seed ?? '').trim();
        const nodeIds = Array.isArray(input.nodeIds) ? input.nodeIds.map(String).slice(0, 3) : [];
        const perspective = String(input.perspective ?? '') as PerspectiveId;
        const nodes = nodeIds.map((id) => space!.nodes.find((node) => node.id === id));
        if (seed.length < 8) return json(400, { error: 'Give the Spark a clearer seed question' });
        if (nodes.length < 2 || nodes.some((node) => !node))
          return json(400, { error: 'Gather at least two different fragments' });
        if (!['archivist', 'contrarian', 'metaphorist'].includes(perspective))
          return json(400, { error: 'Choose a studio perspective' });
        const spark = createSpark(
          randomBytes(8).toString('hex'),
          seed,
          perspective,
          nodes as NonNullable<(typeof nodes)[number]>[],
        );
        space.sparks.push(spark);
        space.lineage.push({
          id: randomBytes(8).toString('hex'),
          at: spark.at,
          verb: 'Spark formed',
          detail: spark.title,
          nodeIds,
        });
        return json(200, { space, spark });
      }
      if (request.method === 'POST' && request.url === '/api/spark/save') {
        if (!space) return json(409, { error: 'The material is still arriving' });
        const input = await body(request);
        const spark = space.sparks.find((item) => item.id === String(input.sparkId ?? ''));
        if (!spark) return json(404, { error: 'Spark not found' });
        spark.saved = true;
        space.lineage.push({
          id: randomBytes(8).toString('hex'),
          at: new Date().toISOString(),
          verb: 'Spark kept for incubation',
          detail: spark.title,
          nodeIds: spark.nodeIds,
        });
        return json(200, { space, spark });
      }
      if (request.method === 'POST' && request.url === '/api/revision') {
        if (!work) return json(409, { error: 'No editorial Work is active' });
        const input = await body(request);
        const snapshot = await work.snapshot();
        const { interaction, studio } = editorialStudio(snapshot);
        if (!interaction || interaction.type !== 'approval' || !studio)
          return json(409, { error: 'The draft is not awaiting editorial review' });
        if (input.baseWorkId !== work.id)
          return json(409, {
            error: 'The draft changed while you were editing; reload before saving',
          });
        const draft = Array.isArray(input.draft) ? input.draft.map(String) : [];
        const nextRevision: EditorialRevision = {
          revision: revision + 1,
          title: String(input.title ?? ''),
          dek: String(input.dek ?? ''),
          selectedOutline: String(input.selectedOutline ?? ''),
          draft,
        };
        await work.respond(interaction.id, false);
        revision = nextRevision.revision;
        await start(studio.brief, nextRevision);
        return json(202, { accepted: true, workId: work!.id, revision });
      }
      if (request.method === 'POST' && request.url === '/api/approval') {
        if (!work) return json(409, { error: 'No editorial Work is active' });
        const input = await body(request);
        const snapshot = await work.snapshot();
        const interaction = snapshot.interactions.find((item) => item.type === 'approval');
        if (!interaction) return json(409, { error: 'No approval is pending' });
        if (typeof input.value !== 'boolean')
          return json(400, { error: 'Approval value must be boolean' });
        await work.respond(interaction.id, input.value);
        return json(202, { accepted: true });
      }
      if (request.method === 'POST' && request.url === '/api/reset') {
        if (work && !['completed', 'failed', 'canceled'].includes((await work.snapshot()).status))
          return json(409, { error: 'The current Work is still active' });
        work = null;
        revision = 0;
        space = null;
        return json(200, { reset: true });
      }
      return json(404, { error: 'Not found' });
    } catch (error) {
      return json(400, { error: error instanceof Error ? error.message : 'Request failed' });
    }
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No local address');
  origin = `http://127.0.0.1:${address.port}`;
  return {
    url: origin,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeIdleConnections();
      }),
  };
}
