BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS eip_core;

COMMENT ON SCHEMA eip_core IS
  'Kernel process/workflow data plane for service objects, tasks, process definitions, and governed dropdown metadata.';

CREATE TABLE IF NOT EXISTS eip_core.agent (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES kernel.tenants (tenant_id) ON DELETE RESTRICT,
    agent_type text NOT NULL,
    code text,
    name text,
    attrs jsonb NOT NULL DEFAULT '{}'::jsonb,
    parent_agent_id uuid REFERENCES eip_core.agent (id) ON DELETE SET NULL,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT agent_code_unique_per_tenant UNIQUE (tenant_id, code),
    CONSTRAINT agent_type_not_blank_ck CHECK (btrim(agent_type) <> ''),
    CONSTRAINT agent_attrs_object_ck CHECK (jsonb_typeof(attrs) = 'object')
);

CREATE INDEX IF NOT EXISTS agent_tenant_idx
    ON eip_core.agent (tenant_id);
CREATE INDEX IF NOT EXISTS agent_type_idx
    ON eip_core.agent (tenant_id, agent_type);
CREATE INDEX IF NOT EXISTS agent_parent_idx
    ON eip_core.agent (parent_agent_id);
CREATE INDEX IF NOT EXISTS agent_attrs_gin
    ON eip_core.agent USING gin (attrs);

CREATE TABLE IF NOT EXISTS eip_core.service_object (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES kernel.tenants (tenant_id) ON DELETE RESTRICT,
    object_type text NOT NULL,
    status text NOT NULL DEFAULT 'new',
    code text,
    title text,
    attrs jsonb NOT NULL DEFAULT '{}'::jsonb,
    owner_agent_id uuid REFERENCES eip_core.agent (id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT service_object_code_unique_per_tenant UNIQUE (tenant_id, code),
    CONSTRAINT service_object_type_not_blank_ck CHECK (btrim(object_type) <> ''),
    CONSTRAINT service_object_status_not_blank_ck CHECK (btrim(status) <> ''),
    CONSTRAINT service_object_attrs_object_ck CHECK (jsonb_typeof(attrs) = 'object')
);

CREATE INDEX IF NOT EXISTS so_tenant_idx
    ON eip_core.service_object (tenant_id);
CREATE INDEX IF NOT EXISTS so_type_status_idx
    ON eip_core.service_object (tenant_id, object_type, status);
CREATE INDEX IF NOT EXISTS so_owner_idx
    ON eip_core.service_object (owner_agent_id);
CREATE INDEX IF NOT EXISTS so_attrs_gin
    ON eip_core.service_object USING gin (attrs);

CREATE TABLE IF NOT EXISTS eip_core.service_object_party (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES kernel.tenants (tenant_id) ON DELETE RESTRICT,
    service_object_id uuid NOT NULL REFERENCES eip_core.service_object (id) ON DELETE CASCADE,
    agent_id uuid NOT NULL REFERENCES eip_core.agent (id) ON DELETE RESTRICT,
    role text NOT NULL,
    attrs jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT sop_unique UNIQUE (tenant_id, service_object_id, agent_id, role),
    CONSTRAINT service_object_party_role_not_blank_ck CHECK (btrim(role) <> ''),
    CONSTRAINT service_object_party_attrs_object_ck CHECK (jsonb_typeof(attrs) = 'object')
);

CREATE INDEX IF NOT EXISTS sop_tenant_idx
    ON eip_core.service_object_party (tenant_id);
CREATE INDEX IF NOT EXISTS sop_service_object_idx
    ON eip_core.service_object_party (service_object_id);
CREATE INDEX IF NOT EXISTS sop_agent_idx
    ON eip_core.service_object_party (agent_id);
CREATE INDEX IF NOT EXISTS sop_role_idx
    ON eip_core.service_object_party (tenant_id, role);
CREATE INDEX IF NOT EXISTS sop_attrs_gin
    ON eip_core.service_object_party USING gin (attrs);

CREATE TABLE IF NOT EXISTS eip_core.dropdown_list (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid REFERENCES kernel.tenants (tenant_id) ON DELETE CASCADE,
    module text NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    version integer NOT NULL DEFAULT 1,
    is_active boolean NOT NULL DEFAULT true,
    attrs jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT dropdown_list_unique UNIQUE NULLS NOT DISTINCT (tenant_id, module, code, version),
    CONSTRAINT dropdown_list_module_not_blank_ck CHECK (btrim(module) <> ''),
    CONSTRAINT dropdown_list_code_not_blank_ck CHECK (btrim(code) <> ''),
    CONSTRAINT dropdown_list_name_not_blank_ck CHECK (btrim(name) <> ''),
    CONSTRAINT dropdown_list_attrs_object_ck CHECK (jsonb_typeof(attrs) = 'object')
);

CREATE INDEX IF NOT EXISTS dropdown_list_lookup_idx
    ON eip_core.dropdown_list (tenant_id, module, code, is_active, version);
CREATE INDEX IF NOT EXISTS dropdown_list_attrs_gin
    ON eip_core.dropdown_list USING gin (attrs);

CREATE TABLE IF NOT EXISTS eip_core.dropdown_value (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    list_id uuid NOT NULL REFERENCES eip_core.dropdown_list (id) ON DELETE CASCADE,
    code text NOT NULL,
    label text NOT NULL,
    sort_order integer NOT NULL DEFAULT 0,
    is_active boolean NOT NULL DEFAULT true,
    attrs jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT dropdown_value_unique UNIQUE (list_id, code),
    CONSTRAINT dropdown_value_code_not_blank_ck CHECK (btrim(code) <> ''),
    CONSTRAINT dropdown_value_label_not_blank_ck CHECK (btrim(label) <> ''),
    CONSTRAINT dropdown_value_attrs_object_ck CHECK (jsonb_typeof(attrs) = 'object')
);

CREATE INDEX IF NOT EXISTS dropdown_value_list_idx
    ON eip_core.dropdown_value (list_id, is_active, sort_order);
CREATE INDEX IF NOT EXISTS dropdown_value_attrs_gin
    ON eip_core.dropdown_value USING gin (attrs);

CREATE TABLE IF NOT EXISTS eip_core.process_def (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES kernel.tenants (tenant_id) ON DELETE RESTRICT,
    code text NOT NULL,
    name text NOT NULL,
    version integer NOT NULL DEFAULT 1,
    is_active boolean NOT NULL DEFAULT true,
    graph jsonb NOT NULL DEFAULT '{}'::jsonb,
    attrs jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT process_def_unique UNIQUE (tenant_id, code, version),
    CONSTRAINT process_def_code_not_blank_ck CHECK (btrim(code) <> ''),
    CONSTRAINT process_def_name_not_blank_ck CHECK (btrim(name) <> ''),
    CONSTRAINT process_def_graph_object_ck CHECK (jsonb_typeof(graph) = 'object'),
    CONSTRAINT process_def_attrs_object_ck CHECK (jsonb_typeof(attrs) = 'object')
);

CREATE INDEX IF NOT EXISTS process_def_tenant_idx
    ON eip_core.process_def (tenant_id);
CREATE INDEX IF NOT EXISTS process_def_active_idx
    ON eip_core.process_def (tenant_id, is_active);
CREATE INDEX IF NOT EXISTS process_def_graph_gin
    ON eip_core.process_def USING gin (graph);
CREATE INDEX IF NOT EXISTS process_def_attrs_gin
    ON eip_core.process_def USING gin (attrs);

CREATE TABLE IF NOT EXISTS eip_core.process_binding (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES kernel.tenants (tenant_id) ON DELETE RESTRICT,
    service_object_type text NOT NULL,
    process_def_id uuid NOT NULL REFERENCES eip_core.process_def (id) ON DELETE RESTRICT,
    task_type text,
    is_active boolean NOT NULL DEFAULT true,
    priority integer NOT NULL DEFAULT 100,
    attrs jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT process_binding_service_object_type_not_blank_ck CHECK (btrim(service_object_type) <> ''),
    CONSTRAINT process_binding_attrs_object_ck CHECK (jsonb_typeof(attrs) = 'object')
);

CREATE UNIQUE INDEX IF NOT EXISTS process_binding_unique
    ON eip_core.process_binding (tenant_id, service_object_type, process_def_id, COALESCE(task_type, ''));
CREATE INDEX IF NOT EXISTS process_binding_lookup_idx
    ON eip_core.process_binding (tenant_id, service_object_type, is_active, priority);
CREATE INDEX IF NOT EXISTS process_binding_attrs_gin
    ON eip_core.process_binding USING gin (attrs);

CREATE TABLE IF NOT EXISTS eip_core.task_template (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES kernel.tenants (tenant_id) ON DELETE RESTRICT,
    process_def_id uuid NOT NULL REFERENCES eip_core.process_def (id) ON DELETE CASCADE,
    service_object_type text,
    task_type text NOT NULL,
    title text,
    description text,
    is_active boolean NOT NULL DEFAULT true,
    sort_order integer NOT NULL DEFAULT 100,
    attrs jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT task_template_task_type_not_blank_ck CHECK (btrim(task_type) <> ''),
    CONSTRAINT task_template_attrs_object_ck CHECK (jsonb_typeof(attrs) = 'object')
);

CREATE UNIQUE INDEX IF NOT EXISTS task_template_unique
    ON eip_core.task_template (tenant_id, process_def_id, COALESCE(service_object_type, ''), task_type);
CREATE INDEX IF NOT EXISTS task_template_lookup_idx
    ON eip_core.task_template (tenant_id, process_def_id, is_active, sort_order);
CREATE INDEX IF NOT EXISTS task_template_attrs_gin
    ON eip_core.task_template USING gin (attrs);

CREATE TABLE IF NOT EXISTS eip_core.task (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES kernel.tenants (tenant_id) ON DELETE RESTRICT,
    service_object_id uuid NOT NULL REFERENCES eip_core.service_object (id) ON DELETE CASCADE,
    process_def_id uuid REFERENCES eip_core.process_def (id) ON DELETE SET NULL,
    task_type text NOT NULL,
    status text NOT NULL DEFAULT 'open',
    title text,
    description text,
    assigned_agent_id uuid REFERENCES eip_core.agent (id) ON DELETE SET NULL,
    due_at timestamptz,
    started_at timestamptz,
    completed_at timestamptz,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    attrs jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT task_task_type_not_blank_ck CHECK (btrim(task_type) <> ''),
    CONSTRAINT task_status_not_blank_ck CHECK (btrim(status) <> ''),
    CONSTRAINT task_payload_object_ck CHECK (jsonb_typeof(payload) = 'object'),
    CONSTRAINT task_attrs_object_ck CHECK (jsonb_typeof(attrs) = 'object')
);

CREATE INDEX IF NOT EXISTS task_tenant_idx
    ON eip_core.task (tenant_id);
CREATE INDEX IF NOT EXISTS task_so_idx
    ON eip_core.task (service_object_id);
CREATE INDEX IF NOT EXISTS task_status_idx
    ON eip_core.task (tenant_id, status);
CREATE INDEX IF NOT EXISTS task_assigned_idx
    ON eip_core.task (assigned_agent_id);
CREATE INDEX IF NOT EXISTS task_due_idx
    ON eip_core.task (due_at);
CREATE INDEX IF NOT EXISTS task_payload_gin
    ON eip_core.task USING gin (payload);
CREATE INDEX IF NOT EXISTS task_attrs_gin
    ON eip_core.task USING gin (attrs);

CREATE TABLE IF NOT EXISTS eip_core.process_instance (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES kernel.tenants (tenant_id) ON DELETE RESTRICT,
    service_object_id uuid NOT NULL REFERENCES eip_core.service_object (id) ON DELETE CASCADE,
    process_def_id uuid NOT NULL REFERENCES eip_core.process_def (id) ON DELETE RESTRICT,
    status text NOT NULL DEFAULT 'active',
    started_at timestamptz NOT NULL DEFAULT now(),
    ended_at timestamptz,
    cursor_json jsonb NOT NULL DEFAULT '{}'::jsonb,
    attrs jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT process_instance_status_not_blank_ck CHECK (btrim(status) <> ''),
    CONSTRAINT process_instance_cursor_object_ck CHECK (jsonb_typeof(cursor_json) = 'object'),
    CONSTRAINT process_instance_attrs_object_ck CHECK (jsonb_typeof(attrs) = 'object')
);

CREATE UNIQUE INDEX IF NOT EXISTS process_instance_one_active
    ON eip_core.process_instance (tenant_id, service_object_id, process_def_id)
    WHERE (ended_at IS NULL);
CREATE INDEX IF NOT EXISTS process_instance_lookup_idx
    ON eip_core.process_instance (tenant_id, process_def_id, status);
CREATE INDEX IF NOT EXISTS process_instance_cursor_gin
    ON eip_core.process_instance USING gin (cursor_json);
CREATE INDEX IF NOT EXISTS process_instance_attrs_gin
    ON eip_core.process_instance USING gin (attrs);

CREATE TABLE IF NOT EXISTS eip_core.service_object_status_event (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES kernel.tenants (tenant_id) ON DELETE RESTRICT,
    service_object_id uuid NOT NULL REFERENCES eip_core.service_object (id) ON DELETE CASCADE,
    from_status text,
    to_status text NOT NULL,
    reason_code text,
    note text,
    occurred_at timestamptz NOT NULL DEFAULT now(),
    actor_agent_id uuid REFERENCES eip_core.agent (id) ON DELETE SET NULL,
    attrs jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT so_status_event_to_status_not_blank_ck CHECK (btrim(to_status) <> ''),
    CONSTRAINT so_status_event_attrs_object_ck CHECK (jsonb_typeof(attrs) = 'object')
);

CREATE INDEX IF NOT EXISTS so_status_event_tenant_object_time_idx
    ON eip_core.service_object_status_event (tenant_id, service_object_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS so_status_event_status_idx
    ON eip_core.service_object_status_event (tenant_id, to_status);
CREATE INDEX IF NOT EXISTS so_status_event_actor_idx
    ON eip_core.service_object_status_event (actor_agent_id);
CREATE INDEX IF NOT EXISTS so_status_event_attrs_gin
    ON eip_core.service_object_status_event USING gin (attrs);

CREATE TABLE IF NOT EXISTS eip_core.task_status_event (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES kernel.tenants (tenant_id) ON DELETE RESTRICT,
    task_id uuid NOT NULL REFERENCES eip_core.task (id) ON DELETE CASCADE,
    from_status text,
    to_status text NOT NULL,
    reason_code text,
    note text,
    occurred_at timestamptz NOT NULL DEFAULT now(),
    actor_agent_id uuid REFERENCES eip_core.agent (id) ON DELETE SET NULL,
    attrs jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT task_status_event_to_status_not_blank_ck CHECK (btrim(to_status) <> ''),
    CONSTRAINT task_status_event_attrs_object_ck CHECK (jsonb_typeof(attrs) = 'object')
);

CREATE INDEX IF NOT EXISTS task_status_event_tenant_task_time_idx
    ON eip_core.task_status_event (tenant_id, task_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS task_status_event_status_idx
    ON eip_core.task_status_event (tenant_id, to_status);
CREATE INDEX IF NOT EXISTS task_status_event_actor_idx
    ON eip_core.task_status_event (actor_agent_id);
CREATE INDEX IF NOT EXISTS task_status_event_attrs_gin
    ON eip_core.task_status_event USING gin (attrs);

CREATE OR REPLACE VIEW eip_core.process_task_template AS
SELECT
    tt.id,
    tt.tenant_id,
    tt.process_def_id,
    tt.service_object_type,
    tt.task_type,
    tt.title,
    tt.description,
    tt.is_active,
    tt.sort_order,
    tt.attrs,
    tt.created_at,
    tt.updated_at
FROM eip_core.task_template tt;

COMMENT ON VIEW eip_core.process_task_template IS
  'Compatibility projection over eip_core.task_template for readiness checks during staged process migration.';

COMMIT;
