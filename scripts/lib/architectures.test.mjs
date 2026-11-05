import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (path) => readFileSync(join(root, path), "utf8");

function fixture(t, arch) {
  const dir = mkdtempSync(join(tmpdir(), "ardia-architectures-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const bin = join(dir, "bin");
  mkdirSync(bin);
  const executable = (name, body) => writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  executable("uname", `echo ${arch}`);
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, CHROMIUM_SRC: join(dir, "chromium"), ARDIACORE_FRAMEWORK: "", TARGET_CPU: "", GN_OUT_CONFIGS: "" };
  return { dir, env, executable };
}

for (const [arch, out] of [["arm64", "arm64"], ["x86_64", "x64"]]) {
  test(`local Release build selects ${arch} only`, (t) => {
    const { env, executable } = fixture(t, arch);
    executable("xcodebuild", 'printf "%s\\n" "$@"');
    const command = JSON.parse(read("apps/browser/package.json")).scripts.build;
    const result = spawnSync("/bin/sh", ["-c", command], { env, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.split("\n").includes(`platform=macOS,arch=${arch}`));
    assert.ok(result.stdout.split("\n").includes("ONLY_ACTIVE_ARCH=YES"));
  });

  test(`local engine path selects ${out} for ${arch} and honors an override`, (t) => {
    const { dir, env } = fixture(t, arch);
    const command = '. "$1"; printf "%s" "$chromium_framework"';
    const run = (extra = {}) => spawnSync("/bin/bash", ["-c", command, "_", join(root, "scripts/lib/paths.sh")], {
      env: { ...env, ...extra }, encoding: "utf8",
    });
    const result = run();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, join(dir, "chromium", `out/Release_GN_${out}`, "Chromium Framework.framework"));
    const overridden = run({ ARDIACORE_FRAMEWORK: join(dir, "custom framework") });
    assert.equal(overridden.status, 0, overridden.stderr);
    assert.equal(overridden.stdout, join(dir, "custom framework"));
  });
}

test("both Xcode configurations use standard architectures", () => {
  const project = read("apps/browser/macos/Ardia.xcodeproj/project.pbxproj");
  assert.equal(project.match(/ARCHS = "\$\(ARCHS_STANDARD\)";/g)?.length, 2);
  assert.doesNotMatch(project, /ARCHS = arm64;/);
  assert.doesNotMatch(read("scripts/agent/build-app"), /platform=macOS,arch=arm64/);
  assert.doesNotMatch(JSON.parse(read("apps/browser/package.json")).scripts.macos, /platform=macOS,arch=arm64/);
});

test("Intel engine fetch fails before attempting an arm64 download", (t) => {
  const { env, executable } = fixture(t, "x86_64");
  executable("curl", 'echo unexpected-download >&2; exit 99');
  const result = spawnSync("/bin/bash", [join(root, "packages/ardiacore/scripts/fetch-engine.sh")], { env, encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Intel builds need a matching x86_64/);
  assert.doesNotMatch(result.stderr, /unexpected-download/);
});

test("staging rejects an incompatible engine before copying it", (t) => {
  const { dir, env, executable } = fixture(t, "x86_64");
  const framework = join(dir, "Chromium Framework.framework");
  mkdirSync(framework);
  executable("lipo", "exit 1");
  const result = spawnSync("/bin/bash", [join(root, "packages/ardiacore/scripts/stage-framework.sh")], {
    env: { ...env, ARCHS: "x86_64", ARDIACORE_FRAMEWORK: framework }, encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /does not contain x86_64/);
});

for (const cpu of ["arm64", "x64"]) {
  test(`engine configuration consistently selects ${cpu}`, (t) => {
    const { env } = fixture(t, "arm64");
    const result = spawnSync("/bin/bash", ["-c", '. "$1"; . "$2"; . "$3"; printf "%s\\n" "$GN_OUT_CONFIGS" "$chromium_out" "$GN_DEFINES"', "_",
      join(root, "engine/patches/build/env.sh"), join(root, "engine/patches/build/gn_defines.sh"), join(root, "scripts/lib/paths.sh")], {
      env: { ...env, TARGET_CPU: cpu }, encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.split("\n").includes(`Release_GN_${cpu}`));
    assert.ok(result.stdout.split("\n").includes(`out/Release_GN_${cpu}`));
    assert.ok(result.stdout.includes(`target_cpu="${cpu}"`));
    assert.ok(result.stdout.includes("chrome_pgo_phase=2"));
  });
}

test("engine configuration rejects an unsupported CPU", (t) => {
  const { env } = fixture(t, "arm64");
  const result = spawnSync("/bin/bash", ["-c", '. "$1"', "_", join(root, "engine/patches/build/env.sh")], {
    env: { ...env, TARGET_CPU: "invalid" }, encoding: "utf8",
  });
  assert.equal(result.status, 64);
});

test("engine compilation uses the configured output and fails fast", () => {
  const build = read("engine/patches/build/05-build.sh");
  assert.ok(build.includes('-C "out/$GN_OUT_CONFIGS"'));
  assert.ok(build.includes('${KEEP_GOING:-1}'));
  assert.ok(read("engine/patches/build/01-sync.sh").includes("target_cpu = ['$TARGET_CPU']"));
});

test("app build helper cross-compiles only x86_64 on an arm64 host", (t) => {
  const { dir, env, executable } = fixture(t, "arm64");
  const agent = join(dir, "scripts/agent");
  mkdirSync(agent, { recursive: true });
  mkdirSync(join(dir, "scripts/lib"), { recursive: true });
  mkdirSync(join(dir, "apps/browser"), { recursive: true });
  writeFileSync(join(agent, "build-app"), read("scripts/agent/build-app"), { mode: 0o755 });
  writeFileSync(join(dir, "scripts/lib/paths.sh"), read("scripts/lib/paths.sh"));
  writeFileSync(join(agent, "locked"), '#!/bin/bash\nwhile [[ "$1" != -- ]]; do shift; done\nshift\nexec "$@"\n', { mode: 0o755 });
  executable("git", "exit 0");
  executable("xcodebuild", 'printf "%s\\n" "$@" > "$XCODE_ARGS_FILE"; echo "** BUILD SUCCEEDED **"');
  const argsFile = join(dir, "xcode-args");
  const result = spawnSync("/bin/bash", [join(agent, "build-app"), "--as", "cross-test", "--config", "Release"], {
    env: { ...env, TARGET_CPU: "x64", XCODE_ARGS_FILE: argsFile }, encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const args = readFileSync(argsFile, "utf8").split("\n");
  assert.ok(args.includes("generic/platform=macOS"));
  assert.ok(args.includes("ARCHS=x86_64"));
  assert.ok(args.includes("ONLY_ACTIVE_ARCH=YES"));
});
