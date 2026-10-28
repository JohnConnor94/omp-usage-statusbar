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

/** Where each window's remaining-quota bar goes: `beside` = between label and %, `below` = extra row under the subscription, `overlay` = window text shaded as the bar, `off` = none. */
export type UsageBarMode = "beside" | "below" | "overlay" | "off";

/** Bar colour band: `ok` = remaining > warn, `warn` = remaining ≤ warn and > critical, `critical` = remaining ≤ critical. */
export type UsageBarLevel = "ok" | "warn" | "critical";

/** What `paint` styles: a level colour, `empty` bar cells, the `prefix` (provider/account) or a `reset` suffix in `parts` mode. */
export type UsagePaintStyle = UsageBarLevel | "empty" | "prefix" | "reset";

/**
 * How row text is coloured by quota level (the bar is always coloured):
 * `off` = bar only; `percent` = only `NN%`; `window` = each window in its level; `split` = `window` plus the
 * prefix in the row's worst level; `row` = whole row in the worst level; `parts` = prefix accent, `%` by level, reset dim.
 */
export type UsageTextColorMode = "off" | "percent" | "window" | "split" | "row" | "parts";

/** Bar settings for `formatUsageReports`. */
export interface UsageBarOptions {
	mode: UsageBarMode;
	/** Remaining % at or below which the bar is `warn`. */
	warn: number;
	/** Remaining % at or below which the bar is `critical`; checked before `warn`. */
	critical: number;
	/** Style a bar level, `empty` cells or text per `textColor`; thresholds also drive text levels. `inverse` paints the background (overlay). */
	paint: (style: UsagePaintStyle, text: string, inverse: boolean) => string;
}

/** Display options for `formatUsageReports`. */
export interface UsageDisplayOptions {
	label: UsageLabelMode;
	/** `UsageSubscription.key`s to leave out. */
	hidden: ReadonlySet<string>;
	resets: UsageResetMode;
	/** Bar position and shared thresholds for bar and text colors. */
	bar: UsageBarOptions;
	/** How row text follows quota levels; the bar remains colored in every mode. */
	textColor: UsageTextColorMode;
	/** Reference time for resets; defaults to `Date.now()`. */
	nowMs?: number;
}

/** Default display: full labels, nothing hidden, reset countdowns, no bar or text color. */
export const DEFAULT_DISPLAY: UsageDisplayOptions = {
	label: "full",
	hidden: new Set(),
	resets: "countdown",
	bar: { mode: "off", warn: 25, critical: 10, paint: (_style, text) => text },
	textColor: "off",
};


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

/** Width of a `beside` bar, close to the `/usage` card bars. */
const BAR_WIDTH = 10;
/** Footer sanitizing collapses ASCII space runs but keeps NBSP. */
const NBSP = "\u00a0";

function barLevel(remaining: number, bar: UsageBarOptions): UsageBarLevel {
	if (remaining <= bar.critical) return "critical";
	if (remaining <= bar.warn) return "warn";
	return "ok";
}

const LEVEL_RANK: Record<UsageBarLevel, number> = { ok: 0, warn: 1, critical: 2 };

/** `█` cells for the remaining share of `width`, then `░` cells; empty runs are not painted. */
function meter(remaining: number, width: number, bar: UsageBarOptions): string {
	const filled = Math.round((remaining / 100) * width);
	const full = "█".repeat(filled);
	const empty = "░".repeat(width - filled);
	return (full ? bar.paint(barLevel(remaining, bar), full, false) : "") + (empty ? bar.paint("empty", empty, false) : "");
}

/** Overlay: shade the leading remaining share of `text`; optionally tint the unshaded tail. */
function shade(text: string, remaining: number, bar: UsageBarOptions, tailStyle?: UsagePaintStyle): string {
	const chars = Array.from(text);
	const filled = Math.round((remaining / 100) * chars.length);
	const head = chars.slice(0, filled).join("");
	const tail = chars.slice(filled).join("");
	return (head ? bar.paint(barLevel(remaining, bar), head, true) : "") +
		(tailStyle && tail ? bar.paint(tailStyle, tail, false) : tail);
}

function formatWindow(
	w: UsageWindowEntry,
	mode: UsageResetMode,
	nowMs: number,
	sanitizeText: (text: string) => string,
	bar = "",
	style: (part: "label" | "pct" | "reset") => UsagePaintStyle | undefined = () => undefined,
	paint?: UsageBarOptions["paint"],
): string {
	const label = clean(w.label, sanitizeText);
	const pct = `${w.remaining}%`;
	let suffix = "";
	if (mode !== "off" && w.resetsAt !== undefined && w.resetsAt > nowMs) {
		const countdown = formatDuration(Math.max(60_000, Math.floor((w.resetsAt - nowMs) / 60_000) * 60_000));
		if (mode === "countdown") suffix = countdown;
		else {
			const verb = clean(w.resetVerb, sanitizeText);
			suffix = mode === "verbose" ? `(${verb} in ${countdown})` : `(${verb} ${clockText(nowMs, w.resetsAt)})`;
		}
	}
	const tint = (part: "label" | "pct" | "reset", text: string) => {
		const color = style(part);
		return color && text && paint ? paint(color, text, false) : text;
	};
	return [tint("label", label), bar, tint("pct", pct), tint("reset", suffix)].filter(Boolean).join(" ");
}

/**
 * Format status rows per visible subscription, in `listUsageSubscriptions` order.
 * Subscriptions whose key is in `display.hidden` are dropped. Each window gets its reset suffix per
 * `display.resets`; windows with no future reset time get none. In `provider` mode two accounts of the
 * same provider give two rows that start with the same provider name. Windows carry remaining-quota bars
 * per `display.bar`; `below` yields two rows per subscription (text, then bars aligned under each window).
 * Text colour follows `display.textColor`.
 */
export function formatUsageReports(
	reports: readonly UsageReport[],
	resolveUsedFraction: (limit: UsageLimit) => number | undefined,
	sanitizeText: (text: string) => string,
	display: UsageDisplayOptions,
): string[] {
	const nowMs = display.nowMs ?? Date.now();
	const { bar } = display;
	return listUsageSubscriptions(reports, resolveUsedFraction, sanitizeText)
		.filter(s => !display.hidden.has(s.key))
		.flatMap(s => {
			const prefix = clean(
				display.label === "full" ? `${s.provider}/${s.account}` : display.label === "provider" ? s.provider : "",
				sanitizeText,
			);
			const levels = s.windows.map(w => barLevel(w.remaining, bar));
			const rowLevel = levels.reduce(
				(worst, level) => (LEVEL_RANK[level] > LEVEL_RANK[worst] ? level : worst),
				"ok" as UsageBarLevel,
			);
			const prefixStyle: UsagePaintStyle | undefined =
				display.textColor === "split" || display.textColor === "row"
					? rowLevel
					: display.textColor === "parts"
						? "prefix"
						: undefined;
			const separatorStyle: UsagePaintStyle | undefined = display.textColor === "row" ? rowLevel : undefined;
			const tint = (style: UsagePaintStyle | undefined, text: string) =>
				style && text ? bar.paint(style, text, false) : text;
			const plain = s.windows.map(w => formatWindow(w, display.resets, nowMs, sanitizeText));
			const texts = s.windows.map((w, i) => {
				const level = levels[i];
				const style = (part: "label" | "pct" | "reset"): UsagePaintStyle | undefined => {
					if (display.textColor === "percent") return part === "pct" ? level : undefined;
					if (display.textColor === "window" || display.textColor === "split") return level;
					if (display.textColor === "row") return rowLevel;
					if (display.textColor === "parts") return part === "pct" ? level : part === "reset" ? "reset" : undefined;
					return undefined;
				};
				if (bar.mode === "beside") {
					return formatWindow(w, display.resets, nowMs, sanitizeText, meter(w.remaining, BAR_WIDTH, bar), style, bar.paint);
				}
				if (bar.mode === "overlay") {
					const tailStyle =
						display.textColor === "window" || display.textColor === "split"
							? level
							: display.textColor === "row"
								? rowLevel
								: undefined;
					return shade(plain[i], w.remaining, bar, tailStyle);
				}
				return formatWindow(w, display.resets, nowMs, sanitizeText, "", style, bar.paint);
			});
			const paintedPrefix = tint(prefixStyle, prefix);
			const row = (paintedPrefix ? `${paintedPrefix} ` : "") + texts.join(tint(separatorStyle, " · "));
			if (bar.mode !== "below") return [row];
			const pad = prefix ? `└${NBSP.repeat(Bun.stringWidth(prefix))}` : "";
			return [row, pad + s.windows.map((w, i) => meter(w.remaining, Bun.stringWidth(plain[i]), bar)).join(NBSP.repeat(3))];
		});
}
