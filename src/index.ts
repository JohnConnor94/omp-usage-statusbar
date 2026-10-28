import { resolveUsedFraction, type UsageReport } from "@oh-my-pi/pi-ai";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { lookup } from "@oh-my-pi/pi-coding-agent/config/registry";
import { findScopedSettings, type Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { collapseSharedUsageReports } from "@oh-my-pi/pi-tui/overlays/usage-display";
import { sanitizeText } from "@oh-my-pi/pi-utils";
import {
	type ConfigScope,
	clearConfigFile,
	type EffectiveConfig,
	globalConfigPath,
	mergeConfig,
	projectConfigPath,
	readConfigFile,
	type UsageStatusbarConfig,
	updateConfigFile,
} from "./config";
import { formatUsageReports, listUsageSubscriptions, type UsageLabelMode, type UsageResetMode } from "./usage-summary";

const STATUS_KEY = "usage-statusbar";
const REFRESH_MS = 60_000;
const SANDBOX_URL = "https://daily-cloudcode-pa.sandbox.googleapis.com";
const PRODUCTION_URL = "https://daily-cloudcode-pa.googleapis.com";

/** Status key of the `index`th usage row; zero-padded so rows keep their order in the footer. */
function statusRowKey(index: number): string {
	return `usage-statusbar:${String(index).padStart(6, "0")}`;
}

/**
 * Footer usage extension (TUI main agent only).
 * - `session_start`: load global + project config; if enabled, show "Usage: loading", fetch reports,
 *   start the 60 s refresh timer.
 * - `turn_end`: refresh again after each turn (when enabled).
 * - `session_shutdown`: abort any in-flight fetch, stop the timer, clear every footer row.
 * - `/usage-statusbar` (TUI only): edit the global or project config (on/off, label mode, reset times,
 *   hidden subscriptions) and apply it live.
 */
export default function (pi: ExtensionAPI) {
	let timer: Timer | undefined;
	let inflight: AbortController | undefined;
	let stopped = true;
	let statusCount = 0;
	let hasRows = false;
	let lastReports: UsageReport[] | undefined;
	let config: EffectiveConfig = mergeConfig({}, {});
	let activeSettings: Settings | undefined;

	/** Set the footer: a string fills the single `STATUS_KEY` line, an array fills one keyed row each, `undefined` clears all. */
	function setStatuses(ctx: ExtensionContext, value: string | readonly string[] | undefined): void {
		const rows = typeof value === "string" || value === undefined ? [] : value;
		ctx.ui.setStatus(STATUS_KEY, typeof value === "string" ? value : undefined);
		for (let index = 0; index < Math.max(statusCount, rows.length); index++) {
			ctx.ui.setStatus(statusRowKey(index), rows[index]);
		}
		statusCount = rows.length;
		hasRows = rows.length > 0;
	}

	/** Read the antigravity endpoint mode from the given settings; "auto" when unavailable. */
	// Timer callbacks run outside active settings scope; keep each refresh bound to its session settings.
	function antigravityMode(settings: Settings | undefined): unknown {
		if (!settings) return "auto";
		try {
			return lookup("providers.antigravityEndpoint")?.get(settings) ?? "auto";
		} catch {
			return "auto";
		}
	}

	/** Reload global + project config files into `config`; warn once per invalid file. */
	async function loadConfig(ctx: ExtensionContext): Promise<void> {
		const [global, project] = await Promise.all([
			readConfigFile(globalConfigPath()),
			readConfigFile(projectConfigPath(ctx.cwd)),
		]);
		config = mergeConfig(global.config, project.config);
		for (const { error } of [global, project]) if (error) ctx.ui.notify(error, "warning");
	}

	/** Redraw the footer from `lastReports` and `config`; no-op before the first successful fetch. */
	function render(ctx: ExtensionContext): void {
		if (!lastReports) return;
		if (listUsageSubscriptions(lastReports, resolveUsedFraction, sanitizeText).length === 0) {
			setStatuses(ctx, "Usage: no quota data");
			return;
		}
		// Every subscription hidden gives [] and clears all rows.
		const display = { label: config.label, hidden: new Set(config.hidden), resets: config.resets };
		setStatuses(ctx, formatUsageReports(lastReports, resolveUsedFraction, sanitizeText, display));
	}

	/** Fetch usage reports and update the footer; no-op while a fetch is in flight. */
	async function refresh(ctx: ExtensionContext, settings: Settings | undefined): Promise<void> {
		if (inflight) return;
		const controller = new AbortController();
		inflight = controller;
		try {
			const usage = ctx.modelRegistry.authStorage.usage;
			const reports = await usage.reports?.({
				baseUrlResolver: provider => {
					if (provider === "google-antigravity") {
						const mode = antigravityMode(settings);
						if (mode === "sandbox") return SANDBOX_URL;
						if (mode === "production") return PRODUCTION_URL;
					}
					return ctx.modelRegistry.getProviderBaseUrl?.(provider);
				},
				signal: controller.signal,
			});
			if (stopped || controller.signal.aborted) return;
			lastReports = collapseSharedUsageReports(reports ?? []);
			render(ctx);
		} catch {
			// Keep the last good rows through a transient failure.
			if (!stopped && !controller.signal.aborted && !hasRows) setStatuses(ctx, "Usage: unavailable");
		} finally {
			if (inflight === controller) inflight = undefined;
		}
	}

	/** Begin (or restart) the footer: show "Usage: loading", fetch now, then every `REFRESH_MS`. */
	function start(ctx: ExtensionContext, settings: Settings | undefined): void {
		if (timer) ctx.clearTimer(timer);
		stopped = false;
		setStatuses(ctx, "Usage: loading");
		void refresh(ctx, settings);
		timer = ctx.setInterval(() => void refresh(ctx, settings), REFRESH_MS);
	}

	/** Abort any in-flight fetch, stop the timer, clear every footer row and forget the last reports. */
	function stop(ctx: ExtensionContext): void {
		stopped = true;
		inflight?.abort();
		inflight = undefined;
		if (timer) ctx.clearTimer(timer);
		timer = undefined;
		setStatuses(ctx, undefined);
		lastReports = undefined;
	}

	pi.on("session_start", async (_event, ctx) => {
		if (ctx.mode !== "tui" || ctx.agent.kind !== "main") return;
		activeSettings = findScopedSettings(); // read before any await: scope is lost after it
		await loadConfig(ctx);
		if (config.enabled) start(ctx, activeSettings);
		else setStatuses(ctx, undefined);
	});

	pi.on("turn_end", (_event, ctx) => {
		if (stopped || !config.enabled || ctx.mode !== "tui" || ctx.agent.kind !== "main") return;
		void refresh(ctx, findScopedSettings());
	});

	pi.on("session_shutdown", (_event, ctx) => stop(ctx));

	/** Reload config after a change, then start, stop or redraw the footer to match; no new fetch unless starting. */
	async function reload(ctx: ExtensionContext): Promise<void> {
		await loadConfig(ctx);
		if (config.enabled && stopped) start(ctx, activeSettings ?? findScopedSettings());
		else if (!config.enabled && !stopped) stop(ctx);
		else render(ctx);
	}

	/** Merge `patch` into the scope's file, then apply it live. */
	async function applyPatch(ctx: ExtensionContext, scope: ConfigScope, patch: UsageStatusbarConfig): Promise<void> {
		await updateConfigFile(scope === "global" ? globalConfigPath() : projectConfigPath(ctx.cwd), patch);
		await reload(ctx);
	}

	/** Account label choices for the `Account label` submenu. */
	const LABEL_CHOICES = new Map<string, UsageLabelMode>([
		["Full — anthropic/user@example.com (Org)", "full"],
		["Provider only — anthropic", "provider"],
		["None — windows only", "none"],
	]);

	/** Reset time choices for the `Reset times` submenu. */
	const RESET_CHOICES = new Map<string, UsageResetMode>([
		["Countdown — Claude 5 Hour 69% 2h30m", "countdown"],
		["Countdown with verb — Claude 5 Hour 69% (resets in 2h30m)", "verbose"],
		["Clock — Claude 5 Hour 69% (resets 18:00)", "clock"],
		["Off — percentages only", "off"],
	]);

	/** The scope's own file content plus the effective values seen from that scope (global: defaults + global). */
	async function readScope(ctx: ExtensionContext, scope: ConfigScope) {
		const [global, project] = await Promise.all([
			readConfigFile(globalConfigPath()),
			readConfigFile(projectConfigPath(ctx.cwd)),
		]);
		return {
			own: scope === "global" ? global.config : project.config,
			view: mergeConfig(global.config, scope === "global" ? {} : project.config),
		};
	}

	/** Show `items` plus `Done` and run the chosen action. Returns false on `Done` or Esc. */
	async function pick(ctx: ExtensionContext, title: string, items: Map<string, () => Promise<void>>): Promise<boolean> {
		const picked = await ctx.ui.select(title, [...items.keys(), "Done"]);
		const action = picked === undefined ? undefined : items.get(picked);
		if (!action) return false;
		await action();
		return true;
	}

	/**
	 * Toggle which subscriptions are visible. Lists reported subscriptions plus hidden keys that no longer
	 * appear in the reports; every toggle writes the whole resulting `hidden` list to the scope file.
	 */
	async function subscriptionsMenu(ctx: ExtensionContext, scope: ConfigScope): Promise<void> {
		for (;;) {
			const { view } = await readScope(ctx, scope);
			const reported = listUsageSubscriptions(lastReports ?? [], resolveUsedFraction, sanitizeText).map(s => s.key);
			const keys = [...reported, ...view.hidden.filter(key => !reported.includes(key))];
			if (keys.length === 0) {
				ctx.ui.notify("No subscriptions loaded yet; wait for the first refresh", "info");
				return;
			}
			const items = new Map<string, () => Promise<void>>();
			for (const key of keys) {
				const hidden = view.hidden.includes(key);
				const note = reported.includes(key) ? "" : " (not reported)";
				items.set(`${hidden ? "[ ]" : "[x]"} ${key}${note}`, () =>
					applyPatch(ctx, scope, { hidden: hidden ? view.hidden.filter(k => k !== key) : [...view.hidden, key] }),
				);
			}
			if (!(await pick(ctx, "Subscriptions (select to toggle)", items))) return;
		}
	}

	/** Main menu of one scope; loops until Done or Esc. Each pass re-reads the files so labels stay current. */
	async function scopeMenu(ctx: ExtensionCommandContext, scope: ConfigScope): Promise<void> {
		for (;;) {
			const { own, view } = await readScope(ctx, scope);
			const inherited = (key: keyof UsageStatusbarConfig) =>
				scope === "project" && own[key] === undefined ? " (inherited)" : "";

			const items = new Map<string, () => Promise<void>>();
			items.set(`Enabled: ${view.enabled ? "on" : "off"}${inherited("enabled")}`, () =>
				applyPatch(ctx, scope, { enabled: !view.enabled }),
			);
			items.set(`Account label: ${view.label}${inherited("label")}`, async () => {
				const picked = await ctx.ui.select("Account label", [...LABEL_CHOICES.keys()]);
				const label = picked === undefined ? undefined : LABEL_CHOICES.get(picked);
				if (label) await applyPatch(ctx, scope, { label });
			});
			items.set(`Reset times: ${view.resets}${inherited("resets")}`, async () => {
				const picked = await ctx.ui.select("Reset times", [...RESET_CHOICES.keys()]);
				const resets = picked === undefined ? undefined : RESET_CHOICES.get(picked);
				if (resets) await applyPatch(ctx, scope, { resets });
			});
			items.set("Subscriptions…", () => subscriptionsMenu(ctx, scope));
			if (scope === "project") {
				items.set("Reset project overrides", async () => {
					await clearConfigFile(projectConfigPath(ctx.cwd));
					await reload(ctx);
				});
			}

			if (!(await pick(ctx, `Usage status bar — ${scope === "global" ? "Global" : "Project"}`, items))) return;
		}
	}

	pi.registerCommand("usage-statusbar", {
		description: "Configure the usage status bar (subscriptions, label, reset times, on/off)",
		handler: async (_args, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("usage-statusbar settings need the interactive TUI", "warning");
				return;
			}
			const scopes = new Map<string, ConfigScope>([
				["Global (default for all projects)", "global"],
				[`Project (overrides global in ${ctx.cwd})`, "project"],
			]);
			const picked = await ctx.ui.select("Usage status bar — scope", [...scopes.keys()]);
			const scope = picked === undefined ? undefined : scopes.get(picked);
			if (scope) await scopeMenu(ctx, scope);
		},
	});
}
