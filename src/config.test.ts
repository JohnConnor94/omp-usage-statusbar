import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { mergeConfig, readConfigFile, updateConfigFile } from "./config";

let dir: string;

beforeEach(async () => {
	dir = await fs.mkdtemp(path.join(os.tmpdir(), "usage-statusbar-"));
});

afterEach(async () => {
	await fs.rm(dir, { recursive: true, force: true });
});

describe("mergeConfig", () => {
	test("project keys override global per key and hidden is replaced, not unioned", () => {
		expect(mergeConfig({ label: "none", hidden: ["a"] }, { hidden: [] })).toEqual({
			enabled: true,
			label: "none",
			hidden: [],
		});
	});
});

describe("readConfigFile", () => {
	test("returns an empty config for a missing file", async () => {
		expect(await readConfigFile(path.join(dir, "missing.json"))).toEqual({ config: {} });
	});

	test("reports invalid JSON and non-object roots", async () => {
		const file = path.join(dir, "bad.json");
		await Bun.write(file, "{nope");
		expect(await readConfigFile(file)).toEqual({ config: {}, error: `ignored invalid config ${file}` });
		await Bun.write(file, "[1]");
		expect((await readConfigFile(file)).error).toBeDefined();
	});

	test("drops fields with the wrong type and non-string hidden entries", async () => {
		const file = path.join(dir, "types.json");
		await Bun.write(file, JSON.stringify({ enabled: "yes", label: "huge", hidden: ["a", 1, null, "b"], extra: 1 }));
		expect(await readConfigFile(file)).toEqual({ config: { hidden: ["a", "b"] } });
	});
});

describe("updateConfigFile", () => {
	test("creates the parent directory and round-trips, keeping untouched keys", async () => {
		const file = path.join(dir, "nested", "usage-statusbar.json");
		await updateConfigFile(file, { label: "provider" });
		await updateConfigFile(file, { enabled: false });
		expect(await readConfigFile(file)).toEqual({ config: { label: "provider", enabled: false } });
	});
});
