import { createHash, randomBytes } from 'node:crypto';
import Database from 'better-sqlite3';
import {
  editorialTrails,
  firstObjectId,
  objectIds,
  worldCopy,
  worldId,
  type WorldObject,
} from './world.js';

const token = () => randomBytes(24).toString('base64url');
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const allowed = new Set<number>(objectIds);

export interface VisitorAuth {
  readonly visitorId: string;
  readonly visitorToken: string;
}

export interface VisitorRow {
  readonly id: string;
  readonly name: string;
  readonly session_id: string | null;
  readonly current_object_id: number;
  readonly last_seen: number;
}

export class WorldStore {
  private readonly db: Database.Database;

  constructor(path: string) {
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS visitors (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, token_hash TEXT UNIQUE NOT NULL,
        session_id TEXT, current_object_id INTEGER NOT NULL, joined_at INTEGER NOT NULL,
        last_seen INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS visits (
        id INTEGER PRIMARY KEY AUTOINCREMENT, visitor_id TEXT NOT NULL REFERENCES visitors(id),
        object_id INTEGER NOT NULL, visited_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS interpretations (
        id TEXT PRIMARY KEY, visitor_id TEXT NOT NULL REFERENCES visitors(id),
        object_id INTEGER NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS connections (
        id TEXT PRIMARY KEY, visitor_id TEXT NOT NULL REFERENCES visitors(id),
        from_object_id INTEGER NOT NULL, to_object_id INTEGER NOT NULL,
        label TEXT NOT NULL, created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS reactions (
        id TEXT PRIMARY KEY, visitor_id TEXT NOT NULL REFERENCES visitors(id),
        trigger_id TEXT NOT NULL, body TEXT NOT NULL, object_ids TEXT NOT NULL,
        sources TEXT NOT NULL, work_id TEXT NOT NULL, created_at INTEGER NOT NULL
      );
    `);
  }

  enter(rawName: string): VisitorAuth {
    const name = rawName.trim().replace(/\s+/g, ' ').slice(0, 32);
    if (name.length < 2) throw new Error('Choose a name with at least two characters');
    const visitorId = `visitor_${randomBytes(9).toString('base64url')}`;
    const visitorToken = token();
    const now = Date.now();
    this.db
      .prepare('INSERT INTO visitors VALUES(?,?,?,?,?,?,?)')
      .run(visitorId, name, hash(visitorToken), null, firstObjectId, now, now);
    this.db
      .prepare('INSERT INTO visits(visitor_id,object_id,visited_at) VALUES(?,?,?)')
      .run(visitorId, firstObjectId, now);
    return { visitorId, visitorToken };
  }

  authenticate(visitorToken: string): VisitorRow {
    const visitor = this.db
      .prepare(
        'SELECT id,name,session_id,current_object_id,last_seen FROM visitors WHERE token_hash=?',
      )
      .get(hash(visitorToken)) as VisitorRow | undefined;
    if (!visitor) throw new Error('Your path through this world could not be found');
    return visitor;
  }

  setSession(visitorId: string, sessionId: string): void {
    this.db
      .prepare('UPDATE visitors SET session_id=? WHERE id=? AND session_id IS NULL')
      .run(sessionId, visitorId);
  }

  priorVisits(visitorId: string): number[] {
    return (
      this.db
        .prepare('SELECT object_id FROM visits WHERE visitor_id=? ORDER BY id DESC LIMIT 20')
        .all(visitorId) as { object_id: number }[]
    ).map((row) => row.object_id);
  }

  echoesSince(visitor: VisitorRow, objectId: number): string[] {
    return (
      this.db
        .prepare(
          `SELECT body FROM interpretations
           WHERE visitor_id<>? AND created_at>? AND object_id=?
           ORDER BY created_at DESC LIMIT 8`,
        )
        .all(visitor.id, visitor.last_seen, objectId) as { body: string }[]
    ).map((row) => row.body);
  }

  markSeen(visitorId: string): void {
    this.db.prepare('UPDATE visitors SET last_seen=? WHERE id=?').run(Date.now(), visitorId);
  }

  wander(visitorId: string, objectId: number): void {
    this.assertObject(objectId);
    const now = Date.now();
    const transaction = this.db.transaction(() => {
      this.db
        .prepare('UPDATE visitors SET current_object_id=?,last_seen=? WHERE id=?')
        .run(objectId, now, visitorId);
      this.db
        .prepare('INSERT INTO visits(visitor_id,object_id,visited_at) VALUES(?,?,?)')
        .run(visitorId, objectId, now);
    });
    transaction();
  }

  interpret(visitorId: string, objectId: number, rawBody: string): string {
    this.assertObject(objectId);
    const body = this.cleanWords(rawBody, 360);
    const id = `thought_${randomBytes(9).toString('base64url')}`;
    this.db
      .prepare('INSERT INTO interpretations VALUES(?,?,?,?,?)')
      .run(id, visitorId, objectId, body, Date.now());
    return id;
  }

  connect(visitorId: string, from: number, to: number, rawLabel: string): string {
    this.assertObject(from);
    this.assertObject(to);
    if (from === to) throw new Error('A trail needs two different objects');
    const label = this.cleanWords(rawLabel, 120);
    const id = `trail_${randomBytes(9).toString('base64url')}`;
    this.db
      .prepare('INSERT INTO connections VALUES(?,?,?,?,?,?)')
      .run(id, visitorId, from, to, label, Date.now());
    return id;
  }

  rememberReaction(input: {
    visitorId: string;
    triggerId: string;
    text: string;
    objectIds: readonly number[];
    sources: unknown;
    workId: string;
  }): void {
    this.db
      .prepare('INSERT INTO reactions VALUES(?,?,?,?,?,?,?,?)')
      .run(
        `reaction_${randomBytes(9).toString('base64url')}`,
        input.visitorId,
        input.triggerId,
        input.text,
        JSON.stringify(input.objectIds),
        JSON.stringify(input.sources),
        input.workId,
        Date.now(),
      );
  }

  companionObject(objectId: number, seed: string): number {
    const others = objectIds.filter((candidate) => candidate !== objectId);
    return others[createHash('sha256').update(seed).digest()[0]! % others.length]!;
  }

  state(visitorId: string, objects: readonly WorldObject[], mode: string, perspective?: unknown) {
    const visitor = this.db
      .prepare('SELECT id,name,current_object_id FROM visitors WHERE id=?')
      .get(visitorId) as { id: string; name: string; current_object_id: number } | undefined;
    if (!visitor) throw new Error('Visitor not found');
    const visitors = this.db
      .prepare(
        `SELECT v.id,v.name,v.current_object_id,MAX(vi.visited_at) active_at
         FROM visitors v LEFT JOIN visits vi ON vi.visitor_id=v.id
         GROUP BY v.id ORDER BY active_at DESC LIMIT 16`,
      )
      .all();
    const interpretations = this.db
      .prepare(
        `SELECT i.id,i.object_id,i.body,i.created_at,v.name visitor_name
         FROM interpretations i JOIN visitors v ON v.id=i.visitor_id
         ORDER BY i.created_at DESC LIMIT 80`,
      )
      .all();
    const communityTrails = this.db
      .prepare(
        `SELECT c.id,c.from_object_id "from",c.to_object_id "to",c.label,c.created_at,
                v.name visitor_name,'visitor' origin
         FROM connections c JOIN visitors v ON v.id=c.visitor_id
         ORDER BY c.created_at DESC LIMIT 60`,
      )
      .all();
    const reactions = (
      this.db
        .prepare(
          `SELECT r.id,r.body,r.object_ids,r.sources,r.work_id,r.created_at,v.name visitor_name
           FROM reactions r JOIN visitors v ON v.id=r.visitor_id
           ORDER BY r.created_at DESC LIMIT 30`,
        )
        .all() as { object_ids: string; sources: string; [key: string]: unknown }[]
    ).map((row) => ({
      ...row,
      objectIds: JSON.parse(row.object_ids),
      sources: JSON.parse(row.sources),
      object_ids: undefined,
    }));
    const visits = this.priorVisits(visitorId);
    return {
      world: { id: worldId, ...worldCopy },
      visitor: { id: visitor.id, name: visitor.name },
      mode,
      selectedObjectId: visitor.current_object_id,
      objects,
      facets: {
        people: [
          ...new Set(
            objects.map((item) => item.maker).filter((name) => name !== 'Maker unrecorded'),
          ),
        ],
        places: [...new Set(objects.map((item) => item.place))],
        motifs: [...new Set(objects.flatMap((item) => item.motifs))],
      },
      visitors,
      visits,
      interpretations,
      connections: [...editorialTrails, ...communityTrails],
      reactions,
      perspective: perspective ?? null,
    };
  }

  close(): void {
    this.db.close();
  }

  private assertObject(objectId: number): void {
    if (!allowed.has(objectId)) throw new Error('That object is outside this constellation');
  }

  private cleanWords(value: string, maximum: number): string {
    const clean = value.trim().replace(/\s+/g, ' ').slice(0, maximum);
    if (clean.length < 3) throw new Error('Leave at least a few words');
    return clean;
  }
}
