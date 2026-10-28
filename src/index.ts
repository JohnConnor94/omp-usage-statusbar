import { resolveUsedFraction } from "@oh-my-pi/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { lookup } from "@oh-my-pi/pi-coding-agent/config/registry";
import { findScopedSettings, type Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { collapseSharedUsageReports } from "@oh-my-pi/pi-tui/overlays/usage-display";
import { sanitizeText } from "@oh-my-pi/pi-utils";
import { formatUsageReports } from "./usage-summary";

const STATUS_KEY = "usage-statusbar";
const REFRESH_MS = 60_000;
const SANDBOX_URL = "https://daily-cloudcode-pa.sandbox.googleapis.com";
const PRODUCTION_URL = "https://daily-cloudcode-pa.googleapis.com";

function statusRowKey(index: number): string {
	return `usage-statusbar:${String(index).padStart(6, "0")}`;
}

export default function (pi: ExtensionAPI) {
	let timer: Timer | undefined;
	let inflight: AbortController | undefined;
	let stopped = true;
	let statusCount = 0;

	function setStatuses(ctx: ExtensionContext, value: string | readonly string[] | undefined): void {
		const rows = typeof value === "string" || value === undefined ? [] : value;
		ctx.ui.setStatus(STATUS_KEY, typeof value === "string" ? value : undefined);
		for (let index = 0; index < Math.max(statusCount, rows.length); index++) {
			ctx.ui.setStatus(statusRowKey(index), rows[index]);
		}
		statusCount = rows.length;
	}

	// Timer callbacks run outside active settings scope; keep each refresh bound to its session settings.
	function antigravityMode(settings: Settings | undefined): unknown {
		if (!settings) return "auto";
		try {
			return lookup("providers.antigravityEndpoint")?.get(settings) ?? "auto";
		} catch {
			return "auto";
		}
	}

	async function refresh(ctx: ExtensionContext, settings: Settings | undefined): Promise<void> {
		if (inflight) return;
		const controller = new AbortController();
		inflight = controller;
		try {
			const usage = ctx.modelRegistry.authStorage.usage;
			const reports = await usage.reports({
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
			const rows = formatUsageReports(
				collapseSharedUsageReports(reports ?? []),
				resolveUsedFraction,
				sanitizeText,
			);
			setStatuses(ctx, rows.length ? rows : "Usage: no quota data");
		} catch {
			if (!stopped && !controller.signal.aborted) setStatuses(ctx, "Usage: unavailable");
		} finally {
			if (inflight === controller) inflight = undefined;
		}
	}

	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui" || ctx.agent.kind !== "main") return;
		const settings = findScopedSettings();
		if (timer) ctx.clearTimer(timer);
		stopped = false;
		setStatuses(ctx, "Usage: loading");
		void refresh(ctx, settings);
		timer = ctx.setInterval(() => void refresh(ctx, settings), REFRESH_MS);
	});

	pi.on("turn_end", (_event, ctx) => {
		if (stopped || ctx.mode !== "tui" || ctx.agent.kind !== "main") return;
		void refresh(ctx, findScopedSettings());
	});

	pi.on("session_shutdown", (_event, ctx) => {
		stopped = true;
		inflight?.abort();
		inflight = undefined;
		if (timer) ctx.clearTimer(timer);
		timer = undefined;
		setStatuses(ctx, undefined);
	});
}
