#!/usr/bin/env node
import { copyFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const target = resolve(
  root,
  "packages/site-adapters/src/adapters.extra.ts",
);
const example = resolve(
  root,
  "packages/site-adapters/src/adapters.extra.example.ts",
);

if (!existsSync(target) && existsSync(example)) {
  copyFileSync(example, target);
  console.log("Created packages/site-adapters/src/adapters.extra.ts from example");
}
