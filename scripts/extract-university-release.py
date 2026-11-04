"""Extract a trusted CI archive after rejecting links, escapes and identity mismatches."""
import json
import hashlib
import re
import sys
import tarfile
import tempfile
from pathlib import Path, PurePosixPath


def extract(archive, destination, identity):
    root = Path(destination).resolve(strict=True)
    if any(root.iterdir()):
        raise ValueError("Release destination must be empty")
    if not re.fullmatch(r"[a-f0-9]{40}-[0-9]+-[0-9]+", identity):
        raise ValueError("Invalid expected identity")
    with tarfile.open(archive, "r:gz") as bundle:
        members = bundle.getmembers()
        if len(members) > 2000 or sum(member.size for member in members) > 32 * 1024 * 1024:
            raise ValueError("Release archive exceeds limits")
        paths = set()
        for member in members:
            path = PurePosixPath(member.name)
            if (path.is_absolute() or ".." in path.parts or "\\" in member.name
                    or not (member.isfile() or member.isdir()) or path in paths):
                raise ValueError("Unsafe or duplicate archive entry")
            paths.add(path)
        manifest_member = next((m for m in members if PurePosixPath(m.name) == PurePosixPath("manifest.json")), None)
        if manifest_member is None or not manifest_member.isfile():
            raise ValueError("Missing release manifest")
        manifest = json.load(bundle.extractfile(manifest_member))
        if manifest.get("release_id") != identity or manifest.get("revision") != identity[:40]:
            raise ValueError("Archive identity differs from the workflow")
        # Manually write regular files: no archive ownership, permissions or links are applied.
        for member in members:
            target = root.joinpath(*PurePosixPath(member.name).parts)
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                with bundle.extractfile(member) as source, target.open("xb") as output:
                    import shutil
                    shutil.copyfileobj(source, output)
                # Release files contain public configuration only. Container users must
                # read bind-mounted files even when deployment uses umask 077.
                target.chmod(0o644)
        for directory in root.rglob('*'):
            if directory.is_dir():
                directory.chmod(0o755)
        root.chmod(0o755)


def prepare(archive, destination, identity):
    destination = Path(destination)
    if destination.is_symlink():
        raise ValueError("Linked release destination rejected")
    with tempfile.TemporaryDirectory(prefix='.qc-incoming-', dir=destination.parent) as temporary:
        stage = Path(temporary) / 'release'
        stage.mkdir()
        extract(archive, stage, identity)
        if destination.exists():
            def fingerprints(root):
                result = {}
                for path in root.rglob('*'):
                    if path.is_symlink():
                        raise ValueError("Linked existing release rejected")
                    if path.is_file():
                        result[str(path.relative_to(root))] = hashlib.sha256(path.read_bytes()).hexdigest()
                    elif not path.is_dir():
                        raise ValueError("Special existing release file rejected")
                return result
            if fingerprints(stage) != fingerprints(destination):
                raise ValueError("Existing release differs from the verified artifact")
        else:
            stage.rename(destination)


if __name__ == "__main__":
    prepare(*sys.argv[1:])
