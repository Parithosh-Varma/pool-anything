import test from "node:test";
import assert from "node:assert/strict";
import { parse } from "../../src/cli/nl.js";
import { helpBox } from "../../src/cli/ui.js";
import { compareVersions, readCurrentVersion, getVersionInfo } from "../../src/version.js";

test("parse: update variants", () => {
  assert.equal(parse("update").kind, "update");
  assert.equal(parse("/update").kind, "update");
  assert.equal(parse("upgrade").kind, "update");
  assert.equal(parse("Update to latest").kind, "update");
  assert.equal(parse("check for updates").kind, "update");
});

test("parse: uninstall variants (CLI only)", () => {
  assert.equal(parse("uninstall").kind, "uninstall");
  assert.equal(parse("/uninstall").kind, "uninstall");
  assert.equal(parse("uninstall pool-anything").kind, "uninstall");
  assert.equal(parse("remove self").kind, "uninstall");
  // Must not steal pool deletion.
  assert.equal(parse("delete pool foo").kind, "delete-pool");
});

test("version: semver compare", () => {
  assert.equal(compareVersions("0.1.0", "0.1.0"), 0);
  assert.ok(compareVersions("0.1.1", "0.1.0") > 0);
  assert.ok(compareVersions("0.1.0", "0.1.1") < 0);
  assert.ok(compareVersions("0.2.0", "0.1.9") > 0);
  assert.equal(compareVersions("v0.1.0", "0.1.0"), 0);
});

test("version: help lists update + uninstall", () => {
  assert.ok(helpBox().includes("update"));
  assert.ok(helpBox().includes("uninstall"));
});

test("version: getVersionInfo shape", async () => {
  const v = await getVersionInfo();
  assert.equal(v.current, readCurrentVersion());
  assert.ok(v.latest === null || typeof v.latest === "string");
  assert.equal(typeof v.updateAvailable, "boolean");
});
