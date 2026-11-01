#!/usr/bin/env python3
"""Validate an immutable CI release and render Quadlets without sourcing shell data."""
import argparse
import hashlib
import json
import os
import re
from pathlib import Path

def checksum(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()

def verify(root, namespace):
    root = Path(root).resolve(strict=True)
    manifest = json.loads((root/"manifest.json").read_text(encoding="utf-8-sig"))
    if manifest.get("schema") != 2 or not re.fullmatch(r"[0-9a-f]{40}", manifest.get("revision","")):
        raise ValueError("Unsupported release manifest/revision")
    if not re.fullmatch(r"[0-9a-f]{40}-[0-9]+-[0-9]+", manifest.get("release_id","")):
        raise ValueError("Invalid release identity")
    if not manifest["release_id"].startswith(manifest["revision"]+"-"):
        raise ValueError("Release identity/revision mismatch")
    if manifest.get("platform") != "linux/amd64" or type(manifest.get("sequence")) is not int or manifest["sequence"] < 1:
        raise ValueError("Invalid release platform/sequence")
    if not re.fullmatch(r"ghcr\.io/[a-z0-9_.-]+", namespace):
        raise ValueError("Invalid image namespace")
    for name in ("simulator","gateway"):
        expected = re.escape(namespace+"/quimiocare-"+name+"@sha256:") + r"[a-f0-9]{64}"
        if not re.fullmatch(expected, manifest["images"][name]["reference"]):
            raise ValueError("Release image publisher or digest mismatch")
    files = manifest.get("files",{})
    required = {"infra/universidad/scripts/deploy.sh","infra/universidad/scripts/backup.sh","infra/universidad/scripts/smoke.sh","infra/universidad/scripts/environment.py"}
    if not required.issubset(files):
        raise ValueError("Release missing operational files")
    for relative, digest in files.items():
        path = Path(relative)
        if path.is_absolute() or ".." in path.parts or "\\" in relative or not re.fullmatch(r"[a-zA-Z0-9_./-]+", relative):
            raise ValueError("Invalid manifest path")
        target = root/path
        if not target.resolve(strict=True).is_relative_to(root) or any(p.is_symlink() for p in [target,*target.parents] if p != root.parent):
            raise ValueError("Linked or escaping release file")
        if not re.fullmatch(r"[a-f0-9]{64}", digest) or checksum(target) != digest:
            raise ValueError("Release checksum mismatch: "+relative)
    return manifest

def render(root, manifest, output):
    output = Path(output)
    if output.is_symlink():
        raise ValueError("Linked Quadlet destination rejected")
    output.mkdir(parents=True, exist_ok=True)
    for path in (Path(root)/"infra/universidad/quadlet").iterdir():
        if path.suffix not in (".container",".volume",".network"):
            continue
        content = path.read_text(encoding="utf-8").replace("@@SIMULATOR_IMAGE@@",manifest["images"]["simulator"]["reference"]).replace("@@GATEWAY_IMAGE@@",manifest["images"]["gateway"]["reference"])
        if "@@" in content:
            raise ValueError("Unrendered Quadlet placeholder")
        target = output/path.name
        if target.is_symlink():
            raise ValueError("Linked Quadlet file rejected")
        target.write_text(content,encoding="utf-8",newline="\n")

def activate(root, target):
    root = Path(root).resolve(strict=True)
    target = Path(target).resolve(strict=True)
    if not target.is_relative_to(root/"releases"):
        raise ValueError("Current target must remain under releases")
    current = root/"current"
    if current.exists() and not current.is_symlink():
        raise ValueError("Refusing to replace a real current directory")
    temporary = root/("current-next-"+str(os.getpid()))
    if temporary.exists() or temporary.is_symlink():
        raise ValueError("Temporary release link already exists")
    temporary.symlink_to(target, target_is_directory=True)
    temporary.replace(current)

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("release")
    parser.add_argument("--namespace",required=True)
    parser.add_argument("--render")
    parser.add_argument("--get",choices=["simulator","gateway","release_id","revision","sequence"])
    parser.add_argument("--activate-root")
    args = parser.parse_args()
    try:
        manifest = verify(args.release,args.namespace)
        if args.render:
            render(args.release,manifest,args.render)
        if args.activate_root:
            activate(args.activate_root,args.release)
        if args.get:
            print(manifest["images"][args.get]["reference"] if args.get in ("simulator","gateway") else manifest[args.get])
        else:
            print("Release checksums and immutable image references verified.")
    except (ValueError,KeyError,OSError) as error:
        parser.exit(1,str(error)+"\n")
