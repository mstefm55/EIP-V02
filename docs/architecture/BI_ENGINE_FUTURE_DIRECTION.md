# EIP BI Engine — Future Architecture Direction

Date: 2026-08-31

Status: Approved future-development direction. This document records a later architectural capability and does not authorize implementation in the current orchestration wave.

## 1. Purpose

EIP will require a Business Intelligence (BI) Engine associated with the UI Engine, either directly linked to it or operating alongside it as a separate analytical preparation plane.

The BI Engine is intended to prepare, organize, aggregate and precompute background data for governed dashboards and analytical surfaces so that users are not forced to wait for expensive live recalculation every time a dashboard is opened or refreshed.

The principle is:

```text
TRANSACTIONAL / OPERATIONAL DATA
        |
        +--> selective live queries for genuinely online indicators
        |
        +--> BI ENGINE
                |
                +--> scheduled extraction / aggregation / calculation
                +--> governed analytical snapshot
                +--> freshness / provenance metadata
                        |
                        +--> UI ENGINE / DASHBOARDS
```

The BI Engine is not a replacement for the UI Engine and is not a second business-process engine. It prepares analytical data; the UI Engine remains responsible for presentation and governed interaction.

## 2. Snapshot-first dashboard strategy

Predetermined dashboards should normally consume prepared analytical snapshots rather than forcing all metrics to be recalculated interactively.

For dashboards with a known refresh schedule, the system should be able to declare a target publication time such as:

```text
Dashboard refresh visible to users: 08:00
BI preparation window begins:      07:45–07:50
Snapshot finalized:                07:50–07:55
Dashboard published/ready:         before 08:00
```

The exact preparation lead time is workload-dependent. Five to ten minutes before the promised dashboard refresh is a normal target concept, not a hard-coded universal constant.

Users should see the freshness contract explicitly, for example:

```text
Data refreshed at 08:00
Next scheduled refresh 12:00
```

The purpose is to prevent a user-triggered refresh from becoming a ten-minute blocking analytical job.

## 3. Hybrid freshness model

Not all BI data must be snapshot-based and not all BI data should be live.

A dashboard may combine:

- live operational indicators where the query is bounded and inexpensive;
- near-real-time data where short delay is acceptable;
- scheduled analytical snapshots for expensive aggregations;
- historical/cumulative analytical data prepared asynchronously.

Freshness is therefore a governed property of each dataset/metric/dashboard, not a single platform-wide setting.

Conceptually:

```text
METRIC / DATASET
  -> freshness policy
       LIVE
       NEAR_REAL_TIME
       SCHEDULED_SNAPSHOT
       PERIODIC_BATCH
  -> preparation policy
  -> snapshot timestamp
  -> next planned refresh
  -> UI presentation
```

## 4. UI Engine relationship

The UI Engine should be able to consume BI outputs as governed data sources without embedding analytical business logic inside React components or other presentation code.

The desired separation is:

```text
PROCESS ENGINE  -> operational mutations / lifecycle
UI ENGINE       -> presentation / interaction
BI ENGINE       -> analytical preparation / snapshot production
```

The BI Engine may sit beside the UI Engine architecturally, while the UI Engine consumes BI datasets, snapshot metadata and freshness state.

Dashboard definitions should remain metadata-driven. A dashboard may declare which datasets it consumes, whether each dataset is live or snapshot-based, and its expected freshness/service window.

## 5. Background preparation

Expensive BI workloads should normally execute asynchronously before the promised dashboard publication time.

A future BI scheduler should be able to:

- determine which governed dashboards/datasets need refresh;
- estimate or learn preparation lead time;
- start computation before the publication deadline;
- complete materialization before the dashboard refresh time where practical;
- expose `preparing`, `ready`, `late`, `failed`, and `stale` state;
- preserve the previous valid snapshot if a refresh fails rather than replacing it with incomplete data;
- record snapshot generation time and source-watermark/provenance.

The scheduler must avoid launching unnecessary duplicate computations merely because several users open the same dashboard.

## 6. Performance objective

Interactive dashboard use must not routinely trigger large transactional scans or expensive recalculation across the operational database.

The BI architecture should protect both user experience and the transactional system by separating:

```text
interactive read latency
from
heavy analytical preparation cost
```

A user opening a predetermined dashboard should normally receive an already prepared snapshot quickly, with explicit freshness information, rather than waiting for the analytical workload itself to finish.

## 7. Data authority and provenance

BI snapshots are derived analytical representations. They do not become the authority for transactional business state.

The authoritative source remains the governed operational model unless a future architecture decision explicitly defines another authoritative analytical store for a specific purpose.

Every prepared snapshot should eventually carry sufficient provenance to establish, where applicable:

- tenant and governed dataset/dashboard identity;
- snapshot version;
- source watermark / source period;
- calculation/profile version;
- generated-at timestamp;
- intended publication timestamp;
- freshness/expiry status;
- generation outcome and diagnostics.

## 8. Persistence and infrastructure are intentionally deferred

This future direction does not yet select:

- dedicated BI tables;
- materialized views;
- warehouse/lakehouse technology;
- OLAP engine;
- queue technology;
- cache technology;
- background worker platform;
- scheduling infrastructure.

Those choices must be justified later from real dashboard/query workloads and must follow EIP's normal schema-admission, JSONB-scaling, observability and owner-approval rules.

Do not create a BI persistence subsystem during unrelated development merely because this future direction exists.

## 9. Future design rule

When BI development begins, test each dashboard/data requirement in this order:

```text
1. Can a bounded live query satisfy the freshness/latency requirement?
2. If not, can a governed periodic snapshot satisfy it?
3. What publication schedule and preparation lead time are required?
4. What source watermark and provenance are required?
5. What storage/indexing strategy is justified by measured workload?
6. How does the UI Engine expose freshness and degraded/stale state?
```

The guiding objective is:

> Precompute expensive predetermined analytics before users need them, publish governed snapshots at known intervals, and reserve live computation for data that genuinely requires online freshness.
