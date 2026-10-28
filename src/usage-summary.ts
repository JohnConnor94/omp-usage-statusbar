import type { UsageLimit, UsageReport } from "@oh-my-pi/pi-ai";

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

/** One provider account (one report) with its formatted quota windows. */
export interface UsageSubscription {
	/** Stable identity `<provider>/<account>`, sanitized; used to hide a subscription. */
	key: string;
	provider: string;
	account: string;
	/** Formatted `<window> <remaining>%` strings, sorted by window label. */
	windows: string[];
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

	const entries: { reportIndex: number; provider: string; account: string; window: string; remaining: number }[] = [];
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
		const window = `${entry.window} ${entry.remaining}%`;
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

/** Display options for `formatUsageReports`. */
export interface UsageDisplayOptions {
	label: UsageLabelMode;
	/** `UsageSubscription.key`s to leave out. */
	hidden: ReadonlySet<string>;
}

/** Default display: full labels, nothing hidden. */
export const DEFAULT_DISPLAY: UsageDisplayOptions = { label: "full", hidden: new Set() };

/**
 * Format one status row per visible subscription, in `listUsageSubscriptions` order.
 * Subscriptions whose key is in `display.hidden` are dropped. In `provider` mode two accounts of the
 * same provider give two rows that start with the same provider name.
 */
export function formatUsageReports(
	reports: readonly UsageReport[],
	resolveUsedFraction: (limit: UsageLimit) => number | undefined,
	sanitizeText: (text: string) => string,
	display: UsageDisplayOptions,
): string[] {
	return listUsageSubscriptions(reports, resolveUsedFraction, sanitizeText)
		.filter(s => !display.hidden.has(s.key))
		.map(s => {
			const windows = s.windows.join(" · ");
			const prefix =
				display.label === "full" ? `${s.provider}/${s.account} ` : display.label === "provider" ? `${s.provider} ` : "";
			return clean(prefix + windows, sanitizeText);
		});
}
