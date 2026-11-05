#!/bin/bash
set -euo pipefail

usage() {
  echo "usage: scripts/release/prepare-intel.sh <Ardia.app> <Chromium Framework.framework> <new-output-dir> <app-source-commit> <engine-source-commit>"
  echo "Prepares experimental Intel assets, source archives, provenance and checksums; publishes nothing."
  exit "${1:-0}"
}
[[ "${1:-}" != --help ]] || usage
[[ $# -eq 5 ]] || usage 64
repo=$(cd "$(dirname "$0")/../.." && pwd)
app=$(cd "$1" && pwd)
engine=$(cd "$2" && pwd)
out=$3
app_commit=$(git -C "$repo" rev-parse "$4^{commit}")
engine_commit=$(git -C "$repo" rev-parse "$5^{commit}")
release_commit=$(git -C "$repo" rev-parse HEAD)
[[ ! -e "$out" ]] || { echo "refusing to overwrite $out" >&2; exit 1; }
[[ "$(lipo -archs "$app/Contents/MacOS/Ardia")" == x86_64 ]] || { echo "app must be Intel-only" >&2; exit 1; }
[[ "$(lipo -archs "$engine/Versions/Current/Chromium Framework")" == x86_64 ]] || { echo "engine must be Intel-only" >&2; exit 1; }
ubo="${UBO_SOURCE_DIR:-$repo/packages/ardiacore/vendor/ubo/ext}"
[[ -f "$ubo/manifest.json" ]] || { echo "missing bundled uBlock source at $ubo" >&2; exit 1; }
mkdir -p "$out"
out=$(cd "$out" && pwd)
mkdir "$out/staging"
cp -cR "$app" "$out/staging/Ardia.app"
staged="$out/staging/Ardia.app"
codesign -d --entitlements :- "$staged" >"$out/AdHoc.entitlements"
python3 - "$staged/Contents/Info.plist" "$out/AdHoc.entitlements" <<'PY'
import pathlib, plistlib, sys
info = pathlib.Path(sys.argv[1])
data = plistlib.loads(info.read_bytes())
for key in ("SUFeedURL", "SUPublicEDKey"):
    data.pop(key, None)
data["SUEnableAutomaticChecks"] = False
data["SUAutomaticallyUpdate"] = False
info.write_bytes(plistlib.dumps(data))
entitlements = pathlib.Path(sys.argv[2])
data = plistlib.loads(entitlements.read_bytes())
data.pop("keychain-access-groups", None)
entitlements.write_bytes(plistlib.dumps(data))
PY
codesign --force --sign - --options 0 --timestamp=none --entitlements "$out/AdHoc.entitlements" "$staged"
codesign --verify --deep --strict "$staged"
ditto -c -k --keepParent "$staged" "$out/Ardia-Intel.zip"
tar --no-mac-metadata -czf "$out/ArdiaCore-x86_64.tar.gz" -C "$(dirname "$engine")" "$(basename "$engine")"
git -C "$repo" archive --format=tar.gz --prefix=ardia-app-source/ -o "$out/Ardia-App-Source.tar.gz" "$app_commit"
git -C "$repo" archive --format=tar.gz --prefix=ardia-release-source/ -o "$out/Ardia-Release-Source.tar.gz" "$release_commit"
tar --no-mac-metadata -czf "$out/uBlock-Origin-Source.tar.gz" -C "$ubo" .
pins="$out/helium-pins.ini"
git -C "$repo" show "$engine_commit:engine/patches/build/helium-pins.ini" >"$pins"
python3 - "$pins" "$out" <<'PY'
import configparser, os, pathlib, subprocess, sys
pins = configparser.ConfigParser()
pins.read(sys.argv[1])
out = pathlib.Path(sys.argv[2])
for section, env in [("helium-chromium", "HELIUM_DIR"), ("helium-macos", "HELIUM_MACOS_DIR")]:
    commit = pins[section]["commit"]
    archive = out / f"{section}-Source.tar.gz"
    local = os.environ.get(env)
    if local:
        actual = subprocess.check_output(["git", "-C", local, "rev-parse", "HEAD"], text=True).strip()
        if actual != commit:
            raise SystemExit(f"{section}: expected {commit}, found {actual}")
        subprocess.run(["git", "-C", local, "archive", "--format=tar.gz", f"--prefix={section}/", "-o", str(archive), commit], check=True)
    else:
        subprocess.run(["curl", "-fL", "--retry", "3", "--max-time", "600", f"https://codeload.github.com/imputnet/{section}/tar.gz/{commit}", "-o", str(archive)], check=True)
PY
cp "$repo/docs/intel-release.md" "$out/RELEASE-NOTES.md"
[[ -z "${ARDIACORE_GN_ARGS:-}" ]] || cp "$ARDIACORE_GN_ARGS" "$out/engine-args.gn"
python3 - "$out" "$app_commit" "$engine_commit" "$release_commit" "$repo" <<'PY'
import configparser, datetime, json, pathlib, plistlib, subprocess, sys
out = pathlib.Path(sys.argv[1])
info = plistlib.loads((out / "staging/Ardia.app/Contents/Info.plist").read_bytes())
pins = configparser.ConfigParser()
pins.read(out / "helium-pins.ini")
engine_tree = subprocess.check_output(["git", "-C", sys.argv[5], "rev-parse", f"{sys.argv[3]}:engine"], text=True).strip()
data = {
    "preparedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "architecture": "x86_64", "appVersion": info["CFBundleShortVersionString"],
    "buildNumber": info["CFBundleVersion"], "appSourceCommit": sys.argv[2],
    "engineSourceCommit": sys.argv[3], "releaseSourceCommit": sys.argv[4], "engineTree": engine_tree,
    "chromiumVersion": pins["chromium"]["version"],
    "chromiumSource": f'https://chromium.googlesource.com/chromium/src/+/refs/tags/{pins["chromium"]["version"]}',
    "signing": "ad-hoc", "notarized": False, "hardenedRuntime": False,
    "sharedKeychainGroups": False, "upstreamAutomaticUpdates": False,
}
(out / "PROVENANCE.json").write_text(json.dumps(data, indent=2) + "\n")
PY
python3 - "$out" <<'PY'
import hashlib, pathlib, sys
out = pathlib.Path(sys.argv[1])
lines = []
for path in sorted(out.iterdir()):
    if not path.is_file() or path.name == "SHA256SUMS":
        continue
    digest = hashlib.file_digest(path.open("rb"), "sha256").hexdigest()
    lines.append(f"{digest}  {path.name}\n")
(out / "SHA256SUMS").write_text("".join(lines))
PY
echo "Prepared assets in $out; nothing published."
du -sh "$out"/*.zip "$out"/*.tar.gz
