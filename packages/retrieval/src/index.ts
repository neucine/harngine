import { schema, tool, type Tool } from 'harngine';

export type RetrievedPassage = {
  /** Stable source identity, such as a document URI. */
  source: string;
  /** Version or content digest of the source at retrieval time. */
  version: string;
  text: string;
  title?: string;
  location?: string;
  score?: number;
};

export interface Retriever {
  search(
    query: string,
    options: { limit: number; signal: AbortSignal },
  ): Promise<readonly RetrievedPassage[]>;
}

export type Citation = { source: string; version: string };

/** Return citations that do not match a passage retrieved for this answer. */
export function unknownCitations(
  citations: readonly Citation[],
  passages: readonly RetrievedPassage[],
): Citation[] {
  const known = new Set(passages.map((passage) => `${passage.source}\0${passage.version}`));
  return citations.filter((citation) => !known.has(`${citation.source}\0${citation.version}`));
}

export interface RetrievalToolOptions {
  /** Stable Harngine ID, included in the generated definition manifest. */
  id: string;
  description: string;
  retriever: Retriever;
  maxResults?: number;
}

/** Expose retrieval as a recorded read Tool with source provenance. */
export function retrievalTool(
  options: RetrievalToolOptions,
): Tool<{ query: string; limit?: number }, { passages: RetrievedPassage[] }> {
  const maxResults = options.maxResults ?? 10;
  if (!Number.isSafeInteger(maxResults) || maxResults < 1 || maxResults > 100)
    throw new Error('maxResults must be an integer from 1 to 100');
  return tool({
    id: options.id,
    description: options.description,
    input: schema<{ query: string; limit?: number }>({
      id: `${options.id}.input`,
      version: '1',
      jsonSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['query'],
        properties: {
          query: { type: 'string', minLength: 1 },
          limit: { type: 'integer', minimum: 1, maximum: maxResults },
        },
      },
    }),
    output: schema<{ passages: RetrievedPassage[] }>({
      id: `${options.id}.output`,
      version: '1',
      jsonSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['passages'],
        properties: {
          passages: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['source', 'version', 'text'],
              properties: {
                source: { type: 'string', minLength: 1 },
                version: { type: 'string', minLength: 1 },
                text: { type: 'string' },
                title: { type: 'string' },
                location: { type: 'string' },
                score: { type: 'number' },
              },
            },
          },
        },
      },
    }),
    effect: 'read',
    async execute(input, context) {
      const passages = await options.retriever.search(input.query, {
        limit: input.limit ?? maxResults,
        signal: context.signal,
      });
      if (passages.length > (input.limit ?? maxResults))
        return context.fail({
          effect: 'none',
          code: 'RETRIEVAL_LIMIT',
          message: 'Retriever returned too many passages',
        });
      if (passages.some((item) => !item.source || !item.version || typeof item.text !== 'string'))
        return context.fail({
          effect: 'none',
          code: 'RETRIEVAL_PROVENANCE',
          message: 'Retriever returned a passage without source, version, or text',
        });
      return { passages: passages.map((passage) => ({ ...passage })) };
    },
  });
}
