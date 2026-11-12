# Retrieval Tool bridge

`@harngine/retrieval` exposes a retriever as a recorded read Tool. The retriever chooses its index, ranking method, and storage backend.

```ts
import { retrievalTool, unknownCitations } from '@harngine/retrieval';

const search = retrievalTool({
  id: 'my-app.search-docs',
  description: 'Find relevant documentation passages',
  retriever: {
    async search(query, { limit, signal }) {
      // Query your index and return at most `limit` passages.
      return [{
        source: 'docs://guide',
        version: 'sha256:example',
        text: `Result for ${query}`,
      }];
    },
  },
});
```

Each passage must have a stable `source`, a `version` or content digest, and `text`. The Tool records these fields with the result so a later answer can identify the evidence it used. The package does not ingest documents, compute embeddings, or maintain a vector index.

When an answer includes `{ source, version }` citations, pass them to `unknownCitations(citations, retrievedPassages)`. It returns the citations that do not match evidence retrieved for that answer, which lets the application reject or repair an invented citation before delivery.
