import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { REPO_ROOT } from "./lib/skills.mjs";
import { validateReleaseSource } from "./lib/release-source.mjs";

const source = () => ({
  repository: "upstream/skills",
  releases: {
    "example-skill": {
      version: "1.2.3",
      release_url: "https://github.com/upstream/skills/releases/tag/example-skill-v1.2.3",
      asset_url: "https://github.com/upstream/skills/releases/download/example-skill-v1.2.3/example-skill-1.2.3.zip",
    },
  },
});

test("a verified upstream source does not need fork tags", () => {
  assert.deepEqual(validateReleaseSource(source(), ["example-skill"]), {
    repo: "upstream/skills", versions: { "example-skill": "1.2.3" },
  });
});
test("a fork repository override cannot relabel upstream assets", () => {
  assert.throws(() => validateReleaseSource(source(), ["example-skill"], "fork/skills"), /Release source is/);
});
test("missing and unknown skills fail instead of claiming no release", () => {
  assert.throws(() => validateReleaseSource(source(), ["another-skill"]), /exactly/);
  assert.throws(() => validateReleaseSource(source(), []), /exactly/);
});
test("invalid versions and foreign download URLs fail", () => {
  const invalid = source(); invalid.releases["example-skill"].version = "../other";
  assert.throws(() => validateReleaseSource(invalid, ["example-skill"]), /Invalid release/);
  const foreign = source(); foreign.releases["example-skill"].asset_url = "https://example.com/package.zip";
  assert.throws(() => validateReleaseSource(foreign, ["example-skill"]), /URLs/);
});
test("fork CI environment keeps all localized upstream links", () => {
  const output = execFileSync(process.execPath, ["scripts/release/update-readme.mjs", "--check"], {
    cwd: REPO_ROOT, encoding: "utf8", env: { ...process.env, GITHUB_REPOSITORY: "fork/skills" },
  });
  assert.match(output, /repo=ConardLi\/garden-skills/);
  assert.equal((output.match(/up-to-date/g) || []).length, 3);
});
