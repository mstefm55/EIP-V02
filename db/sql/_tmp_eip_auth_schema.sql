--
-- PostgreSQL database dump
--

-- Dumped from database version 17.0
-- Dumped by pg_dump version 17.0

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: eip_auth; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA eip_auth;


--
-- Name: SCHEMA eip_auth; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA eip_auth IS 'Authentication & identity layer (isolated from eip_core).';


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: auth_api_key; Type: TABLE; Schema: eip_auth; Owner: -
--

CREATE TABLE eip_auth.auth_api_key (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    key_hash text NOT NULL,
    label text,
    is_active boolean DEFAULT true NOT NULL,
    expires_at timestamp with time zone,
    scopes jsonb DEFAULT '{}'::jsonb NOT NULL,
    attrs jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE auth_api_key; Type: COMMENT; Schema: eip_auth; Owner: -
--

COMMENT ON TABLE eip_auth.auth_api_key IS 'Machine credentials for INTEGRATION realm. Store only key_hash, never raw secrets.';


--
-- Name: auth_credential; Type: TABLE; Schema: eip_auth; Owner: -
--

CREATE TABLE eip_auth.auth_credential (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    identity_id uuid NOT NULL,
    credential_type text NOT NULL,
    secret_hash text,
    secret_enc bytea,
    algorithm text,
    meta jsonb DEFAULT '{}'::jsonb NOT NULL,
    valid_from timestamp with time zone DEFAULT now() NOT NULL,
    valid_to timestamp with time zone,
    is_revoked boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_credential_type CHECK ((credential_type = ANY (ARRAY['password'::text, 'totp'::text, 'api_key'::text, 'oidc'::text])))
);


--
-- Name: auth_device; Type: TABLE; Schema: eip_auth; Owner: -
--

CREATE TABLE eip_auth.auth_device (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    identity_id uuid NOT NULL,
    device_kind text NOT NULL,
    device_id text,
    public_key_pem text,
    trust_state text DEFAULT 'untrusted'::text NOT NULL,
    label text,
    last_seen_at timestamp with time zone,
    attrs jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_device_kind CHECK ((device_kind = ANY (ARRAY['browser'::text, 'electron'::text, 'mobile'::text]))),
    CONSTRAINT chk_trust_state CHECK ((trust_state = ANY (ARRAY['trusted'::text, 'untrusted'::text, 'revoked'::text])))
);


--
-- Name: auth_event; Type: TABLE; Schema: eip_auth; Owner: -
--

CREATE TABLE eip_auth.auth_event (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    identity_id uuid,
    session_id uuid,
    device_id uuid,
    event_type text NOT NULL,
    event_at timestamp with time zone DEFAULT now() NOT NULL,
    ip_address inet,
    user_agent text,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: auth_failed_attempt; Type: TABLE; Schema: eip_auth; Owner: -
--

CREATE TABLE eip_auth.auth_failed_attempt (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    identity_id uuid,
    ip_address inet,
    user_agent text,
    attempted_at timestamp with time zone DEFAULT now()
);


--
-- Name: auth_identity; Type: TABLE; Schema: eip_auth; Owner: -
--

CREATE TABLE eip_auth.auth_identity (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    login text NOT NULL,
    login_type text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    is_locked boolean DEFAULT false NOT NULL,
    attrs jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_login_trim CHECK ((login = btrim(login))),
    CONSTRAINT chk_login_type CHECK ((login_type = ANY (ARRAY['email'::text, 'username'::text, 'phone'::text, 'external'::text])))
);


--
-- Name: auth_identity_agent; Type: TABLE; Schema: eip_auth; Owner: -
--

CREATE TABLE eip_auth.auth_identity_agent (
    identity_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    agent_id uuid NOT NULL,
    is_primary boolean DEFAULT true NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: auth_otp_challenge; Type: TABLE; Schema: eip_auth; Owner: -
--

CREATE TABLE eip_auth.auth_otp_challenge (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    identity_id uuid NOT NULL,
    channel text NOT NULL,
    otp_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    max_attempts integer DEFAULT 5 NOT NULL,
    attempt_count integer DEFAULT 0 NOT NULL,
    is_consumed boolean DEFAULT false NOT NULL,
    consumed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_channel CHECK ((channel = ANY (ARRAY['email'::text, 'sms'::text])))
);


--
-- Name: auth_password_reset; Type: TABLE; Schema: eip_auth; Owner: -
--

CREATE TABLE eip_auth.auth_password_reset (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    identity_id uuid NOT NULL,
    token_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    consumed_at timestamp with time zone,
    requested_at timestamp with time zone DEFAULT now() NOT NULL,
    requested_ip text,
    requested_user_agent text
);


--
-- Name: auth_recovery_request; Type: TABLE; Schema: eip_auth; Owner: -
--

CREATE TABLE eip_auth.auth_recovery_request (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    identity_id uuid NOT NULL,
    login text NOT NULL,
    status text DEFAULT 'PENDING'::text NOT NULL,
    reason text,
    requested_at timestamp with time zone DEFAULT now() NOT NULL,
    requested_ip text,
    requested_user_agent text,
    decided_at timestamp with time zone,
    decided_by uuid,
    decision_reason text
);


--
-- Name: auth_recovery_token; Type: TABLE; Schema: eip_auth; Owner: -
--

CREATE TABLE eip_auth.auth_recovery_token (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    identity_id uuid NOT NULL,
    token_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    consumed_at timestamp with time zone,
    requested_at timestamp with time zone DEFAULT now() NOT NULL,
    requested_ip text,
    requested_user_agent text
);


--
-- Name: auth_session; Type: TABLE; Schema: eip_auth; Owner: -
--

CREATE TABLE eip_auth.auth_session (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    identity_id uuid NOT NULL,
    device_id uuid,
    issued_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    refresh_token_hash text,
    csrf_secret_hash text,
    ip_address inet,
    user_agent_hash text,
    is_revoked boolean DEFAULT false NOT NULL,
    revoked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    attrs jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: COLUMN auth_session.attrs; Type: COMMENT; Schema: eip_auth; Owner: -
--

COMMENT ON COLUMN eip_auth.auth_session.attrs IS 'Session-scoped metadata. Includes realm (EIP|GATEWAY|PUBLIC), plus future gateway fields.';


--
-- Name: auth_api_key auth_api_key_key_hash_key; Type: CONSTRAINT; Schema: eip_auth; Owner: -
--

ALTER TABLE ONLY eip_auth.auth_api_key
    ADD CONSTRAINT auth_api_key_key_hash_key UNIQUE (key_hash);


--
-- Name: auth_api_key auth_api_key_pkey; Type: CONSTRAINT; Schema: eip_auth; Owner: -
--

ALTER TABLE ONLY eip_auth.auth_api_key
    ADD CONSTRAINT auth_api_key_pkey PRIMARY KEY (id);


--
-- Name: auth_credential auth_credential_pkey; Type: CONSTRAINT; Schema: eip_auth; Owner: -
--

ALTER TABLE ONLY eip_auth.auth_credential
    ADD CONSTRAINT auth_credential_pkey PRIMARY KEY (id);


--
-- Name: auth_device auth_device_pkey; Type: CONSTRAINT; Schema: eip_auth; Owner: -
--

ALTER TABLE ONLY eip_auth.auth_device
    ADD CONSTRAINT auth_device_pkey PRIMARY KEY (id);


--
-- Name: auth_event auth_event_pkey; Type: CONSTRAINT; Schema: eip_auth; Owner: -
--

ALTER TABLE ONLY eip_auth.auth_event
    ADD CONSTRAINT auth_event_pkey PRIMARY KEY (id);


--
-- Name: auth_failed_attempt auth_failed_attempt_pkey; Type: CONSTRAINT; Schema: eip_auth; Owner: -
--

ALTER TABLE ONLY eip_auth.auth_failed_attempt
    ADD CONSTRAINT auth_failed_attempt_pkey PRIMARY KEY (id);


--
-- Name: auth_identity_agent auth_identity_agent_pkey; Type: CONSTRAINT; Schema: eip_auth; Owner: -
--

ALTER TABLE ONLY eip_auth.auth_identity_agent
    ADD CONSTRAINT auth_identity_agent_pkey PRIMARY KEY (identity_id, agent_id);


--
-- Name: auth_identity auth_identity_pkey; Type: CONSTRAINT; Schema: eip_auth; Owner: -
--

ALTER TABLE ONLY eip_auth.auth_identity
    ADD CONSTRAINT auth_identity_pkey PRIMARY KEY (id);


--
-- Name: auth_otp_challenge auth_otp_challenge_pkey; Type: CONSTRAINT; Schema: eip_auth; Owner: -
--

ALTER TABLE ONLY eip_auth.auth_otp_challenge
    ADD CONSTRAINT auth_otp_challenge_pkey PRIMARY KEY (id);


--
-- Name: auth_password_reset auth_password_reset_pkey; Type: CONSTRAINT; Schema: eip_auth; Owner: -
--

ALTER TABLE ONLY eip_auth.auth_password_reset
    ADD CONSTRAINT auth_password_reset_pkey PRIMARY KEY (id);


--
-- Name: auth_recovery_request auth_recovery_request_pkey; Type: CONSTRAINT; Schema: eip_auth; Owner: -
--

ALTER TABLE ONLY eip_auth.auth_recovery_request
    ADD CONSTRAINT auth_recovery_request_pkey PRIMARY KEY (id);


--
-- Name: auth_recovery_token auth_recovery_token_pkey; Type: CONSTRAINT; Schema: eip_auth; Owner: -
--

ALTER TABLE ONLY eip_auth.auth_recovery_token
    ADD CONSTRAINT auth_recovery_token_pkey PRIMARY KEY (id);


--
-- Name: auth_session auth_session_pkey; Type: CONSTRAINT; Schema: eip_auth; Owner: -
--

ALTER TABLE ONLY eip_auth.auth_session
    ADD CONSTRAINT auth_session_pkey PRIMARY KEY (id);


--
-- Name: auth_identity uq_auth_identity; Type: CONSTRAINT; Schema: eip_auth; Owner: -
--

ALTER TABLE ONLY eip_auth.auth_identity
    ADD CONSTRAINT uq_auth_identity UNIQUE (tenant_id, login);


--
-- Name: auth_api_key_lookup_idx; Type: INDEX; Schema: eip_auth; Owner: -
--

CREATE INDEX auth_api_key_lookup_idx ON eip_auth.auth_api_key USING btree (tenant_id, is_active, expires_at);


--
-- Name: auth_event_tenant_time_idx; Type: INDEX; Schema: eip_auth; Owner: -
--

CREATE INDEX auth_event_tenant_time_idx ON eip_auth.auth_event USING btree (tenant_id, event_at DESC);


--
-- Name: auth_identity_attrs_gin; Type: INDEX; Schema: eip_auth; Owner: -
--

CREATE INDEX auth_identity_attrs_gin ON eip_auth.auth_identity USING gin (attrs);


--
-- Name: auth_identity_tenant_active_idx; Type: INDEX; Schema: eip_auth; Owner: -
--

CREATE INDEX auth_identity_tenant_active_idx ON eip_auth.auth_identity USING btree (tenant_id, is_active, is_locked);


--
-- Name: auth_identity_tenant_id_uq; Type: INDEX; Schema: eip_auth; Owner: -
--

CREATE UNIQUE INDEX auth_identity_tenant_id_uq ON eip_auth.auth_identity USING btree (tenant_id, id);


--
-- Name: auth_session_realm_idx; Type: INDEX; Schema: eip_auth; Owner: -
--

CREATE INDEX auth_session_realm_idx ON eip_auth.auth_session USING btree (tenant_id, ((attrs ->> 'realm'::text))) WHERE (attrs ? 'realm'::text);


--
-- Name: credential_lookup_idx; Type: INDEX; Schema: eip_auth; Owner: -
--

CREATE INDEX credential_lookup_idx ON eip_auth.auth_credential USING btree (tenant_id, identity_id, credential_type, is_revoked);


--
-- Name: device_last_seen_idx; Type: INDEX; Schema: eip_auth; Owner: -
--

CREATE INDEX device_last_seen_idx ON eip_auth.auth_device USING btree (tenant_id, identity_id, last_seen_at);


--
-- Name: identity_agent_agent_idx; Type: INDEX; Schema: eip_auth; Owner: -
--

CREATE INDEX identity_agent_agent_idx ON eip_auth.auth_identity_agent USING btree (tenant_id, agent_id, is_active);


--
-- Name: identity_agent_one_primary; Type: INDEX; Schema: eip_auth; Owner: -
--

CREATE UNIQUE INDEX identity_agent_one_primary ON eip_auth.auth_identity_agent USING btree (tenant_id, identity_id) WHERE ((is_primary = true) AND (is_active = true));


--
-- Name: idx_auth_failed_attempt_attempted; Type: INDEX; Schema: eip_auth; Owner: -
--

CREATE INDEX idx_auth_failed_attempt_attempted ON eip_auth.auth_failed_attempt USING btree (attempted_at);


--
-- Name: idx_auth_failed_attempt_tenant_identity; Type: INDEX; Schema: eip_auth; Owner: -
--

CREATE INDEX idx_auth_failed_attempt_tenant_identity ON eip_auth.auth_failed_attempt USING btree (tenant_id, identity_id);


--
-- Name: idx_auth_password_reset_lookup; Type: INDEX; Schema: eip_auth; Owner: -
--

CREATE INDEX idx_auth_password_reset_lookup ON eip_auth.auth_password_reset USING btree (token_hash, expires_at, consumed_at);


--
-- Name: idx_auth_password_reset_tenant_identity; Type: INDEX; Schema: eip_auth; Owner: -
--

CREATE INDEX idx_auth_password_reset_tenant_identity ON eip_auth.auth_password_reset USING btree (tenant_id, identity_id, requested_at DESC);


--
-- Name: idx_auth_recovery_request_identity; Type: INDEX; Schema: eip_auth; Owner: -
--

CREATE INDEX idx_auth_recovery_request_identity ON eip_auth.auth_recovery_request USING btree (tenant_id, identity_id, requested_at DESC);


--
-- Name: idx_auth_recovery_request_status; Type: INDEX; Schema: eip_auth; Owner: -
--

CREATE INDEX idx_auth_recovery_request_status ON eip_auth.auth_recovery_request USING btree (status, requested_at DESC);


--
-- Name: idx_auth_recovery_token_identity; Type: INDEX; Schema: eip_auth; Owner: -
--

CREATE INDEX idx_auth_recovery_token_identity ON eip_auth.auth_recovery_token USING btree (tenant_id, identity_id, requested_at DESC);


--
-- Name: idx_auth_recovery_token_lookup; Type: INDEX; Schema: eip_auth; Owner: -
--

CREATE INDEX idx_auth_recovery_token_lookup ON eip_auth.auth_recovery_token USING btree (token_hash, expires_at, consumed_at);


--
-- Name: one_active_totp_per_identity; Type: INDEX; Schema: eip_auth; Owner: -
--

CREATE UNIQUE INDEX one_active_totp_per_identity ON eip_auth.auth_credential USING btree (tenant_id, identity_id) WHERE ((credential_type = 'totp'::text) AND (is_revoked = false) AND (valid_to IS NULL));


--
-- Name: otp_active_idx; Type: INDEX; Schema: eip_auth; Owner: -
--

CREATE INDEX otp_active_idx ON eip_auth.auth_otp_challenge USING btree (tenant_id, identity_id, is_consumed, expires_at);


--
-- Name: session_device_idx; Type: INDEX; Schema: eip_auth; Owner: -
--

CREATE INDEX session_device_idx ON eip_auth.auth_session USING btree (tenant_id, device_id);


--
-- Name: session_lookup_idx; Type: INDEX; Schema: eip_auth; Owner: -
--

CREATE INDEX session_lookup_idx ON eip_auth.auth_session USING btree (tenant_id, identity_id, is_revoked, expires_at);


--
-- Name: uq_device_browser; Type: INDEX; Schema: eip_auth; Owner: -
--

CREATE UNIQUE INDEX uq_device_browser ON eip_auth.auth_device USING btree (tenant_id, identity_id, device_kind, device_id) WHERE ((device_kind = 'browser'::text) AND (device_id IS NOT NULL));


--
-- Name: uq_device_electron_key; Type: INDEX; Schema: eip_auth; Owner: -
--

CREATE UNIQUE INDEX uq_device_electron_key ON eip_auth.auth_device USING btree (tenant_id, identity_id, device_kind, public_key_pem) WHERE ((device_kind = 'electron'::text) AND (public_key_pem IS NOT NULL));


--
-- Name: auth_device trg_auth_device_set_updated_at; Type: TRIGGER; Schema: eip_auth; Owner: -
--

CREATE TRIGGER trg_auth_device_set_updated_at BEFORE UPDATE ON eip_auth.auth_device FOR EACH ROW EXECUTE FUNCTION eip_core.tg_set_updated_at();


--
-- Name: auth_identity trg_auth_identity_set_updated_at; Type: TRIGGER; Schema: eip_auth; Owner: -
--

CREATE TRIGGER trg_auth_identity_set_updated_at BEFORE UPDATE ON eip_auth.auth_identity FOR EACH ROW EXECUTE FUNCTION eip_core.tg_set_updated_at();


--
-- Name: auth_api_key auth_api_key_tenant_id_fkey; Type: FK CONSTRAINT; Schema: eip_auth; Owner: -
--

ALTER TABLE ONLY eip_auth.auth_api_key
    ADD CONSTRAINT auth_api_key_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES eip_core.tenant(id) ON DELETE CASCADE;


--
-- Name: auth_failed_attempt auth_failed_attempt_identity_id_fkey; Type: FK CONSTRAINT; Schema: eip_auth; Owner: -
--

ALTER TABLE ONLY eip_auth.auth_failed_attempt
    ADD CONSTRAINT auth_failed_attempt_identity_id_fkey FOREIGN KEY (identity_id) REFERENCES eip_auth.auth_identity(id);


--
-- Name: auth_failed_attempt auth_failed_attempt_tenant_id_fkey; Type: FK CONSTRAINT; Schema: eip_auth; Owner: -
--

ALTER TABLE ONLY eip_auth.auth_failed_attempt
    ADD CONSTRAINT auth_failed_attempt_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES eip_core.tenant(id);


--
-- Name: auth_identity auth_identity_tenant_id_fkey; Type: FK CONSTRAINT; Schema: eip_auth; Owner: -
--

ALTER TABLE ONLY eip_auth.auth_identity
    ADD CONSTRAINT auth_identity_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES eip_core.tenant(id) ON DELETE CASCADE;


--
-- Name: auth_password_reset auth_password_reset_identity_id_fkey; Type: FK CONSTRAINT; Schema: eip_auth; Owner: -
--

ALTER TABLE ONLY eip_auth.auth_password_reset
    ADD CONSTRAINT auth_password_reset_identity_id_fkey FOREIGN KEY (identity_id) REFERENCES eip_auth.auth_identity(id) ON DELETE CASCADE;


--
-- Name: auth_password_reset auth_password_reset_tenant_id_fkey; Type: FK CONSTRAINT; Schema: eip_auth; Owner: -
--

ALTER TABLE ONLY eip_auth.auth_password_reset
    ADD CONSTRAINT auth_password_reset_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES eip_core.tenant(id) ON DELETE CASCADE;


--
-- Name: auth_recovery_request auth_recovery_request_identity_id_fkey; Type: FK CONSTRAINT; Schema: eip_auth; Owner: -
--

ALTER TABLE ONLY eip_auth.auth_recovery_request
    ADD CONSTRAINT auth_recovery_request_identity_id_fkey FOREIGN KEY (identity_id) REFERENCES eip_auth.auth_identity(id) ON DELETE CASCADE;


--
-- Name: auth_recovery_request auth_recovery_request_tenant_id_fkey; Type: FK CONSTRAINT; Schema: eip_auth; Owner: -
--

ALTER TABLE ONLY eip_auth.auth_recovery_request
    ADD CONSTRAINT auth_recovery_request_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES eip_core.tenant(id) ON DELETE CASCADE;


--
-- Name: auth_recovery_token auth_recovery_token_identity_id_fkey; Type: FK CONSTRAINT; Schema: eip_auth; Owner: -
--

ALTER TABLE ONLY eip_auth.auth_recovery_token
    ADD CONSTRAINT auth_recovery_token_identity_id_fkey FOREIGN KEY (identity_id) REFERENCES eip_auth.auth_identity(id) ON DELETE CASCADE;


--
-- Name: auth_recovery_token auth_recovery_token_tenant_id_fkey; Type: FK CONSTRAINT; Schema: eip_auth; Owner: -
--

ALTER TABLE ONLY eip_auth.auth_recovery_token
    ADD CONSTRAINT auth_recovery_token_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES eip_core.tenant(id) ON DELETE CASCADE;


--
-- Name: auth_credential fk_credential_identity; Type: FK CONSTRAINT; Schema: eip_auth; Owner: -
--

ALTER TABLE ONLY eip_auth.auth_credential
    ADD CONSTRAINT fk_credential_identity FOREIGN KEY (tenant_id, identity_id) REFERENCES eip_auth.auth_identity(tenant_id, id) ON DELETE CASCADE;


--
-- Name: auth_device fk_device_identity; Type: FK CONSTRAINT; Schema: eip_auth; Owner: -
--

ALTER TABLE ONLY eip_auth.auth_device
    ADD CONSTRAINT fk_device_identity FOREIGN KEY (tenant_id, identity_id) REFERENCES eip_auth.auth_identity(tenant_id, id) ON DELETE CASCADE;


--
-- Name: auth_identity_agent fk_identity_agent_agent; Type: FK CONSTRAINT; Schema: eip_auth; Owner: -
--

ALTER TABLE ONLY eip_auth.auth_identity_agent
    ADD CONSTRAINT fk_identity_agent_agent FOREIGN KEY (tenant_id, agent_id) REFERENCES eip_core.agent(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: auth_identity_agent fk_identity_agent_identity; Type: FK CONSTRAINT; Schema: eip_auth; Owner: -
--

ALTER TABLE ONLY eip_auth.auth_identity_agent
    ADD CONSTRAINT fk_identity_agent_identity FOREIGN KEY (tenant_id, identity_id) REFERENCES eip_auth.auth_identity(tenant_id, id) ON DELETE CASCADE;


--
-- Name: auth_otp_challenge fk_otp_identity; Type: FK CONSTRAINT; Schema: eip_auth; Owner: -
--

ALTER TABLE ONLY eip_auth.auth_otp_challenge
    ADD CONSTRAINT fk_otp_identity FOREIGN KEY (tenant_id, identity_id) REFERENCES eip_auth.auth_identity(tenant_id, id) ON DELETE CASCADE;


--
-- Name: auth_session fk_session_device; Type: FK CONSTRAINT; Schema: eip_auth; Owner: -
--

ALTER TABLE ONLY eip_auth.auth_session
    ADD CONSTRAINT fk_session_device FOREIGN KEY (device_id) REFERENCES eip_auth.auth_device(id) ON DELETE SET NULL;


--
-- Name: auth_session fk_session_identity; Type: FK CONSTRAINT; Schema: eip_auth; Owner: -
--

ALTER TABLE ONLY eip_auth.auth_session
    ADD CONSTRAINT fk_session_identity FOREIGN KEY (tenant_id, identity_id) REFERENCES eip_auth.auth_identity(tenant_id, id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--
