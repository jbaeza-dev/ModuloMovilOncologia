#!/usr/bin/env python3
"""DNS/TCP/SSH-banner diagnosis only: no authentication or remote commands."""
import errno
import json
import os
import re
import socket
import time
from urllib.parse import urlsplit


def error_code(error):
    if isinstance(error, (TimeoutError, socket.timeout)):
        return "TIMEOUT"
    code = getattr(error, "errno", None)
    if code in (errno.ECONNREFUSED, 10061):
        return "REFUSED"
    if code in (errno.ENETUNREACH, errno.EHOSTUNREACH, 10051, 10065):
        return "UNREACHABLE"
    return "NETWORK_ERROR"


def inspect_target(host, port, public_origin, resolve=socket.getaddrinfo,
                   connect=socket.create_connection, tcp_timeout=5, banner_timeout=3):
    result = {"authenticationAttempted": False, "remoteCommandsExecuted": False,
              "attempts": [], "dns": "NOT_ATTEMPTED"}
    # Never copy raw configuration or exception messages into diagnostics.
    if (not isinstance(host, str) or not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9.-]*", host)
            or not isinstance(port, str) or not re.fullmatch(r"[0-9]{1,5}", port)
            or not 1 <= int(port) <= 65535):
        return {**result, "verdict": "INVALID_SSH_CONFIGURATION"}
    try:
        origin = urlsplit(public_origin or "")
        public_host = origin.hostname if (origin.scheme == "https" and not origin.username
                                         and not origin.password) else None
    except ValueError:
        public_host = None
    matches = bool(public_host and host.lower().rstrip(".") == public_host.lower().rstrip("."))
    result.update(hostMatchesPublicOrigin=matches, portIs22=int(port) == 22)
    try:
        addresses = resolve(host, int(port), type=socket.SOCK_STREAM)
    except OSError:
        return {**result, "dns": "FAILED", "verdict": "DNS_RESOLUTION_FAILED"}
    result["dns"] = "RESOLVED"
    result["resolvedAddressCount"] = len(addresses)
    # Bound traffic to one address per family, on the configured SSH port only.
    selected = {}
    for family, _kind, _proto, _canon, address in addresses:
        if family in (socket.AF_INET, socket.AF_INET6) and family not in selected:
            selected[family] = address[0]
    for family, address in selected.items():
        attempt = {"family": "IPv6" if family == socket.AF_INET6 else "IPv4",
                   "tcpConnected": False}
        if matches:
            attempt["address"] = address  # Only addresses of the already-public origin.
        try:
            with connect((address, int(port)), timeout=tcp_timeout) as client:
                attempt["tcpConnected"] = True
                deadline = time.monotonic() + banner_timeout
                # SSH sends identification before authentication. Send zero bytes.
                banner = bytearray()
                try:
                    while len(banner) < 2048:
                        remaining = deadline - time.monotonic()
                        if remaining <= 0:
                            break
                        client.settimeout(remaining)
                        chunk = client.recv(min(512, 2048 - len(banner)))
                        if not chunk:
                            break
                        banner.extend(chunk)
                        match = re.search(rb"(?:^|\n)(SSH-(?:2\.0|1\.99)-[A-Za-z0-9._+\-]{1,100})(?:[ \r\n]|$)", banner)
                        if match:
                            attempt["sshIdentification"] = match[1].decode("ascii")
                            break
                except OSError:
                    pass  # A delayed banner does not prove that TCP is blocked.
        except OSError as error:
            attempt["error"] = error_code(error)
        result["attempts"].append(attempt)
    if any(v.get("sshIdentification") for v in result["attempts"]):
        result["verdict"] = "SSH_REACHABLE_BEFORE_AUTHENTICATION"
    elif any(v["tcpConnected"] for v in result["attempts"]):
        result["verdict"] = "TCP_REACHABLE_SSH_IDENTIFICATION_UNCONFIRMED"
    elif not result["attempts"]:
        result["verdict"] = "DNS_RETURNED_NO_SUPPORTED_ADDRESS"
    elif any(v.get("error") == "TIMEOUT" for v in result["attempts"]):
        result["verdict"] = "SSH_TCP_TIMEOUT_FROM_RUNNER"
    elif all(v.get("error") == "REFUSED" for v in result["attempts"]):
        result["verdict"] = "SSH_PORT_REFUSED_FROM_RUNNER"
    else:
        result["verdict"] = "SSH_NETWORK_UNREACHABLE_FROM_RUNNER"
    return result


def main():
    result = inspect_target(os.environ.get("SSH_HOST"), os.environ.get("SSH_PORT"),
                            os.environ.get("QC_PUBLIC_ORIGIN"))
    rendered = json.dumps(result, indent=2, ensure_ascii=True)
    print(rendered)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as file:
            file.write("\n### Diagnóstico de conectividad SSH\n\n```json\n" + rendered + "\n```\n")
    return 0 if any(v["tcpConnected"] for v in result["attempts"]) else 1


if __name__ == "__main__":
    raise SystemExit(main())
