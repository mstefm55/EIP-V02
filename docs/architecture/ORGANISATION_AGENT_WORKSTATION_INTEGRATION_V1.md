# Organisation, Agent, and Workstation Integration V1

Date: 2026-09-12
Status: integration contract for Process Studio / Business Analysis, Operational Workbench, and Planning UI cutover

## 1. Purpose

This contract fixes one shared organisational/resource vocabulary and authority boundary before the separately developed EIP UIs are connected to Core V2.

The goal is to prevent Process Studio / Business Analysis, the Operational Workbench, Planning/Scheduling, and the future Admin Console migration from inventing competing concepts for organisation, team, employee, resource, or workstation.

This contract does not add a second organisation engine, a second scheduler, or a new persistence model.

## 2. Kernel-first authority

Canonical authority remains:

```text
kernel tenant
  -> eip_core.agent hierarchy
      -> authenticated identity mapping where applicable
      -> process/task ownership and assignment

resource facts
  -> Agent projections
  -> Asset projections
  -> governed capabilities/calendars/capacity
      -> Workstation projection
```

Frontend organisation trees are projections only. They never become permission, tenant, reporting-line, or runtime authority.

## 3. Organisation tree

The current V2 kernel already provides a generic self-referencing Agent tree:

```text
eip_core.agent
  id
  tenant_id
  agent_type
  code
  name
  attrs
  parent_agent_id -> eip_core.agent.id
```

The same structure can represent a tenant-specific hierarchy such as:

```text
Organisation Agent
  -> Division Agent
      -> Department Agent
          -> Team Agent
              -> Manager / Person Agent
              -> Employee / Person Agent
```

The example levels are display/business metadata, not new tables. Different tenants may use different depth and labels.

`agent_type` is metadata-governed and must not be hardcoded as a closed React union.

## 4. Identity is not the Agent

Authentication identity remains separate from the business/organisation Agent.

The existing link is:

```text
eip_auth.auth_identity
  -> eip_auth.auth_identity_agent
      -> eip_core.agent
```

This distinction is mandatory.

- login credentials belong to Auth;
- organisation/person/team/business identity belongs to Agent;
- the browser must not infer Agent authority from a display tree;
- server/session context determines the authenticated Agent mapping and allowed scope.

## 5. Work and ownership links

Existing V2 references already align the task-first workbench with the Agent model:

```text
eip_core.task.assigned_agent_id -> eip_core.agent.id

eip_core.service_object.owner_agent_id -> eip_core.agent.id

eip_core.service_object_party.agent_id -> eip_core.agent.id

eip_core.*_status_event.actor_agent_id -> eip_core.agent.id
```

Therefore My Work, Team Work, manager/subordinate projections, ownership, participation, and audit attribution must resolve through canonical Agent references rather than frontend-owned employee/team objects.

## 6. Manager and multi-team projections

A manager responsible for several teams is represented through the governed Agent hierarchy/projection supplied by EIP.

The UI may render:

```text
Manager
  -> Team A
  -> Team B
  -> Team C
```

and drill down:

```text
Manager
  -> Team
      -> Member
          -> Tasks
```

But the frontend does not compute visibility by recursively trusting arbitrary tree data.

The server supplies the permitted organisation/subordinate scope. UI tree traversal is presentation only.

If later organisation designs require matrix or many-to-many reporting relationships that cannot be represented safely by the canonical parent tree, reuse an existing governed relationship mechanism before proposing a new table.

## 7. Team is an Agent role/type, not a new kernel object family

For V1 integration, Team is a human-facing organisational concept represented through Agent metadata/hierarchy.

Do not create a standalone `team` kernel family merely because a UI contains a Team tab.

The same rule applies to department, division, manager grouping, work center, cell, and similar organisational labels unless a later integrity requirement proves the Agent/relationship model insufficient.

## 8. Workstation is a projection

The operating-model canon remains authoritative:

```text
WORKSTATION
  = ASSET(S)
  + AGENT(S) / ENTITY RESOURCES
  + CAPABILITIES
  + AVAILABILITY / CAPACITY CONTEXT
```

Examples include machine + operator, vehicle + driver, operating theatre + care team, mobile maintenance team + tools, and a human-only service workstation.

A Workstation is not a new V1 table.

The existing resolver contract consumes bounded candidate projections with fields such as:

```text
id
capabilities[]
mobility
capacity{}
process_standards{}
calendar_layers[]
reservations[]
```

This is the shared resource model for Planning/Scheduling and Process reasoning.

## 9. Asset boundary

`Asset` is a canonical kernel business class under `KERNEL_CANON.md` and the operating-model/resource canon assigns machine/equipment master facts to Asset projections.

At the time of this contract, the current V2 migration chain does not yet contain a canonical persisted `eip_core.asset` / asset-assignment transfer equivalent.

Therefore:

- Process Studio must not invent Asset persistence;
- the Google UI may use mock Asset/workstation projections only behind its adapter boundary;
- real asset-backed workstation persistence is an explicit V2 transfer/integration dependency;
- before a persisted Asset structure is added, the V1 canonical structures and V2 table-creation rules must be audited;
- no new table is approved by this document.

The lack of persisted Asset transfer is not a blocker for Process Definition lifecycle/adapter cutover, but it is a blocker for declaring real asset-backed workstation management complete.

## 10. Process Studio / Business Analysis responsibility

The Business Analysis / Process Studio UI may define or reference:

- Process Definitions;
- Process Steps;
- Task labels and Task Templates;
- role/team/capability requirements;
- routing and handoff semantics;
- KPI/SLA expectation metadata;
- Macros, Effects, Reasoning, and UI Surfaces.

It does not become the organisation master-data engine and does not assign live employees/assets directly as runtime authority.

Process metadata should prefer required roles/capabilities over hardcoded person IDs wherever the business rule permits it.

## 11. Planning/Scheduling responsibility

Planning/Scheduling resolves temporal/resource feasibility from governed facts.

Conceptually:

```text
Process requirement
  + Agent capability/availability
  + Asset capability/availability
  + calendars/capacity
  -> eligible Workstation projection
  -> governed schedule/resource decision
```

Planning does not redefine the organisation tree or duplicate Agent/Asset master facts.

## 12. Operational Workbench responsibility

The Operational Workbench consumes the resolved human work context:

```text
Task
  -> assigned Agent / permitted team scope
  -> Service Object context
  -> Process Instance context
  -> allowed actions
```

Its My Work, Team Work, Teams, manager/subordinate, and KPI views are projections of EIP authority.

It does not use a local React organisation model as runtime truth.

## 13. Shared vocabulary contract

All integrated UIs must use the following canonical internal concepts consistently:

```text
Organisation
Agent
Asset
Workstation
Service Object
Task
Task Template
Process Definition
Process Instance
Process Step
Macro
Effect
Reasoning
Party
Information Record
Object Link
UI Surface
Resource
```

Human-facing labels may be simplified, for example:

```text
Service Object -> Object / Business Context
Process Instance -> Process
Information Record -> Information
Object Link -> Related
```

but adapters and API models must map back to the canonical concept. Do not create competing internal terms such as Case Entity, Workflow Item, Action Object, Business Ticket, Flow Instance, or Automation Record.

## 14. Adapter boundary

Google/Qwen prototypes may retain mock data while visually under development, but integration must occur through an injected adapter.

The target flow is:

```text
prototype component
  -> UI adapter/model mapper
  -> governed EIP API projection
  -> canonical Agent / Process / Task / Service Object / resource facts
```

The prototype DTO must never become the database contract.

## 15. Security and tenancy

All organisation/resource projections are tenant scoped.

Rules:

- session/server tenant authority only;
- no raw browser `tenant_id` UUID authority;
- RLS/tenant transaction rules remain in force;
- manager/subordinate visibility is server-authorized;
- the organisation tree itself is not an authorization proof;
- cross-tenant Agent, Asset, Workstation, Task, and KPI data must fail closed.

## 16. Integration checkpoint before UI cutover

Before any of the parallel UIs is merged into the production V2 frontend, verify together:

1. Agent hierarchy mapping and governed `agent_type` vocabulary;
2. authenticated identity -> Agent mapping;
3. task assignment/ownership projections;
4. manager/subordinate server scope;
5. canonical Asset persistence/transfer decision where asset-backed features are used;
6. Workstation projection = Agent(s) + Asset(s) + capabilities + availability/capacity;
7. one shared internal vocabulary across Business Analysis, Operational Workbench, Planning/Scheduling, and Admin Console;
8. no UI-local authority for tenancy, permissions, process runtime, organisation visibility, or resource allocation.

## 17. No-new-table decision

This preparation wave adds no table.

The Agent hierarchy, existing identity link, current process/task references, governed metadata, and resource projection foundation are sufficient to freeze the integration contract.

Asset persistence transfer is intentionally left to a dedicated audited migration decision rather than being invented as part of UI integration preparation.
