#!/usr/bin/env node
// Rewrites the <!-- DOWNLOAD:<skill>:start --> ... <!-- DOWNLOAD:<skill>:end -->
// blocks in README.md, README.zh-CN.md, and README.ja-JP.md so they always advertise the
// selected, verified upstream version of each skill in this reference fork.
//
// The default source is upstream-releases.json, independent of this fork's tags
// and GITHUB_REPOSITORY. Explicit --local-tags retains the upstream maintainer mode.
// In that mode the version source is the latest *git tag* for that skill
// (`<skill>-v<semver>`), NOT skills/<name>/manifest.json. The manifest is
// the "version under development"; the README must point at what users
// can actually download right now. Otherwise bumping a manifest before
// cutting a release would produce a 404 download link in the README.
//
// Idempotent: running it twice in a row produces no diff.
//
// Usage:
//   node scripts/release/update-readme.mjs           # rewrite localized READMEs
//   node scripts/release/update-readme.mjs --check   # exit 1 if anything would change
//   node scripts/release/update-readme.mjs --repo ConardLi/garden-skills

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  REPO_ROOT,
  loadAllManifests,
  buildTag,
  zipName,
  lastTagFor,
  parseTag,
} from "./lib/skills.mjs";
import { loadReleaseSource } from "./lib/release-source.mjs";

const DEFAULT_REPO = "ConardLi/garden-skills";

const FILES = [
  { path: path.join(REPO_ROOT, "README.md"), lang: "en" },
  { path: path.join(REPO_ROOT, "README.zh-CN.md"), lang: "zh" },
  { path: path.join(REPO_ROOT, "README.ja-JP.md"), lang: "ja" },
];

const COPY = {
  en: { label: "Download v%V .zip", unreleased: "_(no release yet — coming soon)_" },
  zh: { label: "下载 v%V .zip", unreleased: "_（暂未发布）_" },
  ja: { label: "Download v%V .zip", unreleased: "_（まだリリースされていません）_" },
};

// Per-skill block is intentionally a single inline link — appended to the
// existing "Links:" / "链接：" row of each skill section. All other install
// flavours (npx, marketplace, manual copy, submodule) live in the unified
// Install section below.
//
// The URL points at the selected upstream zip, or a version selected by the
// explicit local-tag mode. Only local-tag mode can produce an unreleased marker.
function buildBlock(skill, version, repo, lang) {
  if (!version) return COPY[lang].unreleased;
  const tag = buildTag(skill, version);
  const zip = zipName(skill, version);
  const url = `https://github.com/${repo}/releases/download/${tag}/${zip}`;
  const label = COPY[lang].label.replace("%V", version);
  return `[${label}](${url})`;
}

// Resolves the version a README should advertise for a given skill.
// Returns the semver string from the latest `<skill>-v<semver>` tag, or
// null if the skill has never been tagged.
function publishedVersionFor(skillName) {
  const tag = lastTagFor(skillName);
  if (!tag) return null;
  const parsed = parseTag(tag);
  return parsed?.version ?? null;
}

function rewrite(content, blocks) {
  let out = content;
  for (const [skill, body] of Object.entries(blocks)) {
    const re = new RegExp(
      `(<!--\\s*DOWNLOAD:${escapeRe(skill)}:start\\s*-->)([\\s\\S]*?)(<!--\\s*DOWNLOAD:${escapeRe(skill)}:end\\s*-->)`,
      "g",
    );
    if (!re.test(out)) {
      console.warn(`[readme] WARNING: no DOWNLOAD marker found for "${skill}"`);
      continue;
    }
    out = out.replace(
      new RegExp(
        `(<!--\\s*DOWNLOAD:${escapeRe(skill)}:start\\s*-->)([\\s\\S]*?)(<!--\\s*DOWNLOAD:${escapeRe(skill)}:end\\s*-->)`,
        "g",
      ),
      (_m, start, _mid, end) => `${start}${body}${end}`,
    );
  }
  return out;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseArgs(argv) {
  const args = { check: false, repo: undefined, localTags: false,
    source: path.join(REPO_ROOT, "scripts/release/upstream-releases.json") };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--check") args.check = true;
    else if (a === "--repo" || a === "--release-source") {
      const value = argv[++i];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${a}`);
      if (a === "--repo") args.repo = value;
      else args.source = value;
    }
    else if (a === "--local-tags") args.localTags = true;
    else if (a === "--help" || a === "-h") args.help = true;
    else throw new Error(`Unknown arg: ${a}`);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log("Usage: update-readme.mjs [--check] [--release-source file] [--repo owner/repo] [--local-tags]");
    return;
  }

  const manifests = await loadAllManifests();
  const source = args.localTags ? null : await loadReleaseSource(
    args.source, manifests.map((m) => m.name), args.repo,
  );
  args.repo = source?.repo ?? args.repo ?? process.env.GITHUB_REPOSITORY ?? DEFAULT_REPO;
  // Resolve the published version for each skill ONCE here, so we don't
  // shell out to git per-file.
  const published = manifests.map((m) => ({
    name: m.name,
    manifestVersion: m.manifest.version,
    publishedVersion: source ? source.versions[m.name] : publishedVersionFor(m.name),
  }));
  console.log(`[readme] repo=${args.repo}  source=${args.localTags ? "local-tags" : args.source}  skills=${manifests.length}`);
  for (const p of published) {
    const note =
      p.publishedVersion === null
        ? "no tag yet"
        : p.publishedVersion === p.manifestVersion
          ? `v${p.publishedVersion}`
          : `v${p.publishedVersion} (manifest=${p.manifestVersion}, awaiting release)`;
    console.log(`[readme]   ${p.name}: ${note}`);
  }

  let drift = false;
  for (const file of FILES) {
    const original = await readFile(file.path, "utf8");
    const blocks = Object.fromEntries(
      published.map((p) => [
        p.name,
        buildBlock(p.name, p.publishedVersion, args.repo, file.lang),
      ]),
    );
    const updated = rewrite(original, blocks);

    if (updated === original) {
      console.log(`[readme] ${path.relative(REPO_ROOT, file.path)}: up-to-date`);
      continue;
    }
    drift = true;
    if (args.check) {
      console.error(
        `[readme] ${path.relative(REPO_ROOT, file.path)}: OUT OF DATE (run \`node scripts/release/update-readme.mjs\`)`,
      );
    } else {
      await writeFile(file.path, updated, "utf8");
      console.log(`[readme] ${path.relative(REPO_ROOT, file.path)}: rewritten`);
    }
  }

  if (args.check && drift) process.exit(1);
}

main().catch((err) => {
  console.error(`[readme] ERROR: ${err.message}`);
  process.exit(1);
});
