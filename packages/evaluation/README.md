# Evaluation companion

`@harngine/evaluation` measures existing Harngine Work without creating another execution model.
It captures public inspection evidence for a Work tree, derives usage and outcome metrics, and runs
application-defined scorers. It never changes Work state and does not close the App.

```ts
import { evaluationCase, runEvaluation } from '@harngine/evaluation';
import { workflow, type App } from 'harngine';

const double = workflow({
  id: 'example.double',
  objective: {
    id: 'example.number',
    version: '1',
    jsonSchema: { type: 'integer' },
  },
  result: {
    id: 'example.number',
    version: '1',
    jsonSchema: { type: 'integer' },
  },
  run: (value) => value * 2,
});

export async function benchmark(app: App) {
  const report = await runEvaluation(app, [
    evaluationCase({
      id: 'double-four',
      definition: double,
      objective: 4,
      score: ({ result, metrics }) => ({
        score: result === 8 ? 1 : 0,
        passed: result === 8,
        label: 'exact answer',
        details: { calls: metrics.calls },
      }),
    }),
  ]);
  return report;
}
```

The report includes the root Work and all attached child Work, story inspection entries, exact
definition revisions, outcome, logical model/Tool usage, child Call phases, Interactions, and any
model token usage recorded by the adapter. A model adapter may also include per-turn cost in its
completed progress event; the companion aggregates amounts by currency.

`captureWorkTrace()` and `summarizeWorkTrace()` are available when an application wants the same
evidence and metrics without the case runner. Capture is bounded and marks a truncated trace as
incomplete so partial evidence is not reported as a conclusive benchmark.

Story evidence is the default. Set `{ evidence: { detail: 'diagnostic' } }` only when the evaluation
report is authorized to retain recorded model requests, responses, and Tool payloads. Scorers are
application code; their exceptions become `evaluationError` results and cannot modify Work.

This package does not provide a hosted dataset service, annotation UI, statistical experiment
design, semantic judge, or OpenTelemetry exporter. Keep benchmark inputs and expected answers with
the application, and persist or redact the JSON report according to its data policy.
