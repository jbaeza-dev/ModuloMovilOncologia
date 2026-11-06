#!/usr/bin/env python3
"""Validate the host-owned dotenv without executing it; render least-privilege env files."""
import argparse
import json
import os
import re
from pathlib import Path
from urllib.parse import quote, urlparse

SERVICE_KEYS = {
    "postgres": ["POSTGRES_USER", "POSTGRES_DB", "POSTGRES_PASSWORD", "QC_ADMIN_PASSWORD", "QC_REPLICA_PASSWORD", "QC_GATEWAY_PASSWORD", "QC_STORAGE_PASSWORD"],
    "jwks": ["AUTH_EXPECTED_ISSUER", "AUTH_ALLOWED_ALGORITHM"],
    "clinical": ["AUTH_JWKS_MODE", "APP_ENV", "DATABASE_URL", "DEMO_CONTROL_KEY", "AUTH_PROVIDER", "AUTH_EXPECTED_ISSUER", "AUTH_EXPECTED_AUDIENCE", "AUTH_ALLOWED_ALGORITHM", "AUTH_JWKS_URL", "AUTH_PUBLIC_KEY", "SIMULATOR_PUBLIC_BASE_URL", "AI_SERVICE_URL", "EDUCATION_MEDIA_ROOT", "EDUCATION_TEMP_DIR", "API_DOCS_ENABLED", "PREPARATION_ENABLED", "EVALUATION_PATIENT_EMAILS", "OPERATOR_ALLOWED_EMAILS", "GEMINI_API_KEY"],
    "gateway": ["AUTH_JWKS_MODE", "APP_ENV", "GATEWAY_DATABASE_URL", "CLINICAL_API_URL", "AI_API_URL", "AUTH_EXPECTED_ISSUER", "AUTH_EXPECTED_AUDIENCE", "AUTH_ALLOWED_ALGORITHM", "AUTH_JWKS_URL", "GATEWAY_CURSOR_KEY", "GATEWAY_PUBLIC_BASE_URL", "PUSH_PROVIDER", "EXPO_ACCESS_TOKEN", "API_DOCS_ENABLED"],
    "powersync": ["AUTH_JWKS_MODE", "PS_SOURCE_URI", "PS_STORAGE_URI", "PS_ADMIN_TOKEN", "PS_JWKS_URI"],
}
def read_env(path):
    values = {}
    for number, line in enumerate(Path(path).read_text(encoding="utf-8-sig").splitlines(), 1):
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        key, separator, value = line.partition("=")
        if not separator or not re.fullmatch(r"[A-Z][A-Z0-9_]*", key) or key in values:
            raise ValueError(f"Invalid or duplicate variable at line {number}")
        if "\0" in value or value.startswith(("'", '"')):
            raise ValueError(f"{key}: use an unquoted single-line value")
        values[key] = value
    return values

def configuration(values):
    values = dict(values)
    required = ["POSTGRES_PASSWORD","QC_ADMIN_PASSWORD","QC_REPLICA_PASSWORD","QC_GATEWAY_PASSWORD","QC_STORAGE_PASSWORD","DEMO_CONTROL_KEY","GATEWAY_CURSOR_KEY","PS_ADMIN_TOKEN","AUTH_EXPECTED_ISSUER","AUTH_PUBLIC_KEY","PUBLIC_ORIGIN","IMAGE_NAMESPACE"]
    for key in required:
        value = values.get(key, "")
        if not value or re.search(r"REEMPLAZAR|GENERAR_|DOMINIO_INSTITUCIONAL|PROJECT_ID|CHANGE_ME", value, re.I):
            raise ValueError(f"{key}: required real value, placeholder rejected")
    for key in required[:8]:
        if len(values[key]) < 32:
            raise ValueError(f"{key}: at least 32 characters required")
    if len({values[key] for key in required[:8]}) != 8:
        raise ValueError("Database passwords and service keys must be different")
    origin = urlparse(values["PUBLIC_ORIGIN"])
    issuer = urlparse(values["AUTH_EXPECTED_ISSUER"])
    if origin.scheme != "https" or not origin.hostname or origin.path not in ("", "/") or origin.query or origin.fragment or origin.username is not None or origin.password is not None:
        raise ValueError("PUBLIC_ORIGIN: HTTPS origin without a path required")
    if issuer.scheme != "https" or not issuer.hostname or issuer.username is not None or issuer.password is not None or issuer.query or issuer.fragment or not issuer.path.endswith("/auth/v1"):
        raise ValueError("AUTH_EXPECTED_ISSUER: project HTTPS /auth/v1 URL required")
    # Accessing .port validates malformed or out-of-range ports before writers stop.
    origin.port, issuer.port
    public_key = values["AUTH_PUBLIC_KEY"]
    if not public_key.startswith("sb_publishable_"):
        import base64
        try:
            payload = public_key.split(".")[1]
            if json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))["role"] != "anon":
                raise ValueError()
        except (ValueError, KeyError, IndexError):
            raise ValueError("AUTH_PUBLIC_KEY: publishable or legacy anon key required") from None
    algorithm = values.get("AUTH_ALLOWED_ALGORITHM", "ES256")
    if algorithm not in ("ES256","RS256"):
        raise ValueError("AUTH_ALLOWED_ALGORITHM: ES256 or RS256 required")
    for key in ("API_DOCS_ENABLED","PREPARATION_ENABLED","INITIALIZE_SYNTHETIC_DATABASE"):
        if values.get(key, "false") not in ("true","false"):
            raise ValueError(f"{key}: true or false required")
    if values.get("PREPARATION_ENABLED") == "true" and values.get("API_DOCS_ENABLED") != "true":
        raise ValueError("PREPARATION_ENABLED requires API_DOCS_ENABLED=true")
    public = values["PUBLIC_ORIGIN"].rstrip("/")
    if not re.fullmatch(r"ghcr\.io/[a-z0-9_.-]+", values["IMAGE_NAMESPACE"]):
        raise ValueError("IMAGE_NAMESPACE: ghcr.io/lowercase-owner required")
    mode = values.get("AUTH_JWKS_MODE", "direct")
    if mode not in ("direct", "distributed"):
        raise ValueError("AUTH_JWKS_MODE: direct or distributed required")
    values["AUTH_JWKS_MODE"] = mode
    jwks = values["AUTH_EXPECTED_ISSUER"].rstrip("/") + "/.well-known/jwks.json"
    if mode == "distributed":
        jwks = "http://qc-jwks:3004/jwks.json"
    def uri(role, password, db):
        return f"postgresql://{role}:{quote(values[password], safe='')}@qc-postgres:5432/{db}"
    values.update({
        "POSTGRES_USER":"postgres","POSTGRES_DB":"postgres","APP_ENV":"universidad-demo","AUTH_PROVIDER":"supabase","AUTH_EXPECTED_AUDIENCE":"authenticated",
        "AUTH_ALLOWED_ALGORITHM":algorithm,"AUTH_JWKS_URL":jwks,"PS_JWKS_URI":jwks,
        "DATABASE_URL":uri("qc_admin","QC_ADMIN_PASSWORD","qc_demo"),
        "GATEWAY_DATABASE_URL":uri("qc_gateway","QC_GATEWAY_PASSWORD","qc_gateway_demo"),
        "PS_SOURCE_URI":uri("qc_replica","QC_REPLICA_PASSWORD","qc_demo")+"?sslmode=disable",
        "PS_STORAGE_URI":uri("qc_storage","QC_STORAGE_PASSWORD","qc_powersync")+"?sslmode=disable",
        "SIMULATOR_PUBLIC_BASE_URL":public+"/quimiocare","GATEWAY_PUBLIC_BASE_URL":public+"/quimiocare-backend",
        "POWERSYNC_PUBLIC_BASE_URL":public+"/quimiocare-backend",
        "CLINICAL_API_URL":"http://qc-clinical:3002","AI_API_URL":"http://qc-ai:3003","AI_SERVICE_URL":"http://qc-ai:3003",
        "EDUCATION_MEDIA_ROOT":"/var/lib/quimiocare/educacion","EDUCATION_TEMP_DIR":"/var/lib/quimiocare/temp","PUSH_PROVIDER":"expo",
        "API_DOCS_ENABLED":values.get("API_DOCS_ENABLED","false"),"PREPARATION_ENABLED":values.get("PREPARATION_ENABLED","false"),
    })
    if "OPERATOR_ALLOWED_EMAILS" in values:
        operators = values["OPERATOR_ALLOWED_EMAILS"]
        if any(not re.fullmatch(r"[^\s,@]+@[^\s,@]+\.[^\s,@]+", item.strip()) for item in operators.split(",") if item.strip()):
            raise ValueError("OPERATOR_ALLOWED_EMAILS: comma-separated emails required")
    emails = values.get("EVALUATION_PATIENT_EMAILS", "")
    if any(not re.fullmatch(r"[^@\s,]+@[^@\s,]+\.[^@\s,]+", email) for email in emails.split(",") if email):
        raise ValueError("EVALUATION_PATIENT_EMAILS: comma-separated emails required")
    return values

def render(source, output):
    if Path(source).is_symlink():
        raise ValueError("Environment symlinks are not accepted")
    values = configuration(read_env(source))
    root = Path(output)
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    if root.is_symlink():
        raise ValueError("Environment destination cannot be a symlink")
    os.chmod(root, 0o700)
    for service, keys in SERVICE_KEYS.items():
        path = root / (service + ".env")
        if path.is_symlink():
            raise ValueError("Service env cannot be a symlink")
        path.write_text("".join(key+"="+values[key]+"\n" for key in keys if key in values), encoding="utf-8", newline="\n")
        os.chmod(path, 0o600)
    return values

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("source")
    parser.add_argument("--output")
    parser.add_argument("--get", choices=["AUTH_JWKS_MODE","API_DOCS_ENABLED","PREPARATION_ENABLED","PUBLIC_ORIGIN","INITIALIZE_SYNTHETIC_DATABASE","IMAGE_NAMESPACE"])
    args = parser.parse_args()
    try:
        if args.get:
            values = configuration(read_env(args.source))
            print(values.get(args.get, "false"))
        elif args.output:
            render(args.source, args.output)
        else:
            configuration(read_env(args.source))
        if not args.get:
            print("Environment valid; no secret values printed.")
    except (ValueError, OSError) as error:
        parser.exit(1, str(error) + "\n")
