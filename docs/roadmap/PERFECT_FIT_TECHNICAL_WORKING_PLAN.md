# PERFECT_FIT_TECHNICAL_WORKING_PLAN

Status: **ACTIVE IMPLEMENTATION PLAN**

Canonical architecture: `docs/architecture/PERFECT_FIT_TECHNICAL_INTEGRATION_CANON.md`

Working model: `docs/architecture/PERFECT_FIT_TECHNICAL_WORKING_MODEL.md`

## Principle

Build one connected element at a time.

Each completed element must be usable immediately and must also become a stable dependency for the next element.

## Phase A — Foundation

### A1. Workspace shell

Status: substantially available

- Project → Style → Variant hierarchy
- metadata-driven module navigation
- Base Reference Size
- stable human references
- single Workspace metadata source
- module registry
- frontend persistence foundation

### A2. Media

Status: functional frontend foundation

- persistent Media workstation
- image upload/edit/crop
- Media references
- Primary / Technical Sketch / Pattern Preview roles
- customer visibility
- compact inspector
- thumbnail navigation
- image persistence strategy

Do not expand Media further until another module genuinely requires it.

## Phase B — Pattern Library

### B1. Neutral data model

Build first.

Required objects:

- Pattern Revision
- Pattern File
- Master Pattern designation
- authoritative/supporting designation
- source provider/provenance
- format
- Base Reference Size linkage
- Size Set
- Size Set physical file
- completeness state

No live CLO API yet.

### B2. Pattern Library UI

Build one compact workstation:

```text
Pattern Library                         [?] [+ Add Pattern File]

Revision R001   Base M   Source Manual/CLO   Status Draft

[ Master Pattern ] [ Size Sets ] [ Other Files ]

┌──────────────────────────────────────┬──────────────────────────┐
│ technical file/set list             │ selected item inspector  │
└──────────────────────────────────────┴──────────────────────────┘
```

Required interactions:

- add file
- choose technical format
- identify source provider
- assign/create revision
- mark authoritative/supporting
- replace file
- download file
- remove file
- technical notes
- status
- selected item inspector

### B3. CLO-hosting proof

Manual proof before API integration:

1. Export/save a real pattern file from CLO.
2. Upload it into Pattern Library.
3. Assign it to Variant and Revision R001.
4. Set source provider to CLO.
5. Set Base Reference Size.
6. Mark authoritative master where appropriate.
7. Reload Workspace and verify persistence.
8. Download and verify the governed source file.

Success condition:

> Perfect Fit can reliably host a real CLO-originated technical pattern source without knowing how it arrived.

### B4. Size Set model

After B3 passes:

- expected size range from Variant
- one Size Set per available format/output profile
- combined-file and per-size-file packaging
- coverage indicator
- missing-size detection
- complete/incomplete state
- revision linkage

Do not create independent disconnected size-file structures.

## Phase C — CLO adapter proof

Start only after the Pattern Library local workflow is stable.

### C1. Integration contract

Define neutral provider capability interface.

Initial CLO adapter capabilities to investigate/implement in controlled increments:

- identify connected CLO installation/plugin
- identify EIP user/tenant
- identify Project/Style/Variant
- pull/open technical source
- push a pattern source/revision
- read grading size information
- later POM/BOM/3D/render capabilities

### C2. Python CLO plugin prototype

- Python plug-in running inside CLO
- authenticated HTTPS calls to Fastify
- no browser → Python direct path
- no competing business logic in Python

First transaction:

```text
CLO
  ↓ push one pattern source
Fastify
  ↓
Existing EIP Pattern Library object
```

The Pattern Library must not require redesign for this step.

### C3. Sync provenance

Add controlled sync state:

- provider
- external reference
- source revision
- last sync
- direction
- hash/fingerprint
- status

Keep these fields contextual in UI.

## Phase D — Technical enrichment

Implement only after the pattern/revision chain is stable.

### D1. Measurements / POM

- import/enter measurement specification
- size linkage
- tolerances
- revision linkage
- comparison
- QC-ready output

### D2. BOM

- technical material list
- map to EIP materials
- retain unmatched imported items
- colorway linkage
- supplier/material enrichment later

### D3. 3D / fit / render

- source 3D derivative
- protected EIP web viewer
- technical renders
- fit evidence
- later animation and AI/marketing derivatives

## Phase E — Sewing and industrialization

### E1. Sewing construction

- construction relationships
- instruction sequence
- technical references

### E2. Operation bulletin

- operation
- sequence
- machine
- attachment
- skill
- SAM/SMV
- QC checkpoint
- precedence

Connected to, but not confused with, CAD seam definitions.

## Phase F — Marker and cutting

### F1. Neutral Marker Plan

- size ratio
- colorway ratio
- fabric width
- direction/nap rules
- buffers
- marker status
- engine provenance

### F2. Engine integration

CLO may be one available nesting engine.

Prepare the same contract for:

- Gerber
- Richpeace
- Optitex
- Lectra
- other engines

### F3. Industrial cut planning

Later:

- rolls
- shade lots
- defects
- plies
- lay plan
- cut order
- bundle plan
- remnants

## Phase G — BOQ, costing and production

- BOM + order + consumption → BOQ
- stock and supplier coverage
- purchasing requirement
- material cost
- labor cost
- total cost
- production-release dependencies

## Change discipline

For every implementation:

1. Confirm the domain position in the full dependency graph.
2. Implement only the next usable slice.
3. Avoid provider hardcoding in the core object model.
4. Preserve metadata/provenance needed by future connectors.
5. Test persistence and lifecycle before adding the next domain.
6. Do not build downstream automation while upstream technical truth is unstable.

## Current task

**B1 + B2: Prepare Pattern Library to host the first real pattern file exported from CLO.**

Do not start CLO API/plugin work until this succeeds manually.
