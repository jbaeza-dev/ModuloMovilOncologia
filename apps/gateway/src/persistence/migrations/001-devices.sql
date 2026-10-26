-- P03 activates device operations. Never store a central JWT, refresh token or clinical profile here.
CREATE FUNCTION gw_push_digest(text) RETURNS bytea LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
 AS $$ SELECT sha256(convert_to($1,'UTF8')) $$;
CREATE TABLE gw_device (
 id uuid PRIMARY KEY, owner_id uuid NOT NULL, installation_id uuid NOT NULL,
 push_provider text NOT NULL CHECK (push_provider IN ('expo','fcm')),
 push_token text NOT NULL CHECK (length(push_token) BETWEEN 1 AND 4096),
 platform text NOT NULL CHECK (platform='android'), model varchar(128), app_version varchar(128), os_version varchar(128),
 active boolean NOT NULL DEFAULT true, token_enabled boolean NOT NULL DEFAULT true,
 version integer NOT NULL DEFAULT 1 CHECK (version > 0),
 last_seen_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz,
 CHECK (active = (revoked_at IS NULL)), UNIQUE(owner_id,id)
);
CREATE UNIQUE INDEX gw_one_active_installation ON gw_device(installation_id) WHERE active;
-- Fixed SHA-256 digest also supports the contract's 4096-character tokens beyond the B-tree tuple limit.
CREATE UNIQUE INDEX gw_one_active_token ON gw_device(push_provider,gw_push_digest(push_token)) WHERE active;
CREATE INDEX gw_device_owner_page ON gw_device(owner_id,created_at DESC,id ASC);
