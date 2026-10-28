import * as fs from "node:fs/promises";
import * as path from "node:path";
import { getAgentDir, getConfigDirName } from "@oh-my-pi/pi-utils";
import type { UsageBarMode, UsageLabelMode, UsageResetMode, UsageTextColorMode } from "./usage-summary";

/** Settings as stored in one config file; every key is optional and falls back to the next layer. */
export interface UsageStatusbarConfig {
	enabled?: boolean;
	label?: UsageLabelMode;
	resets?: UsageResetMode;
	/** Position of each remaining-quota bar. */
	bar?: UsageBarMode;
	/** Remaining % at or below which the bar turns yellow. */
	barWarn?: number;
	/** Remaining % at or below which the bar turns red. */
	barCritical?: number;
	/** How row text is coloured by quota level. */
	textColor?: UsageTextColorMode;
	/** Subscription keys (`UsageSubscription.key`) to hide. */
	hidden?: string[];
}
/** Fully resolved settings after merging defaults, global and project files. */
export interface EffectiveConfig {
	enabled: boolean;
	label: UsageLabelMode;
	resets: UsageResetMode;
	bar: UsageBarMode;
	barWarn: number;
	barCritical: number;
	textColor: UsageTextColorMode;
	hidden: string[];
}


/** Which config file a setting is read from or written to. */
export type ConfigScope = "global" | "project";

const LABELS: readonly string[] = ["full", "provider", "none"];
const RESETS: readonly string[] = ["countdown", "verbose", "clock", "off"];
const BARS: readonly string[] = ["beside", "below", "overlay", "off"];
const TEXT_COLORS: readonly string[] = ["off", "percent", "window", "split", "row", "parts"];
const isPercent = (value: unknown): value is number =>
	typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;

/** Path of the global config file, `~/.omp/agent/usage-statusbar.json`. */
export function globalConfigPath(): string {
	return path.join(getAgentDir(), "usage-statusbar.json");
}

/** Path of the per-project config file, `<cwd>/.omp/usage-statusbar.json`; it overrides the global file. */
export function projectConfigPath(cwd: string): string {
	return path.join(cwd, getConfigDirName(), "usage-statusbar.json");
}

/**
 * Read one config file, keeping only valid enabled, label, reset, bar, threshold, text color and hidden fields.
 * A missing file gives `{ config: {} }`; unparseable JSON or a non-object root gives `{ config: {}, error }`.
 */
export async function readConfigFile(file: string): Promise<{ config: UsageStatusbarConfig; error?: string }> {
	const invalid = { config: {}, error: `ignored invalid config ${file}` };
	let raw: string;
	try {
		raw = await fs.readFile(file, "utf8");
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "ENOENT" ? { config: {} } : invalid;
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return invalid;
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return invalid;
	const { enabled, label, resets, bar, barWarn, barCritical, textColor, hidden } = parsed as Record<string, unknown>;
	const config: UsageStatusbarConfig = {};
	if (typeof enabled === "boolean") config.enabled = enabled;
	if (typeof label === "string" && LABELS.includes(label)) config.label = label as UsageLabelMode;
	if (typeof resets === "string" && RESETS.includes(resets)) config.resets = resets as UsageResetMode;
	if (typeof bar === "string" && BARS.includes(bar)) config.bar = bar as UsageBarMode;
	if (isPercent(barWarn)) config.barWarn = barWarn;
	if (isPercent(barCritical)) config.barCritical = barCritical;
	if (typeof textColor === "string" && TEXT_COLORS.includes(textColor)) config.textColor = textColor as UsageTextColorMode;
	if (Array.isArray(hidden)) config.hidden = hidden.filter((key): key is string => typeof key === "string");
	return { config };
}

/**
 * Merge per key: defaults (`enabled`, `full`, `countdown`, `beside`, thresholds 25/10, text color `off`, no hidden), then `global`, then `project`.
 * A project `hidden` list replaces the global one; the lists are never unioned.
 */
export function mergeConfig(global: UsageStatusbarConfig, project: UsageStatusbarConfig): EffectiveConfig {
	return { enabled: true, label: "full", resets: "countdown", bar: "beside", barWarn: 25, barCritical: 10, textColor: "off", hidden: [], ...global, ...project };
}

/**
 * Apply `patch` on top of the file's current content and write it back, creating missing directories.
 * An unreadable or invalid existing file is replaced.
 */
export async function updateConfigFile(file: string, patch: UsageStatusbarConfig): Promise<void> {
	const { config, error } = await readConfigFile(file);
	const next = Object.assign(error ? {} : config, patch);
	await fs.mkdir(path.dirname(file), { recursive: true });
	await Bun.write(file, `${JSON.stringify(next, null, 2)}\n`);
}

/** Delete a config file; no error when it does not exist. Used to reset project overrides. */
export async function clearConfigFile(file: string): Promise<void> {
	await fs.rm(file, { force: true });
}
