# Core data structures

This page maps the types in `packages/harngine/src/core/`. It shows which fields hold another
value, which fields hold an ID or reference, and where a type has several forms. The code is the
source for exact field definitions.

The tables distinguish a value held in a field from an ID that only points to another value.

## IDs

The current core types do not give every ID its own TypeScript name:

| ID | Current type | Who chooses it |
| --- | --- | --- |
| Work and Session | `WorkId` and `SessionId` | Harngine; values start with `work_` and `session_` |
| Request | `RequestId` | The caller or Harngine; this is a branded string |
| Control token | `ControlToken` | Harngine; this is a branded string |
| Call, Attempt, Input, and Wait | `string` | Harngine; generated values use distinct prefixes |
| Definition, Tool, model, and guardrail | `string` inside an identity or reference | The caller or provider |

`WaitRef.id` can identify either a reply wait or an approval wait.

The remaining types named `Ref` hold different kinds of data. Session APIs use `SessionId`
directly; they no longer wrap it in `{ id }`.

| Type | Fields | What the extra fields do |
| --- | --- | --- |
| `DefinitionRef` | Definition `type`, `id`, `revision` | The revision selects an exact definition version |
| `WorkRef` | Work `id`, definition identity | The definition is a separate binding check; the Work ID already identifies the run |
| `WaitRef` | Wait `id`, owning `workId` | The Work ID checks scope; it does not change the Wait ID |

`Artifact` has an application ID, digest, media type, and size. It describes external content;
the bytes stay in application storage.

## Definitions and model providers

`Agent`, `Workflow`, and `Tool` are executable definitions. Each has an `Identity` with an ID
and version. A Workflow holds Tool and child identities. Its `decide` function takes a `View`
and returns a `Proposal`. An Agent holds its model and Tool identities.

There are two model call contracts:

| Contract | Input | Result | Used by |
| --- | --- | --- | --- |
| `AgentModel` | `AgentModelInput` with `AgentContextItem[]` | `Outcome` | The engine Agent protocol and its test fixtures |
| `ModelAdapter` | `ModelRequest` containing `ModelContext` | `ModelResponse` with `ModelItem[]` | Provider integrations for authored Agents |

`AgentContextSource` traces an item in `AgentModelInput`. `ContextSource` traces an item in
the provider's `ModelContext`. The names mark different stages of execution, even where the
items describe similar evidence. `ModelContext.artifacts` lists Artifact metadata found in the
selected objective and context items; it does not contain the external content bytes.

`core/definition.ts` defines `ToolCapabilities` once for Tool definitions and operations. When
authoring a write Tool, `ToolDefinition.capabilities` accepts the write promises; Harngine fills
in reconciliation from whether the Tool supplies `reconcile()`. A read Tool gets repeatable
invocation capabilities automatically.

Callers see `AgentDescription`, `WorkflowDescription`, or `ToolDescription`. This is the
`DefinitionDescription` union. Each description has `object: 'definition'` and a `type` of
`agent`, `workflow`, or `tool`. Its Tool and child lists hold `DefinitionRef` values with
an ID and exact revision. `DefinitionRegistration` stores a registered revision and its
availability.

These descriptions are read views of registered definitions. `AgentDefinition`,
`WorkflowDefinition`, and `ToolDefinition` are the inputs used to build executable definitions;
the descriptions contain display data and availability instead of the functions that run them.

| Type with variants | Forms |
| --- | --- |
| `DefinitionDescription` | Agent, Workflow, Tool |
| `Proposal` | `call`, `child`, `children`, `join`, `complete`, `fail`, `wait` |
| `ModelItem` | `text`, `tool-call`, `data` |
| `AgentContextItem` | `input`, `result`, `output`, `reference`, `tool_outcome`, `child_outcome`, `reply`, `summary` |
| `ContextItem` | `input`, `result`, `output`, `reference`, `tool_outcome`, `child_outcome`, `reply`, `summary` |
| `AgentContextSource` and `ContextSource` | `work_context`, `work_input`, `work_call`, `work_child`, `reply` |
| `ModelFinishReason` | `stop`, `tool-calls`, `length`, `content-filter`, `other` |

`ContextPolicy` selects `ContextCandidate` values to build `ModelContext`. `ContextConfiguration`
sets the session, token budget, and selection policy. `ModelCapabilities` and
`ModelInputModality` describe what a provider accepts. `ModelUsage`, `ModelProgress`, and
`ModelDelta` report usage and live progress; a delta is temporary and is not saved history.
`AgentTool` is the Tool description inside `AgentModelInput`. `AnyAgent`, `AnyWorkflow`,
and `AnyTool` are general type aliases for definitions whose JSON types are not known at compile
time. `DefinitionType` names the three definition forms; `ExecutableDefinitionRef` limits
a reference to Agent or Workflow. `GuardrailDescription` lists a guardrail's stages.

## Work and operations

`Work` is the core entity for a run. The application exposes a `WorkHandle` with methods such
as `snapshot()`, `result()`, and `cancel()`. Other shapes describe the same run for different
readers:

| Shape | Contains | Used for |
| --- | --- | --- |
| `Work` | `WorkRef`, objective, status, closure, Session and parent IDs, child IDs | Current run metadata assembled by the engine |
| `WorkSummary` | Work ID, exact `DefinitionRef`, objective, status, related IDs, times | Short public read view |
| `WorkSnapshot` | `WorkSummary` plus result or error, `Interaction[]`, usage, limits, waiting reason | Public Work state |
| `ExecutionSnapshot` | State, Calls, Approvals, Waits, Inputs, limits, usage, closure | Engine state |
| `View` | Current objective and state, maps of Calls, child records, Waits, and Inputs | Input to a Workflow decision |
| `ChildWorkRecord` | Child call, `WorkRef`, objective, mode, status, closure | Link from a parent decision to child Work |

`WorkRef` holds a Work ID and the definition identity used to check the binding. It does not
embed a `Work`. A `Call` holds a Tool identity and an `Outcome`, when settled. A
`WorkSnapshot` holds public `Interaction` values, rather than engine Calls or Waits.

`Work` is assembled from the saved `work` row and related rows; it is not itself a SQLite
row. `Interaction` lives in `core/interaction.ts` with approval, reply, wait, and input types.

| Type with variants | Forms |
| --- | --- |
| `WorkStatus` | `queued`, `running`, `waiting`, `completed`, `failed`, `canceled` |
| `Interaction` | `question`, `approval` |
| `Outcome` | `success`, `failure`, `unknown` |
| `ReconciliationResult` | `success`, `failure`, `not-applied`, `unknown` |
| `Closure` | `completed`, `failed`, `canceled` |
| `Receipt` | `accepted`, `rejected`, `conflict` |
| `WatchedUpdate` | Durable item with an ID, or temporary item without one |
| `ToolCapabilities` | Read with repeatable invocation, or write with idempotency, reconciliation, and reversibility settings |
| `EffectResolution` | `success`, `failure`, `not-applied`; defined once in `operation.ts` |

`Call` contains a Tool identity, input, status, and optional outcome. `Tool` contains input
and output schemas and the functions that invoke or reconcile an external operation.
`ResolveEffectRequest`, `EffectResolution`, and `EffectResolutionAcceptance` describe a manual
resolution when an effect is uncertain. `CancelRequest`, `ReviseRequest`, and `ControlAcceptance`
carry Work control changes. `WorkUpdate` wraps a `WorkSnapshot` for watching changes. `Watch`
holds the current value and an update stream. `ExecutionPolicy` is the full limit policy on an
executable definition and engine snapshot. `ExecutionLimits` contains optional limits a caller
can set for one run.

## Sessions, inputs, and waits

| Shape | Main relationships |
| --- | --- |
| `SessionState` | Exact Agent `DefinitionRef`; foreground Work ID; queued Work IDs |
| `SessionSnapshot` | Extends `SessionState`; recent `Message[]`; foreground `WorkSnapshot` |
| `ExecutionSessionSnapshot` | Agent identity; foreground and queued `WorkRef` values |
| `SessionHistory` | Ordered `SessionEntry[]`; each entry contains Session content or a handoff |
| `Approval` and `Wait` | Each holds a `WaitRef` with the wait ID and owning Work ID |

`SessionHandoff` records an Agent change. `SessionEntry` is one history entry;
`SessionHistory` pages through those entries.

| Type with variants | Forms |
| --- | --- |
| `SessionContent` | `input`, `output`, `work`, `result` |
| `SessionEntry.entry` | Session content, a result with closure, or `handoff` |
| `WaitPlan` | `reply`, `timer`, `existing`, `all`, `any` |
| `InputDisposition` | `incorporated`, `ignored` |

`SessionCreate`, `SessionSend`, `SessionRecord`, `SessionClose`, and `SessionHandoffRequest` are
commands. Their acceptance and change types report the new version, cursor, or Work reference.
`SessionId`, `SessionVersion`, `SessionCursor`, `SessionReceipt`, and `SessionHistoryOptions`
support those commands and history reads. `SessionUpdate` carries a new snapshot.
`SessionHandoffOptions`, `SessionSendAcceptance`, `SessionHandoffAcceptance`, `SessionChange`,
and `SessionRecordAcceptance` carry options and accepted changes.

`InputPolicy` sets input schema and queue limits. `InputRequest`, `InputAcceptance`, and
`Input` describe submitted input. `ApprovalPolicy`, `ApprovalReply`,
`ApprovalAcceptance`, and `Approval` describe approvals. `ReplyRequest` and
`ReplyAcceptance` cover replies to waits. `WaitRef` identifies a wait; `Wait` holds its
current state.

`SessionUpdate.event` has `message.appended`, `ownership.changed`, `work.updated`, and
`session.closed` forms. `Wait.kind` is `reply` or `timer`; its status records whether
it is pending, replied, expired, fired, or withdrawn.

## Read views and shared values

| Read shape | Main relationships |
| --- | --- |
| `InspectionPage` | Public `WorkSnapshot` and ordered `InspectionEntry[]` |
| `CallInspection` | Extends `Call` with summaries of its Attempts |
| `AuditPage` | `AuditEntry[]` derived from committed history |
| `AuditEntry` | `AuditCorrelation` IDs for related Work, Session, Call, Attempt, or Interaction |

`InspectionEntry` has nine forms: `work.started`, `input`, `decision`, `call`, `model.progress`,
`guardrail`, `interaction`, `child`, and `work.closed`. Each is a read view built from saved execution history.
`CallInspection` adds Attempt summaries to `Call`. `DecisionInspection` gives the decision
and its proposal. `WorkEvent` and `WorkHistory` expose raw Work history by cursor.
`DiagnosticRecord` and `DiagnosticPage` expose diagnostic data. `InspectionPresentation`,
`WorkHistoryOptions`, and `InspectionPage` support these reads.

The nine `InspectionEntry` forms are `WorkStartedInspectionEntry`, `InputInspectionEntry`,
`DecisionInspectionEntry`, `CallInspectionEntry`, `ModelProgressInspectionEntry`,
`GuardrailInspectionEntry`, `InteractionInspectionEntry`, `ChildInspectionEntry`, and
`WorkClosedInspectionEntry`. Their `type` fields match the event names above.

`AuditEntry` is a read-only summary derived from committed history. Its `AuditCorrelation` holds IDs,
and its `AuditTarget` identifies a definition. `AuditQuery`, `AuditPage`, `AuditRetention`,
`AuditOptions`, `AuditRedactor`, `AuditExportOptions`, and `AuditExportSink` control reading and
export. `AuditExportBatch` has JSON and OpenTelemetry forms. `AuditCategory` includes Work,
decision, authorization, guardrail, Attempt, Interaction, and Session.

`GuardrailResult` has `allow`, `redact`, and `block` forms. The guardrail stage can be model
input, model output, Tool input, or Tool output. `ModelProgress.type` has `started`,
`reasoning`, and `completed` forms. `AuditExportBatch` is `JsonAuditExport` or
`OtelAuditExport`.

| Core file | Other types and their role |
| --- | --- |
| `types.ts` | `Json`, `Schema`, `Identity`, `WorkId`, `SessionId`, `RequestId`, `ControlToken`, `ObjectiveRevision`, `ProgressCursor`, `Reason`, `RuntimeError`, and the `requestId` helper |
| `artifact.ts` | `Artifact`, `ArtifactInput`, `createArtifact`, and `findArtifacts` for finding references inside JSON |
| `guardrail.ts` | `Guardrail`, `GuardrailDescription`, `GuardrailSubject`, `GuardrailResult`, `GuardrailReason`, `GuardrailDecision`, `GuardrailRun`, and `GuardrailStage` |
| `telemetry.ts` | `TelemetryEvent` and `TelemetrySink` for runtime measurements |
| `errors.ts` | `PublicError`, `HarngineError`, `ValidationError`, `NotFoundError`, `UnauthorizedError`, `ConflictError`, `UnavailableError`, `WorkFailedError`, `WorkCanceledError`, and `ToolCallError` |
| `definition.ts` | The shared `ToolCapabilities` and `WriteToolCapabilities` types, definition references, and Agent, Workflow, and Tool descriptions |
| `execution.ts` | Re-exports execution types from other core files; it defines no new entity |

The `object` field names the data shape, such as `work` or `definition`. A `type` field chooses
a variant within a shape, such as Agent versus Tool. Some engine records use `kind` for their
own stored category. These fields have different jobs.
