"""Exercise safe, credential-free SSH connectivity diagnosis."""
import errno
import importlib.util
import json
import socket
import socketserver
import threading
import unittest
from pathlib import Path

PATH = Path(__file__).resolve().parents[1] / "scripts" / "diagnose-ssh.py"
SPEC = importlib.util.spec_from_file_location("ssh_connectivity", PATH)
DIAG = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(DIAG)


def address(ip="127.0.0.1", family=socket.AF_INET):
    return (family, socket.SOCK_STREAM, 6, "", (ip, 22))


class ConnectivityTests(unittest.TestCase):
    def test_real_ssh_banner_receives_no_authentication_or_command_bytes(self):
        received = []
        class Handler(socketserver.BaseRequestHandler):
            def handle(self):
                self.request.settimeout(2)
                self.request.sendall(b"SSH-2.0-TestServer_1.0 comment\r\n")
                received.append(self.request.recv(256))
        with socketserver.TCPServer(("127.0.0.1", 0), Handler) as server:
            thread = threading.Thread(target=server.handle_request)
            thread.start()
            result = DIAG.inspect_target("public.example", str(server.server_address[1]),
                                         "https://public.example", resolve=lambda *a, **k: [address()])
            thread.join(3)
        self.assertFalse(thread.is_alive())
        self.assertEqual(received, [b""])
        self.assertEqual(result["verdict"], "SSH_REACHABLE_BEFORE_AUTHENTICATION")
        self.assertEqual(result["attempts"][0]["sshIdentification"], "SSH-2.0-TestServer_1.0")
        self.assertFalse(result["authenticationAttempted"])
        self.assertFalse(result["remoteCommandsExecuted"])

    def test_dns_error_redacts_hostname_and_exception_details(self):
        def fail(*a, **k):
            raise socket.gaierror(socket.EAI_AGAIN, "secret-host.internal 9876 secret-value")
        result = DIAG.inspect_target("secret-host.internal", "9876", "https://public.example", resolve=fail)
        self.assertEqual(result["verdict"], "DNS_RESOLUTION_FAILED")
        self.assertNotIn("secret-host", json.dumps(result))
        self.assertNotIn("9876", json.dumps(result))
        self.assertNotIn("secret-value", json.dumps(result))

    def test_invalid_configuration_never_resolves_or_connects(self):
        def unexpected(*a, **k):
            raise AssertionError("Network must not be contacted")
        for host, port in [("https://private.example/path", "22"), ("private.example", "22x"),
                           ("private.example", "0"), ("private.example", "65536"), (None, "22")]:
            result = DIAG.inspect_target(host, port, None, resolve=unexpected, connect=unexpected)
            self.assertEqual(result["verdict"], "INVALID_SSH_CONFIGURATION")
            self.assertEqual(result["attempts"], [])

    def test_timeout_and_refusal_are_distinct_without_leaking_target(self):
        for error, verdict in [(TimeoutError("private detail"), "SSH_TCP_TIMEOUT_FROM_RUNNER"),
                               (OSError(errno.ECONNREFUSED, "private detail"), "SSH_PORT_REFUSED_FROM_RUNNER")]:
            def fail(*a, **k):
                raise error
            result = DIAG.inspect_target("secret.internal", "9876", "https://public.example",
                                         resolve=lambda *a, **k: [address("192.0.2.1")], connect=fail)
            self.assertEqual(result["verdict"], verdict)
            self.assertNotIn("private detail", json.dumps(result))
            self.assertNotIn("192.0.2.1", json.dumps(result))

    def test_only_one_address_per_family_is_probed_and_ipv4_can_follow_ipv6_failure(self):
        calls = []
        class Client:
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def settimeout(self, value): pass
            def recv(self, size): return b"SSH-2.0-Fake_1.0\r\n"
        def connect(target, timeout):
            calls.append(target)
            if ":" in target[0]: raise OSError(errno.ENETUNREACH, "redacted")
            return Client()
        lookup = [address("2001:db8::1", socket.AF_INET6), address("2001:db8::2", socket.AF_INET6),
                  address("192.0.2.1"), address("192.0.2.2")]
        result = DIAG.inspect_target("public.example", "22", "https://public.example",
                                     resolve=lambda *a, **k: lookup, connect=connect)
        self.assertEqual(calls, [("2001:db8::1", 22), ("192.0.2.1", 22)])
        self.assertEqual(result["verdict"], "SSH_REACHABLE_BEFORE_AUTHENTICATION")
        self.assertEqual(result["attempts"][0]["error"], "UNREACHABLE")

    def test_silent_open_port_is_not_reported_as_blocked_tcp(self):
        class Client:
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def settimeout(self, value): pass
            def recv(self, size): raise TimeoutError("no banner")
        result = DIAG.inspect_target("public.example", "22", "https://public.example",
                                     resolve=lambda *a, **k: [address()], connect=lambda *a, **k: Client())
        self.assertTrue(result["attempts"][0]["tcpConnected"])
        self.assertEqual(result["verdict"], "TCP_REACHABLE_SSH_IDENTIFICATION_UNCONFIRMED")


if __name__ == "__main__":
    unittest.main()
