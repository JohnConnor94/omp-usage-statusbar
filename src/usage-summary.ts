import type { UsageLimit, UsageReport } from "@oh-my-pi/pi-ai";
import { formatDuration } from "@oh-my-pi/pi-utils";

const str = (value: unknown): string | undefined =>
	typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;

function firstScope(report: UsageReport, key: "accountId" | "projectId"): string | undefined {
	for (const limit of report.limits) {
		const value = str(limit.scope[key]);
		if (value) return value;
	}
	return undefined;
}

function accountLabel(report: UsageReport, index: number, duplicateEmail: boolean): string {
	const meta = report.metadata ?? {};
	const email = str(meta.email);
	const accountId = str(meta.accountId) ?? firstScope(report, "accountId");
	const orgId = str(meta.orgId) ?? report.limits.map(l => str(l.scope.orgId)).find(Boolean);
	const base =
		email ?? accountId ?? str(meta.projectId) ?? firstScope(report, "projectId") ?? `account ${index + 1}`;
	const extras: string[] = [];
	if (report.provider === "openai-codex") {
		if (duplicateEmail && email) extras.push(orgId ?? accountId ?? `#${index + 1}`);
		const plan = str(meta.planType);
		if (plan) extras.push(plan);
	} else {
		const org = str(meta.orgName) ?? orgId;
		if (org && org !== base) extras.push(org);
	}
	return extras.length ? `${base} (${extras.join(", ")})` : base;
}

function windowLabel(limit: UsageLimit): string {
	let label = limit.label;
	const extra = str(limit.window?.label) ?? str(limit.scope.windowId);
	if (extra && !label.toLowerCase().includes(extra.toLowerCase())) label = `${label} ${extra}`;
	return label;
}

/** Sanitize `text` and collapse whitespace runs into single spaces. */
function clean(text: string, sanitizeText: (text: string) => string): string {
	return sanitizeText(text).replace(/\s+/g, " ").trim();
}

/** One quota window of a subscription; reset fields are absent when the provider gives none. */
export interface UsageWindowEntry {
	label: string;
	remaining: number;
	/** Reset time, epoch ms. */
	resetsAt?: number;
	/** Verb before the reset time: the provider's `resetLabel`, else `resets`. */
	resetVerb: string;
}

/** One provider account (one report) with its quota windows. */
export interface UsageSubscription {
	/** Stable identity `<provider>/<account>`, sanitized; used to hide a subscription. */
	key: string;
	provider: string;
	account: string;
	/** Quota windows, sorted by label. */
	windows: UsageWindowEntry[];
}

/**
 * List one subscription per report, grouping that account's quota windows.
 * Sorted by provider, account, then report index. Limits whose used fraction is unresolved or non-finite
 * are skipped; reports left with no limit yield no subscription.
 */
export function listUsageSubscriptions(
	reports: readonly UsageReport[],
	resolveUsedFraction: (limit: UsageLimit) => number | undefined,
	sanitizeText: (text: string) => string,
): UsageSubscription[] {
	const codexEmails = new Map<string, number>();
	for (const report of reports) {
		const email = report.provider === "openai-codex" ? str(report.metadata?.email) : undefined;
		if (email) codexEmails.set(email, (codexEmails.get(email) ?? 0) + 1);
	}

	const entries: {
		reportIndex: number;
		provider: string;
		account: string;
		window: string;
		remaining: number;
		resetsAt?: number;
		resetVerb: string;
	}[] = [];
	reports.forEach((report, index) => {
		const email = str(report.metadata?.email);
		const account = accountLabel(report, index, !!email && (codexEmails.get(email) ?? 0) > 1);
		for (const limit of report.limits) {
			const used = resolveUsedFraction(limit);
			if (used === undefined || !Number.isFinite(used)) continue;
			entries.push({
				reportIndex: index,
				provider: report.provider,
				account,
				window: windowLabel(limit),
				remaining: Math.round(Math.min(Math.max(1 - used, 0), 1) * 100),
				resetsAt: Number.isFinite(limit.window?.resetsAt) ? limit.window?.resetsAt : undefined,
				resetVerb: str(limit.window?.resetLabel) ?? "resets",
			});
		}
	});

	const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
	entries.sort(
		(a, b) =>
			cmp(a.provider, b.provider) ||
			cmp(a.account, b.account) ||
			a.reportIndex - b.reportIndex ||
			cmp(a.window, b.window),
	);

	const subscriptions: (UsageSubscription & { reportIndex: number })[] = [];
	for (const entry of entries) {
		const window: UsageWindowEntry = {
			label: entry.window,
			remaining: entry.remaining,
			resetsAt: entry.resetsAt,
			resetVerb: entry.resetVerb,
		};
		const previous = subscriptions[subscriptions.length - 1];
		if (previous?.reportIndex === entry.reportIndex) previous.windows.push(window);
		else {
			subscriptions.push({
				reportIndex: entry.reportIndex,
				key: clean(`${entry.provider}/${entry.account}`, sanitizeText),
				provider: entry.provider,
				account: entry.account,
				windows: [window],
			});
		}
	}
	return subscriptions.map(({ reportIndex: _reportIndex, ...subscription }) => subscription);
}

/** How a row names its account: `full` = `<provider>/<account>`, `provider` = provider only, `none` = windows only. */
export type UsageLabelMode = "full" | "provider" | "none";

/** How each window shows its reset: `countdown` = `2h30m`, `verbose` = `(resets in 2h30m)`, `clock` = `(resets 18:00)`, `off` = nothing. */
export type UsageResetMode = "countdown" | "verbose" | "clock" | "off";

/** Display options for `formatUsageReports`. */
export interface UsageDisplayOptions {
	label: UsageLabelMode;
	/** `UsageSubscription.key`s to leave out. */
	hidden: ReadonlySet<string>;
	resets: UsageResetMode;
	/** Reference time for resets; defaults to `Date.now()`. */
	nowMs?: number;
}

/** Default display: full labels, nothing hidden, reset countdowns. */
export const DEFAULT_DISPLAY: UsageDisplayOptions = { label: "full", hidden: new Set(), resets: "countdown" };

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Local reset time as `/usage` shows it: `18:00` today, `Tue 18:00` within 6 days, else `3 Oct`. */
function clockText(nowMs: number, atMs: number): string {
	const at = new Date(atMs);
	const time = `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
	if (at.toDateString() === new Date(nowMs).toDateString()) return time;
	if (atMs - nowMs < 6 * 86_400_000) return `${WEEKDAYS[at.getDay()]} ${time}`;
	return `${at.getDate()} ${MONTHS[at.getMonth()]}`;
}

function formatWindow(w: UsageWindowEntry, mode: UsageResetMode, nowMs: number): string {
	const base = `${w.label} ${w.remaining}%`;
	if (mode === "off" || w.resetsAt === undefined || w.resetsAt <= nowMs) return base;
	// Whole minutes with a 1-minute floor: the footer redraws about every 60 s, so seconds would be stale.
	const countdown = formatDuration(Math.max(60_000, Math.floor((w.resetsAt - nowMs) / 60_000) * 60_000));
	if (mode === "countdown") return `${base} ${countdown}`;
	if (mode === "verbose") return `${base} (${w.resetVerb} in ${countdown})`;
	return `${base} (${w.resetVerb} ${clockText(nowMs, w.resetsAt)})`;
}

/**
 * Format one status row per visible subscription, in `listUsageSubscriptions` order.
 * Subscriptions whose key is in `display.hidden` are dropped. Each window gets its reset suffix per
 * `display.resets`; windows with no future reset time get none. In `provider` mode two accounts of the
 * same provider give two rows that start with the same provider name.
 */
export function formatUsageReports(
	reports: readonly UsageReport[],
	resolveUsedFraction: (limit: UsageLimit) => number | undefined,
	sanitizeText: (text: string) => string,
	display: UsageDisplayOptions,
): string[] {
	const nowMs = display.nowMs ?? Date.now();
	return listUsageSubscriptions(reports, resolveUsedFraction, sanitizeText)
		.filter(s => !display.hidden.has(s.key))
		.map(s => {
			const windows = s.windows.map(w => formatWindow(w, display.resets, nowMs)).join(" · ");
			const prefix =
				display.label === "full" ? `${s.provider}/${s.account} ` : display.label === "provider" ? `${s.provider} ` : "";
			return clean(prefix + windows, sanitizeText);
		});
}
