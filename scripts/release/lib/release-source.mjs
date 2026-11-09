import { readFile } from "node:fs/promises";
import { buildTag, parseTag, zipName } from "./skills.mjs";

// A fork can pin verified upstream downloads without importing release tags.
// Validation stays offline; updating this snapshot requires checking upstream assets.
export function validateReleaseSource(source, skillNames, requestedRepo) {
  const repo = source?.repository;
  if (typeof repo !== "string" || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
    throw new Error("Release source must declare an owner/repository");
  }
  if (requestedRepo && requestedRepo !== repo) {
    throw new Error(`Release source is ${repo}, not ${requestedRepo}`);
  }
  if (!source.releases || typeof source.releases !== "object" || Array.isArray(source.releases)) {
    throw new Error("Release source must declare releases");
  }
  const keys = Object.keys(source.releases).sort();
  if (JSON.stringify(keys) !== JSON.stringify([...skillNames].sort())) {
    throw new Error("Release source must cover exactly the current skills");
  }
  const versions = {};
  for (const name of skillNames) {
    const release = source.releases[name];
    const version = release?.version;
    const tag = buildTag(name, version);
    if (typeof version !== "string" || parseTag(tag)?.version !== version) {
      throw new Error(`Invalid release version for ${name}`);
    }
    const base = `https://github.com/${repo}/releases`;
    if (release.release_url !== `${base}/tag/${tag}` ||
        release.asset_url !== `${base}/download/${tag}/${zipName(name, version)}`) {
      throw new Error(`Release URLs do not match the source and version for ${name}`);
    }
    versions[name] = version;
  }
  return { repo, versions };
}

export async function loadReleaseSource(file, names, requestedRepo) {
  return validateReleaseSource(JSON.parse(await readFile(file, "utf8")), names, requestedRepo);
}
