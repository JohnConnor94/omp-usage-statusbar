import { resolveUsedFraction, type UsageReport } from "@oh-my-pi/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { lookup } from "@oh-my-pi/pi-coding-agent/config/registry";
import { findScopedSettings, type Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { collapseSharedUsageReports } from "@oh-my-pi/pi-tui/overlays/usage-display";
import { sanitizeText } from "@oh-my-pi/pi-utils";
import {
	type EffectiveConfig,
	globalConfigPath,
	mergeConfig,
	projectConfigPath,
	readConfigFile,
} from "./config";
import { formatUsageReports, listUsageSubscriptions } from "./usage-summary";

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
 */
export default function (pi: ExtensionAPI) {
	let timer: Timer | undefined;
	let inflight: AbortController | undefined;
	let stopped = true;
	let statusCount = 0;
	let hasRows = false;
	let lastReports: UsageReport[] | undefined;
	let config: EffectiveConfig = mergeConfig({}, {});

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
		const display = { label: config.label, hidden: new Set(config.hidden) };
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
		const settings = findScopedSettings(); // read before any await: scope is lost after it
		await loadConfig(ctx);
		if (config.enabled) start(ctx, settings);
		else setStatuses(ctx, undefined);
	});

	pi.on("turn_end", (_event, ctx) => {
		if (stopped || !config.enabled || ctx.mode !== "tui" || ctx.agent.kind !== "main") return;
		void refresh(ctx, findScopedSettings());
	});

	pi.on("session_shutdown", (_event, ctx) => stop(ctx));
}
