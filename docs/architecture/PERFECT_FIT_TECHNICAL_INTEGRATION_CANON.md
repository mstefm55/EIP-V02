# PERFECT_FIT_TECHNICAL_INTEGRATION_CANON

Status: **LOCKED ARCHITECTURE**

This document defines the canonical role of Perfect Fit, EIP Core, EIP ERP, and external fashion-design / CAD / 3D / marker systems. It also defines the working model and implementation sequence for the Perfect Fit Workspace.

The architecture is holistic, but implementation is incremental. Every feature is built as one connected piece of a larger digital thread rather than as a standalone page or isolated tool.

---

## 1. Product roles

### 1.1 EIP Core

EIP Core is the durable system foundation and system of record.

It owns:

- tenant and identity governance
- authentication and authorization
- business objects and relationships
- workflow and process execution
- technical revision governance
- asset/document governance
- commercial and manufacturing data
- integration contracts
- audit and change history
- persistence

EIP Core must remain vendor-neutral.

It must understand concepts such as Pattern Revision, Size Set, Measurement Specification, BOM, BOQ, Marker Plan, Operation Bulletin, Tech Pack and Production Release without depending on CLO, Gerber, Richpeace, Optitex, Lectra or any other specific vendor.

### 1.2 Perfect Fit

Perfect Fit is currently the development-oriented frontend and Workspace/Sandbox application.

It provides a focused experience for:

- hobbyists
- freelance designers
- pattern makers
- garment technicians
- small fashion brands
- Perfect Fit development-service clients

Perfect Fit consumes EIP Core concepts and will progressively expose product-development functionality without exposing the entire ERP surface.

Perfect Fit is not a separate technical universe. Its Workspace is a focused UI over the same governed digital thread that EIP ERP will later expose to enterprise users.

### 1.3 EIP ERP UI

The full EIP ERP UI will later reuse or embed the same technical Workspace capabilities for brands and manufacturers that want product development, industrialization, planning and execution in one ERP environment.

The same style/variant/revision must therefore be usable through both:

- Perfect Fit Workspace
- EIP ERP technical/product-development surfaces

No redesign of the technical model should be required when the UI moves or is embedded into EIP ERP.

---

## 2. External technical software is an engine, not the system of record

CLO is the first major technical engine to be integrated, but EIP must never become structurally dependent on CLO.

The long-term integration layer must be ready for:

- CLO 3D
- Gerber / AccuMark
- Richpeace
- Optitex
- Lectra
- other CAD systems
- other marker/nesting systems
- other 3D/fitting/rendering engines
- specialist conversion and manufacturing engines

Canonical principle:

> EIP owns the governed business/technical object. External software owns specialist authoring or computation.

Examples:

- EIP owns `Pattern Revision R004`; CLO or Gerber may be the source/authoring engine.
- EIP owns a `Size Set`; CLO, Gerber, Richpeace or Optitex may generate its files.
- EIP owns a `Marker Plan`; CLO nesting or an industrial marker engine may generate or optimize it.
- EIP owns the BOM/BOQ relationship; CLO may supply technical BOM information while EIP enriches it with sourcing, stock, price and production data.

External software must therefore connect through adapters rather than leak its internal concepts throughout the Workspace.

---

## 3. Vendor-neutral adapter model

Each external technical connector must identify its provider and capabilities.

Conceptual capability contract:

```js
{
  provider: 'CLO',
  capabilities: {
    patternImport: true,
    patternExport: true,
    gradingRead: true,
    gradingWrite: true,
    measurementRead: true,
    bomRead: true,
    threeD: true,
    simulation: true,
    animation: true,
    rendering: true,
    nesting: true,
    productionMarker: false
  }
}
```

A different provider can expose a different capability matrix.

The permanent UI should therefore prefer neutral actions such as:

- Open in CAD
- Sync Pattern
- Generate Size Set
- Sync Measurements
- Sync BOM
- Generate Marker
- Generate Render
- Generate Outputs

Provider identity may be shown contextually, for example:

`Engine: CLO 2026`

but the core business action must remain provider-neutral.

---

## 4. CLO licensing and operating model

EIP does not share, sublicense or hide a CLO licence.

The locked commercial model is:

### 4.1 Perfect Fit development services

A licensed Perfect Fit operator may accept contracted garment-development work from clients and perform the technical work in CLO under the operator's valid CLO licence.

The client uses EIP/Perfect Fit to:

- submit and follow development work
- review revisions
- approve samples
- view synchronized technical data
- view 3D/media outputs
- receive governed deliverables

The client does not operate the Perfect Fit operator's CLO licence.

### 4.2 Freelance designers

A freelance designer who wants to author or edit in CLO connects their own eligible CLO licence and installation to Perfect Fit/EIP.

### 4.3 Brands and factories

A brand, studio or factory that wants CLO authoring uses its own appropriate CLO business licensing and connects that installation to EIP through the EIP/CLO adapter.

### 4.4 EIP-only users

Users who do not author in CLO should normally work entirely in EIP.

Examples:

- merchandisers
- buyers
- sourcing teams
- costing teams
- production planners
- industrial engineers
- cutting room staff
- QC
- warehouse/logistics users
- managers
- suppliers
- customers/hobbyists

They consume synchronized technical outputs through EIP rather than needing CLO authoring access.

### 4.5 Restricted assumption

A single licensed CLO installation must not be treated as an automated multi-tenant SaaS processing engine unless a separate written commercial/licensing agreement explicitly permits that operating model.

---

## 5. EIP as the operational window onto the digital garment

For designers and technicians:

```text
Perfect Fit / EIP
      ↓
Open / Sync with specialist engine
      ↓
CLO / Gerber / Richpeace / Optitex / other
      ↓
Push technical result back to EIP
```

For non-designers:

```text
Specialist technical engine
          ↓
       EIP Core
          ↓
Web viewer / technical data / ERP execution
```

A non-designer should be able to use EIP to inspect and act on the resulting digital garment without opening the originating CAD/3D application.

EIP should ingest governed technical results rather than merely show a remote desktop screen.

Possible synchronized objects include:

- master/base pattern revision
- pattern pieces and metadata
- grading information
- size range
- size sets and files
- measurements/POM
- material/BOM data
- colorways
- seams and construction relationships
- 3D derivatives
- technical renders
- animation/fit evidence
- source project files
- tech-pack data
- marker/nesting results where supported

---

## 6. Perfect Fit Workspace hierarchy

Current locked hierarchy:

```text
Workspace
├─ Global tools
│  ├─ Size Guide
│  └─ Find My Size
└─ Project
   └─ Style
      └─ Variant
         ├─ Overview
         ├─ Media
         ├─ Pattern Library
         ├─ Size Set
         ├─ Sewing
         ├─ Tech Pack
         └─ Change History
```

Global Size Guide and Find My Size are not repeated inside every style.

The module order remains:

`Overview | Media | Pattern Library | Size Set | Sewing | Tech Pack | Change History`

Additional connected modules may be introduced later only when the underlying domain is ready, for example:

- Materials
- Measurements / POM
- Fit Review
- 3D / Avatar
- Marker & Cutting
- Costing
- Industrialization

---

## 7. Technical product hierarchy

The garment development chain is:

```text
Project
  ↓
Style
  ↓
Variant
  ↓
Base Reference Size
  ↓
Master / Base Pattern
  ↓
Pattern Revision
  ↓
Grading
  ↓
Format-specific Size Sets
  ↓
Measurements / POM
  ↓
Construction / Sewing
  ↓
Tech Pack
  ↓
Industrialization
```

The Base Reference Size is explicitly selected by the designer/technician and is not assumed to be M.

The technical flow is:

`base size -> base sketch/pattern -> corrections -> approved base reference -> grading -> Size Sets`

---

## 8. Pattern terminology

### Pattern Catalogue

Public/commercial customer-facing collection used to browse or purchase patterns.

### Pattern Library

Technical repository belonging to one variant.

The Pattern Library contains governed technical pattern revisions and their outputs.

The Pattern Library must not be confused with the Pattern Catalogue.

---

## 9. Pattern Revision model

A technical revision changes when the authoritative technical pattern changes.

Example:

```text
R001
R002
R003
```

Creating another delivery/export file does not by itself create a new pattern revision.

Each revision may contain:

- authoritative master/base source
- supporting source files
- grading definition/information
- generated size sets
- derived technical outputs
- revision notes
- approval status
- provenance

Only meaningful technical revisions should drive downstream invalidation.

---

## 10. Size Set model

A Size Set is format-specific and represents the complete available graded size range for that output format.

Example:

```text
Revision R001
├─ PACX Size Set
│  └─ XS / S / M / L / XL
├─ DXF-AAMA Size Set
│  └─ XS / S / M / L / XL
├─ DXF-ASTM Size Set
│  └─ XS / S / M / L / XL
├─ PDF A0 Size Set
│  └─ XS / S / M / L / XL
├─ PDF A4 Tiled Size Set
│  └─ XS / S / M / L / XL
└─ PDF Letter Tiled Size Set
   └─ XS / S / M / L / XL
```

A Size Set may physically contain:

- one combined file covering all sizes
- one file per size
- multiple files each covering subsets of sizes

Therefore the data model must not assume `one size = one physical file`.

Canonical structure:

```text
Size Set
├─ technical revision
├─ format
├─ output profile where applicable
├─ included sizes
├─ completeness status
└─ one or more physical files
```

A4, A0, Letter and Projector are output/print profiles, not fundamental file formats.

---

## 11. CLO-related pattern/source formats

Pattern Library must distinguish editable/native/source formats from print/reference outputs.

Initial CLO-oriented governed format families should be able to represent at least:

- PACX
- DXF-AAMA
- DXF-ASTM
- AI
- PDF
- ZPAC
- ZPRJ
- PNG 1:1/reference snapshot

The canonical model must allow additional vendor-specific formats without schema redesign.

---

## 12. Media model

Media is the visual record of the variant and is separate from actual Pattern Library files.

Locked customer-facing roles:

- Primary
- Technical Sketch
- Pattern Preview

A single asset may occupy at most one of these roles at a time.

Role and visibility are related but not identical.

Media should later be extensible beyond static images to support:

- technical renders
- AI campaign renders
- video
- animation
- turntables
- 3D assets
- fit evidence

Technical truth and marketing imagery must remain distinguishable.

---

## 13. 3D, avatar, rendering and animation

EIP may use specialist 3D engines such as CLO for:

- avatar-based garment simulation
- fit review
- static technical renders
- marketing renders
- colorway renders
- motion/animation
- dynamic fit evidence
- turntables
- 3D model derivatives

EIP itself should provide governed access to the results.

The preferred non-authoring experience is an EIP-controlled web viewer based on synchronized/derived 3D assets rather than requiring every user to open CLO.

The actual native CLO editor is not assumed to be embeddable directly as a normal browser component.

Possible integration experiences include:

- `Open in CLO`
- launch/connect CLO from a future EIP desktop/Electron environment
- EIP data/library surfaces inside CLO through a CLO plug-in
- EIP web 3D viewer using exported web-compatible derivatives
- enterprise remote-workstation streaming only as a separate infrastructure option

---

## 14. Measurements / POM

EIP owns the governed measurement specification.

A connected technical engine may provide:

- POM data
- 2D lengths
- 3D lengths
- grading measurements
- avatar/body measurements

EIP enriches this into:

- target measurements
- tolerances
- size specifications
- revision comparisons
- fit review
- QC measurement sheets
- approval history

---

## 15. BOM and BOQ

BOM and BOQ are not the same concept.

### BOM

Technical composition of the garment, for example:

- shell fabric
- lining
- interfacing
- zipper
- buttons
- thread
- labels
- trims
- graphics

A design engine may supply or help derive BOM information.

### BOQ

Manufacturing quantity requirement derived from BOM plus production context, for example:

```text
BOM
+ order quantity
+ size/color mix
+ marker consumption
+ waste allowance
+ shrinkage
+ trim allowance
+ MOQ
+ inventory
= BOQ / material requirement
```

EIP owns BOQ, sourcing, stock and procurement logic.

---

## 16. Sewing and operations

A seam or stitch definition is not the same thing as a factory sewing operation.

A technical engine may expose construction relationships, but EIP owns the industrial operation model.

EIP sewing/industrial engineering must ultimately support:

- operation sequence
- machine class/type
- attachment
- thread/needle requirements
- operator skill
- SAM/SMV
- quality checkpoints
- precedence
- work center
- target output
- labor cost
- operation bulletin
- line balancing

External construction data can be used to suggest operations but does not replace factory engineering.

---

## 17. Marker, nesting and cutting

CLO nesting must not be treated as a complete industrial marker/cutting system.

EIP owns the neutral Marker Plan and Cut Planning concepts.

Possible engines include:

- CLO nesting
- Gerber
- Richpeace
- Optitex
- Lectra
- other industrial marker engines

Industrial marker/cutting planning may need to govern:

- marker ratio
- size mix
- colorway mix
- usable fabric width
- target utilization
- actual utilization
- marker length
- nap direction
- one-way/two-way constraints
- grain restrictions
- piece rotation rules
- buffer
- stripe/plaid matching
- splice rules
- lay limits
- fabric rolls
- shade lots
- defects
- plies
- cutter constraints
- roll allocation
- remnants
- bundle yield

The marker model must therefore remain independent of any one nesting engine.

---

## 18. Dependency graph and automatic invalidation

The technical product is a dependency graph, not a set of independent files.

Canonical chain:

```text
Master Pattern Revision
        ↓
      Grading
        ↓
     Size Sets
        ↓
 Measurements / POM
        ↓
 Marker / Consumption
        ↓
 BOM / BOQ / Costing
        ↓
 Tech Pack / Production Release
```

If the authoritative pattern changes, downstream objects may become outdated.

Example:

```text
R003 -> R004

Size Sets          REGENERATE
Measurements       REVIEW
Marker              REVIEW/REGENERATE
Consumption         RECALCULATE
Costing             RECALCULATE
Tech Pack           UPDATE REQUIRED
Production Release  BLOCK/REVIEW depending on state
```

EIP process/workflow logic will eventually govern these transitions.

---

## 19. Integration provenance and synchronization

Every externally sourced technical object should be able to retain provenance such as:

- provider
- external reference/object id
- source revision
- EIP revision
- sync direction
- sync status
- last synchronization timestamp
- source file
- derived outputs
- capabilities used
- initiating user/system
- hash/fingerprint where appropriate

Suggested sync states include:

- Not Connected
- Local Only
- Synced
- Changed Externally
- Changed in EIP
- Conflict
- Export Required
- Import Required
- Superseded

Technical integration details should normally remain contextual rather than dominating the designer-facing UI.

---

## 20. Working architecture

```text
                         EIP CORE
             governance / system of record
                             │
             ┌───────────────┴───────────────┐
             │                               │
       PERFECT FIT                     EIP ERP UI
   development workspace             enterprise surfaces
             │                               │
             └───────────────┬───────────────┘
                             │
                   Technical Domain Layer
                             │
          ┌──────────────────┼──────────────────┐
          │                  │                  │
       Pattern           Measurements        Materials
          │                  │                  │
       Grading              POM             BOM / BOQ
          │                  │                  │
      Size Sets             Fit               Cost
          │                  │                  │
          └──────────────┬───┴──────────────────┘
                         │
                  Integration Layer
                         │
     ┌───────────────┬───┴───────┬───────────────┬──────────────┐
     │               │           │               │              │
    CLO           Gerber      Richpeace       Optitex        Other
   Adapter         Adapter       Adapter         Adapter       Adapter
```

Fastify/EIP remains authoritative for authentication, tenancy, RBAC, business rules and persistence.

Python/C++/other integration code is an adapter/worker/plugin layer, not a competing business backend.

---

## 21. CLO integration working model

The preferred initial CLO integration is:

```text
CLO
 ↓
EIP CLO Plugin / Adapter
 ↓ HTTPS
Fastify API
 ↓
EIP Core
```

The plugin may initially use Python for rapid integration work.

Possible later components:

- CLO Python plug-in
- CLO C++ plug-in where deeper UI/event integration is required
- CLO Library Window integration for EIP data inside CLO
- background integration worker for controlled automation where licensing permits

The browser does not directly own CLO integration logic.

---

## 22. Holistic implementation rule

Every implementation must satisfy both tests:

1. It must solve the current user-facing need.
2. It must fit the larger technical dependency graph and future integration model.

Therefore:

- do not build isolated modules with incompatible data structures
- do not hardcode CLO concepts where a neutral domain concept exists
- do not introduce new tables merely for convenience
- do not expose internal governance/integration keys to end users
- do not overbuild future functionality before the current element works
- preserve extension points needed by the next connected elements

The delivery method is:

> **holistic architecture, incremental implementation.**

---

## 23. Incremental working plan

### Stage 0 — Architecture canon

Status: **COMPLETE / LOCKED**

- Perfect Fit role defined
- EIP Core role defined
- future EIP ERP embedding defined
- external technical engine model defined
- CLO licensing/business operating model defined
- vendor-neutral adapter principle defined
- industrial domain boundaries defined

### Stage 1 — Workspace shell

Status: **IN PROGRESS / FOUNDATION AVAILABLE**

- Project → Style → Variant hierarchy
- metadata-driven Workspace navigation
- single centralized Workspace metadata source
- base reference size
- stable references
- module registry

### Stage 2 — Media

Status: **FUNCTIONAL FRONTEND FOUNDATION**

- persistent Media workstation UI
- image add/edit/crop workflow
- image metadata
- Primary / Technical Sketch / Pattern Preview roles
- customer visibility
- compact asset inspector
- thumbnail navigation
- frontend persistence strategy

Future extensions remain possible for render/video/3D/fit assets.

### Stage 3 — Pattern Library

Status: **NEXT IMPLEMENTATION**

Goal: make the Pattern Library capable of hosting a real pattern source from CLO while remaining vendor-neutral.

The first Pattern Library implementation must establish:

- Pattern Revision container
- Master/Base pattern area
- authoritative vs supporting source files
- Base Reference Size linkage
- governed file format
- file reference code
- revision code
- source/provider provenance
- upload/replace/download/remove lifecycle
- selected-file technical inspector
- format-specific Size Set containers
- completeness state
- preparation for CLO-originated source files

The UI must remain compact and one-workstation oriented.

Initial Pattern Library views:

```text
Pattern Library

Revision [R001]   Base Size [M]   Source [Manual/CLO/etc.]   [+ Add File]

[ Master Pattern ] [ Size Sets ] [ Other / Source Files ]

┌──────────────────────────────────────┬──────────────────────────┐
│ file/set list                        │ selected item inspector  │
└──────────────────────────────────────┴──────────────────────────┘
```

Do not implement live CLO synchronization yet. First establish the neutral object model and working local UI/file lifecycle.

### Stage 4 — Size Set linkage

After Pattern Library's technical object model works:

- establish expected sizes from the Variant
- create one Size Set per available technical/output format
- support combined or per-size physical file packaging
- show size coverage/completeness
- link Size Sets to Pattern Revision
- prepare generation/import interfaces for external engines

### Stage 5 — CLO adapter foundation

Only after the neutral Pattern Library works:

- define provider capability contract
- define EIP integration endpoints
- prototype CLO Python plug-in
- authenticate CLO plug-in to EIP
- identify/open EIP Variant from CLO
- push/pull a controlled test pattern source
- record source provenance and sync status

### Stage 6 — Measurements / POM and BOM sync

- map technical measurements into EIP measurement specification
- retain revision linkage
- ingest design BOM information
- map BOM items to EIP materials where possible
- preserve unmatched/imported values for review

### Stage 7 — 3D / avatar / render integration

- store source and derived 3D assets
- build EIP protected viewer path
- import/generate technical renders
- support fit evidence
- later support animation and marketing/AI derivatives

### Stage 8 — Sewing / industrialization

- transform/suggest construction relationships into sewing definitions
- build operation bulletin model
- add machine, attachment, skill and SAM/SMV concepts
- prepare line-balancing/capacity integration

### Stage 9 — Marker & Cutting

- vendor-neutral Marker Plan
- size/color ratios
- fabric width and directional constraints
- engine-generated nesting/marker result
- consumption calculation
- industrial cut/lay extensions

### Stage 10 — BOQ / costing / production thread

- BOM + consumption + order quantity -> BOQ
- supplier/inventory integration
- labor and material costing
- procurement requirement
- production release dependencies

---

## 24. Immediate next step

The next development task is **Pattern Library Stage 3**.

The implementation target is deliberately narrow:

> Create a working, vendor-neutral Pattern Library that can accept and govern a pattern file originating from CLO, without yet building the CLO plug-in itself.

The Pattern Library must be designed so the same object can later be populated by:

- manual upload
- CLO integration
- Gerber integration
- Richpeace integration
- Optitex integration
- another approved technical engine

This is the first concrete implementation of the external technical-engine architecture defined by this canon.

---

## 25. Architecture statement

The durable model is:

```text
EIP = system of record and digital thread
Perfect Fit = focused product-development experience
EIP ERP = enterprise operational experience
CLO / Gerber / Richpeace / Optitex / Lectra / others = specialist technical engines
Adapters = governed translation between EIP and specialist engines
```

Each new feature must strengthen this digital thread rather than create an isolated island of functionality.
