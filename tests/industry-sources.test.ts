// The demo sources are seeded verbatim on first boot (scripts/seed.ts), where a config key its kind does
// not implement aborts the seed: a half-finished conversion (selectors left on an external source, a typo
// in a key, a value the kind does not accept) fails on the deploy instead of here. Hold the pack to what
// the backend would take, and keep a company's jobs attached to a company the taxonomy knows.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { ENTITIES } from "@aihot/industry/taxonomy";
import { unsupportedConfig } from "@aihot/backend/sources/config-keys";
import type { SourceRow } from "@aihot/backend/sources/types";

const ROOT = path.resolve(import.meta.dirname, "..");
const KINDS: readonly string[] = ["rss", "web_list", "json_list", "x_search", "mp_account", "external"];

interface PackSource {
  id: string;
  name: string;
  kind: string;
  config: Record<string, unknown>;
  owner_entity_id?: string | null;
}

const { sources } = JSON.parse(readFileSync(path.join(ROOT, "industry/sources.json"), "utf8")) as { sources: PackSource[] };

test("every demo source is a kind the backend collects, with a config that kind accepts", () => {
  for (const source of sources) {
    assert.ok(KINDS.includes(source.kind), `${source.id}: kind ${source.kind}`);
    assert.deepEqual(unsupportedConfig(source.kind as SourceRow["kind"], source.config), [], `${source.id} (${source.kind})`);
  }
});

test("demo source ids are unique and every one names a company the taxonomy knows", () => {
  assert.equal(new Set(sources.map((s) => s.id)).size, sources.length, "id 重复");
  for (const source of sources) {
    const owner = source.owner_entity_id;
    assert.ok(typeof owner === "string" && ENTITIES[owner], `${source.id}: owner_entity_id ${owner ?? "(空)"}`);
  }
});
