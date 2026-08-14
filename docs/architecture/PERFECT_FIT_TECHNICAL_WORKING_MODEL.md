# PERFECT_FIT_TECHNICAL_WORKING_MODEL

Status: **ACTIVE WORKING MODEL**

Canonical architecture: `docs/architecture/PERFECT_FIT_TECHNICAL_INTEGRATION_CANON.md`

This document translates the locked architecture into the model used while building the Perfect Fit Workspace.

## 1. Delivery principle

**Holistic architecture, incremental implementation.**

Every module must work now while remaining a compatible node in the full garment-development and manufacturing digital thread.

No module is treated as an isolated application.

## 2. Current application shape

```text
EIP Core
   │
   └── Perfect Fit Workspace
         │
         └── Project
              └── Style
                   └── Variant
                        ├── Overview
                        ├── Media
                        ├── Pattern Library
                        ├── Size Set
                        ├── Sewing
                        ├── Tech Pack
                        └── Change History
```

Perfect Fit is the current development experience. The same governed objects must later be reusable inside the EIP ERP UI.

## 3. Technical dependency model

```text
Variant
  │
  ├── Base Reference Size
  │
  └── Pattern Revision
        │
        ├── Master/Base Pattern
        │
        ├── Grading
        │     │
        │     └── Size Sets
        │
        ├── Measurements / POM
        ├── Construction / Sewing
        ├── BOM
        ├── 3D / Fit / Render Evidence
        └── Tech Pack
              │
              └── Industrialization
                    ├── Marker
                    ├── Consumption
                    ├── BOQ
                    ├── Costing
                    ├── Operations
                    └── Production Release
```

A change upstream may invalidate or require review downstream.

## 4. External engine model

External systems are adapters around EIP technical objects.

```text
                    EIP Technical Object
                           │
          ┌────────────────┼─────────────────┐
          │                │                 │
         CLO            Gerber          Richpeace / Optitex
          │                │                 │
       authoring         marker/CAD         CAD/CAM/3D
```

The UI requests a business action; an adapter performs it where supported.

Examples:

- Open in CAD
- Pull Pattern
- Push Revision
- Generate Size Set
- Sync POM
- Sync BOM
- Generate Marker
- Generate Render

## 5. Provenance contract

Externally sourced technical objects should be able to retain:

```text
provider
external reference
source revision
EIP revision
sync direction
sync state
last sync
source file
file hash/fingerprint
initiating user
```

These values are normally technical/contextual and should not clutter the normal designer UI.

## 6. Pattern Library working model

The Pattern Library is the next implementation focus.

```text
Pattern Library
  │
  └── Pattern Revision R001
        │
        ├── Master Pattern
        │     ├── Authoritative source
        │     └── Supporting sources
        │
        ├── Size Sets
        │     ├── PACX
        │     ├── DXF-AAMA
        │     ├── DXF-ASTM
        │     ├── PDF / A0
        │     ├── PDF / A4 tiled
        │     └── PDF / Letter tiled
        │
        └── Other / Source Files
              ├── ZPRJ
              ├── ZPAC
              ├── AI
              └── reference outputs
```

### Pattern revision

A revision changes when the authoritative technical pattern changes.

A newly generated output format does not automatically create a new revision.

### Master Pattern

The Master Pattern identifies the authoritative technical source for the revision.

Supporting files may represent the same technical revision without becoming independently authoritative.

### Size Set

One Size Set exists per available format/output profile and represents the complete graded range.

A Size Set may contain one combined file or multiple physical files.

## 7. First CLO-hosting scenario

The first Pattern Library must support this workflow before live CLO API integration exists:

```text
User develops pattern in CLO
        ↓
Exports/saves technical pattern file
        ↓
Perfect Fit Pattern Library
        ↓
Upload file
        ↓
Assign revision R001
        ↓
Identify Base Reference Size
        ↓
Identify file format
        ↓
Identify source provider = CLO
        ↓
Mark authoritative/supporting
        ↓
Govern file under Variant
```

Later the manual upload step becomes:

```text
CLO Plugin
   ↓
Fastify API
   ↓
Same Pattern Library object
```

The Pattern Library UI/data model therefore does not change when the integration becomes automatic.

## 8. Implementation test

Before implementing each feature, verify:

1. What EIP domain object does this represent?
2. What upstream object does it depend on?
3. What downstream objects may depend on it?
4. Is the concept vendor-neutral?
5. Can a future adapter populate the same object?
6. Is technical provenance retained without exposing unnecessary internals?
7. Does the implementation solve the immediate user workflow?

If any answer is unclear, resolve the model before adding UI complexity.
