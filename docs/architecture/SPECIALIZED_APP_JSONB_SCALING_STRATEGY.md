# Specialized Application Strategy and JSONB Scaling Guardrails

Date: 2026-08-29

Status: Architecture and product-strategy guardrail for EIP Core V2

## Purpose

EIP Core V2 is being built as a governed, metadata-driven kernel rather than a large fixed-table ERP schema. This creates an opportunity to commercialize focused applications before the complete platform is finished, while also creating a technical responsibility: JSONB and metadata governance must remain predictable, indexable, observable, and migratable as datasets and customers grow.

This document establishes two related strategic rules:

1. EIP Core V2 may be commercialized through narrowly scoped, specialized applications that solve a specific operational problem before the full platform is complete.
2. JSONB may remain a core extensibility mechanism, but performance and data integrity must be continuously validated rather than assuming that JSONB is suitable only for small datasets or, conversely, that it will scale without limits.

The target market for early specialized applications should favor solo operators, small businesses, and startups where the product can deliver immediate value with limited configuration and manageable data volumes. This is a go-to-market choice, not a hard architectural ceiling.

---

## 1. Product Strategy: Revenue Before Full Platform Completion

### 1.1 Principle

Do not wait for the complete EIP platform before validating commercial demand.

Build and deploy specialized applications that:

- solve one painful, well-defined business problem;
- use the EIP V2 kernel and governance model underneath;
- expose only the minimum workflows required for that problem;
- avoid broad ERP scope;
- generate revenue, usage data, and architectural feedback;
- remain compatible with future EIP Core expansion.

The specialized application should be a product surface over the same governed kernel, not an unrelated side application that later needs to be rewritten.

### 1.2 Preferred Early Customer Profile

Early products should primarily target:

- solo business owners;
- freelancers;
- micro-businesses;
- small operational teams;
- startups;
- specialist service providers;
- businesses currently using spreadsheets, messaging, and disconnected SaaS tools.

These customers are attractive because:

- dataset sizes are usually moderate;
- operational workflows are easier to observe end-to-end;
- deployment and onboarding can remain simple;
- metadata models can be validated against real usage;
- product value can be demonstrated without implementing a full enterprise suite;
- feedback arrives earlier and can influence the kernel before scale becomes expensive to correct.

### 1.3 Specialized Application Selection Criteria

A candidate application should score well on the following dimensions:

- clear recurring pain;
- measurable time or cost saving;
- limited number of core workflows;
- limited external integration burden;
- low regulatory complexity for the first release;
- bounded initial data volume;
- strong fit with service objects, tasks, processes, documents, agents, materials, or governed metadata already supported by V2;
- low requirement for customer-specific code;
- potential to expand into adjacent EIP modules later.

Avoid early products that require:

- very high write throughput;
- large analytical fact tables from day one;
- sub-millisecond query latency across billions of rows;
- extensive unstructured search without a dedicated search architecture;
- complex multi-region active-active behavior;
- heavy industry-specific logic that bypasses the governed process model.

---

## 2. JSONB Is an Extensibility Tool, Not a Replacement for Relational Design

### 2.1 Core Rule

Use JSONB for extensible, metadata-governed attributes whose shape may legitimately vary by tenant, service-object type, document type, process, or product configuration.

Use relational columns and relational tables for values that are important to:

- identity;
- tenant ownership;
- foreign-key integrity;
- joins;
- uniqueness;
- ordering;
- lifecycle state;
- high-frequency filtering;
- high-frequency aggregation;
- financial totals;
- line items;
- inventory quantities;
- timestamps used operationally;
- permissions;
- security boundaries;
- frequently updated counters;
- data required by RLS predicates.

JSONB should reduce schema proliferation without erasing relational integrity.

### 2.2 Metadata Governance Requirement

JSONB is acceptable only where its structure is governed.

Every governed JSONB payload should have, where applicable:

- a schema identifier;
- a schema or contract version;
- allowed keys;
- required keys;
- value types;
- nullability rules;
- defaulting rules;
- applicability rules;
- validation errors;
- change/version history;
- migration or compatibility strategy;
- indexing classification for fields used operationally.

The metadata layer must prevent JSONB from becoming an uncontrolled dumping ground.

---

## 3. The Main JSONB Risk Is Query Shape, Not Dataset Size Alone

A small database can perform badly if every request performs unindexed JSONB scans.

A large database can perform well when:

- access patterns are stable;
- tenant predicates are selective;
- frequently queried JSONB paths are indexed appropriately;
- data is partitioned or archived where necessary;
- relational columns carry hot operational fields;
- query plans are monitored;
- large analytical workloads are separated from transactional workloads when needed.

Therefore, EIP V2 must not adopt a rule that JSONB is "for small businesses only." The correct rule is:

> JSONB remains acceptable while measured query cost, write amplification, index size, storage growth, and operational latency stay inside defined product limits.

Customer size and row count are useful signals, but actual query behavior is the architectural decision point.

---

## 4. JSONB Performance Risks to Monitor

### 4.1 Sequential JSONB Scans

Risk:

Queries filter inside JSONB without usable indexes and gradually become full-table scans.

Guardrail:

Any JSONB path used frequently in WHERE, JOIN, ORDER BY, permission logic, or operational dashboards must be reviewed for a dedicated expression index, GIN index, generated/relational column, or model change.

### 4.2 Oversized GIN Indexes

Risk:

A broad GIN index over an entire JSONB document may consume significant storage and write overhead while indexing keys that are rarely queried.

Guardrail:

Do not automatically add GIN indexes to every JSONB column. Index according to measured query patterns.

### 4.3 Write Amplification

Risk:

Updating a small value inside a large JSONB document can rewrite a significant tuple and create MVCC/WAL/bloat overhead.

Guardrail:

Frequently changing attributes should not live inside very large JSONB payloads merely to preserve a generic schema.

Promote high-churn values to dedicated relational structures when measurement demonstrates the need.

### 4.4 TOAST and Large Documents

Risk:

Large JSONB values may move into TOAST storage, increasing read cost when entire documents are repeatedly retrieved.

Guardrail:

API DTOs should return only required fields. Do not routinely fetch or return full JSONB documents when the request needs a small subset.

### 4.5 Aggregation Over Dynamic Attributes

Risk:

Large-scale reporting across arbitrary JSONB attributes can become expensive and difficult to optimize.

Guardrail:

Operational attributes that become important reporting dimensions should be candidates for:

- generated columns;
- indexed expressions;
- materialized projections;
- reporting tables/views;
- analytical pipelines.

Do not force transactional JSONB to serve every future analytical workload directly.

### 4.6 Schema Drift Inside JSONB

Risk:

Different writers create incompatible key names, types, units, or semantics.

Guardrail:

All business writes must pass through governed metadata validation. Direct free-form JSONB writes are prohibited for governed business records.

---

## 5. Promotion Rule: When a JSONB Field Becomes a Column or Table

A JSONB attribute should be reviewed for promotion when one or more of the following become true:

- it participates in a foreign key relationship;
- it becomes part of a uniqueness rule;
- it becomes part of an RLS predicate;
- it is queried in a large percentage of requests;
- it is sorted or aggregated frequently;
- it is updated much more frequently than the surrounding document;
- it becomes financially or legally significant;
- it requires strict database-level typing or constraints;
- it appears in most records of the entity type;
- it creates a measurable query-plan or index-cost problem;
- it needs referential integrity with another governed object.

Promotion must not be treated as architectural failure. It is the intended evolution path from flexible metadata to stable high-value schema.

The metadata contract should support migration/versioning so promoted fields do not create breaking application drift.

---

## 6. Small-Business First, Scale-Aware Architecture

The initial commercial target can deliberately focus on smaller customers while preserving an upgrade path.

### Stage A — Solo / Micro Business

Typical characteristics:

- one to a few users;
- relatively small tenant datasets;
- low write concurrency;
- simple reporting;
- operational value more important than extreme throughput.

Architecture priority:

- simplicity;
- correctness;
- metadata governance;
- rapid workflow configuration;
- low operating cost.

### Stage B — Small Business / Growing Startup

Characteristics:

- more users and workflows;
- tens or hundreds of thousands of operational records may accumulate;
- dashboards and search become more important;
- integrations increase.

Architecture response:

- monitor slow queries;
- introduce selective JSONB indexes;
- promote hot attributes;
- archive completed operational history where appropriate;
- introduce purpose-built projections for common reporting.

### Stage C — Mid-Market / Large Dataset

Characteristics:

- millions or more operational rows;
- higher concurrency;
- heavier reporting;
- stronger latency and availability expectations.

Architecture response may include:

- further relational promotion;
- table partitioning;
- read replicas;
- caching;
- asynchronous projections;
- analytical stores/warehouses;
- dedicated search infrastructure;
- tenant tiering or isolation models such as bridge/silo where justified.

The kernel should allow this evolution without forcing every Stage A customer to pay the complexity cost of Stage C architecture.

---

## 7. Mandatory Performance Validation During V2 Development

Every major V2 data-model wave should consider both functional correctness and scale behavior.

### 7.1 Required Query Review

For new or materially changed persistence paths, record:

- expected query pattern;
- tenant predicate;
- relational filters;
- JSONB filters;
- expected result cardinality;
- indexes relied upon;
- whether a full JSONB payload is fetched;
- expected update frequency.

### 7.2 EXPLAIN-Based Review

For important operational queries, use PostgreSQL `EXPLAIN (ANALYZE, BUFFERS)` on a disposable performance dataset when practical.

Review:

- sequential scans;
- index scans;
- rows scanned versus returned;
- buffer reads;
- sort spills;
- nested-loop explosions;
- JSONB expression cost;
- tenant predicate selectivity.

Do not run destructive or synthetic performance testing against production.

### 7.3 Representative Data Volumes

Maintain local or staging performance fixtures representing at least several orders of magnitude rather than testing only nearly empty databases.

Suggested checkpoints, adjusted by table type:

- 1,000 records;
- 10,000 records;
- 100,000 records;
- 1,000,000 records for important high-growth structures where feasible.

The objective is not to guarantee enterprise scale at every checkpoint. The objective is to identify nonlinear degradation before customers encounter it.

### 7.4 Tenant Distribution

Performance tests must include both:

- many small tenants;
- one comparatively large tenant.

A global dataset of one million rows with excellent tenant selectivity behaves differently from one tenant owning most of those rows.

---

## 8. Suggested Operational Metrics

Before and after commercialization, monitor at least:

- p50 / p95 / p99 API latency;
- slow-query count;
- query duration by operation;
- rows scanned versus returned;
- database CPU;
- database memory;
- storage growth;
- index size versus table size;
- WAL volume;
- dead tuples / table bloat;
- autovacuum behavior;
- connection-pool saturation;
- JSONB document size distribution;
- tenant-specific row counts;
- largest tenant share of total records.

Performance decisions should be based on these measurements rather than intuition alone.

---

## 9. Initial Performance Budgets

Exact product SLAs will evolve, but V2 should establish internal budgets early.

Suggested starting engineering targets for ordinary transactional operations under representative load:

- common indexed reads: target p95 below 200 ms at the database/service boundary;
- normal user-facing API operations: target p95 below 500 ms where external services are not involved;
- no unexplained full scan of large tenant-owned tables in common request paths;
- no JSONB field used as a frequent operational filter without an explicit indexing/model decision;
- no business API returning very large unbounded JSONB documents by default.

These are engineering guardrails, not contractual customer SLAs.

---

## 10. Specialized App Architecture Rule

Every specialized product built on V2 should identify:

- its primary service-object types;
- process definitions;
- expected tenant size;
- expected record growth per month/year;
- hot query paths;
- hot JSONB attributes;
- high-churn attributes;
- reporting requirements;
- retention requirements;
- external integration volume;
- performance budget;
- likely relational-promotion candidates.

This review should happen before public deployment and again when usage crosses meaningful growth thresholds.

---

## 11. Go-to-Market Guardrail

The early commercial positioning should emphasize focused outcomes rather than the breadth of EIP Core.

Preferred positioning:

- one application;
- one operational problem;
- low setup burden;
- clear workflow automation;
- metadata-driven flexibility where it provides user value;
- affordable pricing for smaller operators;
- ability to grow into a broader EIP ecosystem later.

Avoid marketing the first releases as a complete ERP if the operational scope is intentionally narrow.

A specialized application can be commercially complete even while EIP Core remains architecturally broader and under continued development.

---

## 12. Decision Framework for Customer Scale

Do not reject a larger customer solely because they are larger.

Evaluate whether the specific workload fits the current architecture.

Before onboarding a materially larger tenant, assess:

1. expected row counts by high-growth table;
2. write rate and concurrency;
3. JSONB document size;
4. indexed versus unindexed query paths;
5. reporting and aggregation demand;
6. retention period;
7. integration/event throughput;
8. storage growth;
9. RLS selectivity;
10. ability to promote hot metadata fields without breaking contracts.

Classify the customer/workload as:

- supported by current architecture;
- supported with indexing/projection changes;
- supported after a defined relational promotion;
- requires a higher-scale deployment topology;
- currently outside product limits.

This is more accurate than using employee count alone.

---

## 13. Architecture Invariants to Preserve

The revenue strategy must never weaken V2 governance.

Specialized applications must continue to preserve:

- tenant isolation;
- FORCE RLS for tenant-owned data according to V2 policy;
- transaction-local tenant context;
- governed effect contracts;
- explicit DTO boundaries;
- metadata-driven UI behavior;
- process authority outside React and transport routes;
- migration immutability;
- new-table justification;
- schema/version governance for dynamic data;
- fail-closed security behavior.

Commercial urgency is not justification for bypassing these controls.

---

## 14. Review Checklist for Every New V2 Module or Specialized App

Before implementation approval, ask:

- Is the business problem narrow and commercially understandable?
- Can existing kernel structures model it without unnecessary new tables?
- Which fields belong relationally?
- Which fields legitimately belong in governed JSONB?
- Which JSONB paths will be queried frequently?
- Are those paths indexed or intentionally promoted?
- What happens at 10x and 100x the expected starting dataset?
- Is the largest-tenant case acceptable?
- Are list APIs paginated and bounded?
- Are JSONB payloads projected through DTOs rather than returned wholesale?
- Are performance-relevant fields visible to observability tooling?
- Is there a migration path if a JSONB attribute becomes operationally critical?
- Does tenant isolation remain fail closed?
- Does the specialized application reuse governed process/effect/document authority rather than introducing application-specific hidden rules?

A new module should not pass architecture review if these questions cannot be answered.

---

## 15. Strategic Conclusion

The preferred V2 direction is:

**commercially narrow first, architecturally scalable underneath.**

Targeting solo operators, small businesses, and startups is a sensible early revenue strategy because it reduces deployment complexity and gives EIP real-world validation sooner. However, this should not be confused with a technical claim that PostgreSQL JSONB only works for small datasets.

The permanent architecture rule is to keep flexible data governed, measure real workload behavior, index deliberately, promote hot attributes when justified, and introduce higher-scale database patterns only when actual usage requires them.

This allows EIP to avoid premature enterprise complexity while preserving a credible path from focused specialist applications to larger operational workloads.
