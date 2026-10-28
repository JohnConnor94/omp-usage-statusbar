import { describe, expect, test } from "bun:test";
import { resolveUsedFraction, type UsageLimit, type UsageReport } from "@oh-my-pi/pi-ai";
import { sanitizeText } from "@oh-my-pi/pi-utils";
import { DEFAULT_DISPLAY, formatUsageReports, listUsageSubscriptions, type UsageBarMode, type UsageBarOptions, type UsageResetMode, type UsageTextColorMode } from "./usage-summary";

function limit(
	provider: UsageLimit["scope"]["provider"],
	id: string,
	label: string,
	amount: UsageLimit["amount"],
	window?: UsageLimit["window"],
	windowId?: string,
): UsageLimit {
	return { id, label, amount, window, scope: { provider, windowId } };
}

function report(
	provider: UsageReport["provider"],
	metadata: UsageReport["metadata"],
	limits: UsageLimit[],
): UsageReport {
	return { provider, fetchedAt: 0, metadata, limits };
}

function mixedReports(): UsageReport[] {
	return [
		report("openai-codex", { email: "same@example.com", orgId: "org-z", planType: "Plus" }, [
			limit("openai-codex", "daily", "5 Hour", { unit: "tokens", usedFraction: 0.504 }, { id: "5h", label: "5 Hour" }, "5h"),
		]),
		report("anthropic", { email: "a\u0000@example.com", orgName: "Team\nOne" }, [
			limit("anthropic", "daily", "Quota", { unit: "percent", used: 33.3 }, { id: "5h", label: "5 Hour" }, "5h"),
			limit("anthropic", "weekly", "Quota", { unit: "percent", used: 33.3 }, { id: "7d", label: "7 Day" }, "7d"),
		]),
		report("openai-codex", { email: "same@example.com", accountId: "acct-a", planType: "Team" }, [
			limit("openai-codex", "weekly", "Weekly", { unit: "tokens", remainingFraction: 0.25 }),
		]),
		report("openai-codex", { email: "same@example.com" }, [
			limit("openai-codex", "hourly", "Hourly", { unit: "tokens", usedFraction: 0.1 }),
		]),
	];
}

describe("formatUsageReports", () => {
	test("renders sorted provider, account, and window entries with compact labels", () => {
		const reports = mixedReports();
		const expected = [
			"anthropic/a@example.com (Team One) Quota 5 Hour 67% · Quota 7 Day 67%",
			"openai-codex/same@example.com (#4) Hourly 90%",
			"openai-codex/same@example.com (acct-a, Team) Weekly 25%",
			"openai-codex/same@example.com (org-z, Plus) 5 Hour 50%",
		];

		expect(formatUsageReports(reports, resolveUsedFraction, sanitizeText, DEFAULT_DISPLAY)).toEqual(expected);
		expect(formatUsageReports([...reports.slice(0, 3)].reverse(), resolveUsedFraction, sanitizeText, DEFAULT_DISPLAY)).toEqual([
			"anthropic/a@example.com (Team One) Quota 5 Hour 67% · Quota 7 Day 67%",
			"openai-codex/same@example.com (acct-a, Team) Weekly 25%",
			"openai-codex/same@example.com (org-z, Plus) 5 Hour 50%",
		]);
	});

	test("provider and none label modes drop the account part", () => {
		const anthropic = mixedReports().slice(1, 2);
		expect(formatUsageReports(anthropic, resolveUsedFraction, sanitizeText, { ...DEFAULT_DISPLAY, label: "provider" })).toEqual([
			"anthropic Quota 5 Hour 67% · Quota 7 Day 67%",
		]);
		expect(formatUsageReports(anthropic, resolveUsedFraction, sanitizeText, { ...DEFAULT_DISPLAY, label: "none" })).toEqual([
			"Quota 5 Hour 67% · Quota 7 Day 67%",
		]);
	});

	test("hidden removes exactly the matching subscription", () => {
		const hidden = new Set(["openai-codex/same@example.com (acct-a, Team)"]);
		expect(formatUsageReports(mixedReports(), resolveUsedFraction, sanitizeText, { ...DEFAULT_DISPLAY, hidden })).toEqual([
			"anthropic/a@example.com (Team One) Quota 5 Hour 67% · Quota 7 Day 67%",
			"openai-codex/same@example.com (#4) Hourly 90%",
			"openai-codex/same@example.com (org-z, Plus) 5 Hour 50%",
		]);
	});

	test("listUsageSubscriptions keys match full-mode rows order", () => {
		const reports = [
			report("openai-codex", { email: "same@example.com", accountId: "acct-a", planType: "Team" }, [
				limit("openai-codex", "weekly", "Weekly", { unit: "tokens", remainingFraction: 0.25 }),
			]),
			report("anthropic", { email: "a\u0000@example.com", orgName: "Team\nOne" }, [
				limit("anthropic", "daily", "Quota", { unit: "percent", used: 33.3 }, { id: "5h", label: "5 Hour" }, "5h"),
			]),
		];
		const subscriptions = listUsageSubscriptions(reports, resolveUsedFraction, sanitizeText);
		const rows = formatUsageReports(reports, resolveUsedFraction, sanitizeText, DEFAULT_DISPLAY);
		expect(subscriptions.map(s => s.key)).toEqual([
			"anthropic/a@example.com (Team One)",
			"openai-codex/same@example.com (Team)",
		]);
		subscriptions.forEach((s, i) => expect(rows[i].startsWith(`${s.key} `)).toBe(true));
	});

	test("clamps over-limit and negative usage, and skips unresolved or non-finite amounts", () => {
		const quotas = report("anthropic", { accountId: "acct" }, [
			limit("anthropic", "over", "Over", { unit: "tokens", usedFraction: 1.25 }),
			limit("anthropic", "negative", "Negative", { unit: "tokens", usedFraction: -0.1 }),
			limit("anthropic", "nan", "NaN", { unit: "tokens", usedFraction: Number.NaN }),
			limit("anthropic", "infinite", "Infinite", { unit: "tokens", usedFraction: Number.POSITIVE_INFINITY }),
			limit("anthropic", "missing", "Missing", { unit: "tokens" }),
		]);

		expect(formatUsageReports([quotas], resolveUsedFraction, sanitizeText, DEFAULT_DISPLAY)).toEqual([
			"anthropic/acct Negative 100% · Over 0%",
		]);
	});

	test("uses account and project scope fallbacks without exposing raw report data", () => {
		const reports = [
			{
				...report("anthropic", { projectId: "metadata-project" }, [
					{ ...limit("anthropic", "one", "5h", { unit: "percent", used: 50 }), scope: { provider: "anthropic", accountId: "scope-account" } },
				]),
				raw: { accessToken: "secret" },
			},
			report("google-antigravity", {}, [
				{ ...limit("google-antigravity", "two", "Quota", { unit: "percent", used: 10 }), scope: { provider: "google-antigravity", projectId: "scope-project", windowId: "monthly" } },
			]),
			report("google-antigravity", { projectId: "metadata-project", orgId: "org-1" }, [
				limit("google-antigravity", "metadata", "Daily", { unit: "percent", used: 20 }),
			]),
			report("google-antigravity", {}, [
				limit("google-antigravity", "unknown-account", "Weekly", { unit: "percent", used: 30 }),
			]),
		];
		const rows = formatUsageReports(reports, resolveUsedFraction, sanitizeText, DEFAULT_DISPLAY);

		expect(rows).toContain("anthropic/scope-account 5h 50%");
		expect(rows).toContain("google-antigravity/account 4 Weekly 70%");
		expect(rows).toContain("google-antigravity/metadata-project (org-1) Daily 80%");
		expect(rows).toContain("google-antigravity/scope-project Quota monthly 90%");
		expect(rows.join(" · ")).not.toContain("secret");
	});

	test("returns empty text for empty reports or reports without resolved quota", () => {
		expect(formatUsageReports([], resolveUsedFraction, sanitizeText, DEFAULT_DISPLAY)).toEqual([]);
		expect(
			formatUsageReports([report("anthropic", {}, [limit("anthropic", "unknown", "Unknown", { unit: "unknown" })])], resolveUsedFraction, sanitizeText, DEFAULT_DISPLAY),
		).toEqual([]);
	});
});

describe("reset times", () => {
	const now = new Date(2026, 9, 28, 12, 0).getTime();
	const rows = (resetsAt: number, resets: UsageResetMode, resetLabel?: string) =>
		formatUsageReports(
			[
				report("anthropic", { accountId: "acct" }, [
					limit("anthropic", "daily", "Quota", { unit: "percent", used: 31 }, { id: "5h", label: "5 Hour", resetsAt, resetLabel }, "5h"),
				]),
			],
			resolveUsedFraction,
			sanitizeText,
			{ ...DEFAULT_DISPLAY, label: "none", resets, nowMs: now },
		);
	const inTwoHalfHours = now + 2.5 * 3_600_000 + 59_000;

	test("countdown floors to whole minutes", () => {
		expect(rows(inTwoHalfHours, "countdown")).toEqual(["Quota 5 Hour 69% 2h30m"]);
	});

	test("verbose uses the provider verb, defaulting to resets", () => {
		expect(rows(inTwoHalfHours, "verbose")).toEqual(["Quota 5 Hour 69% (resets in 2h30m)"]);
		expect(rows(inTwoHalfHours, "verbose", "tick")).toEqual(["Quota 5 Hour 69% (tick in 2h30m)"]);
	});

	test("clock shows time today, weekday within 6 days, date beyond", () => {
		expect(rows(new Date(2026, 9, 28, 18, 0).getTime(), "clock")).toEqual(["Quota 5 Hour 69% (resets 18:00)"]);
		expect(rows(new Date(2026, 9, 30, 9, 5).getTime(), "clock")).toEqual(["Quota 5 Hour 69% (resets Fri 09:05)"]);
		expect(rows(new Date(2026, 10, 10, 0, 0).getTime(), "clock")).toEqual(["Quota 5 Hour 69% (resets 10 Nov)"]);
	});

	test("off, missing, and past resets add no suffix", () => {
		expect(rows(inTwoHalfHours, "off")).toEqual(["Quota 5 Hour 69%"]);
		expect(rows(now - 1, "countdown")).toEqual(["Quota 5 Hour 69%"]);
		expect(rows(Number.NaN, "countdown")).toEqual(["Quota 5 Hour 69%"]);
	});

	test("countdown under a minute shows 1m", () => {
		expect(rows(now + 10_000, "countdown")).toEqual(["Quota 5 Hour 69% 1m"]);
	});
});

describe("bars", () => {
	const paint: UsageBarOptions["paint"] = (level, text, inverse) => `<${inverse ? "^" : ""}${level}>${text}</>`;
	const rows = (mode: UsageBarMode, label: "full" | "none", limits: UsageLimit[]) =>
		formatUsageReports(
			[report("anthropic", { accountId: "acct" }, limits)],
			resolveUsedFraction,
			sanitizeText,
			{ ...DEFAULT_DISPLAY, label, resets: "off", bar: { mode, warn: 25, critical: 10, paint } },
		);
	const quota = (used: number, windowId = "5h", windowLabel = "5 Hour") =>
		limit("anthropic", "daily", "Quota", { unit: "percent", used }, { id: windowId, label: windowLabel }, windowId);

	test("beside draws one ten-cell remaining bar per window", () => {
		expect(rows("beside", "none", [quota(31)])).toEqual(["Quota 5 Hour <ok>███████</><empty>░░░</> 69%"]);
	});

	test("beside uses inclusive threshold bands and does not paint empty full bars", () => {
		expect(rows("beside", "none", [quota(74)])).toEqual(["Quota 5 Hour <ok>███</><empty>░░░░░░░</> 26%"]);
		expect(rows("beside", "none", [quota(75)])).toEqual(["Quota 5 Hour <warn>███</><empty>░░░░░░░</> 25%"]);
		expect(rows("beside", "none", [quota(90)])).toEqual(["Quota 5 Hour <critical>█</><empty>░░░░░░░░░</> 10%"]);
		expect(rows("beside", "none", [quota(100)])).toEqual(["Quota 5 Hour <empty>░░░░░░░░░░</> 0%"]);
	});

	test("overlay shades the remaining share of each window text", () => {
		expect(rows("overlay", "none", [quota(31)])).toEqual(["<^ok>Quota 5 Hou</>r 69%"]);
	});

	test("below aligns bars under each window on a second row", () => {
		expect(rows("below", "full", [quota(31), quota(75, "7d", "7 Day")])).toEqual([
			"anthropic/acct Quota 5 Hour 69% · Quota 7 Day 25%",
			"└" + "\u00a0".repeat(14) + "<ok>" + "█".repeat(11) + "</><empty>░░░░░</>" + "\u00a0".repeat(3) + "<warn>████</><empty>" + "░".repeat(11) + "</>",
		]);
	});

	test("off leaves windows unbarred", () => {
		expect(rows("off", "none", [quota(31)])).toEqual(["Quota 5 Hour 69%"]);
	});
});

describe("text color", () => {
	const now = new Date(2026, 9, 28, 12, 0).getTime();
	const paint: UsageBarOptions["paint"] = (style, text, inverse) => `<${inverse ? "^" : ""}${style}>${text}</>`;
	const resetAt = now + 2.5 * 3_600_000 + 59_000;
	const limits = [
		limit("anthropic", "daily", "Quota", { unit: "percent", used: 95 }, { id: "5h", label: "5 Hour", resetsAt: resetAt }, "5h"),
		limit("anthropic", "weekly", "Quota", { unit: "percent", used: 31 }, { id: "7d", label: "7 Day" }, "7d"),
	];
	const rows = (textColor: UsageTextColorMode) =>
		formatUsageReports(
			[report("anthropic", { accountId: "acct" }, limits)],
			resolveUsedFraction,
			sanitizeText,
			{
				...DEFAULT_DISPLAY,
				label: "full",
				resets: "countdown",
				nowMs: now,
				bar: { mode: "off", warn: 25, critical: 10, paint },
				textColor,
			},
		);

	test("colors pieces by mode using each window and the row's worst level", () => {
		const expected: Record<UsageTextColorMode, string> = {
			off: "anthropic/acct Quota 5 Hour 5% 2h30m · Quota 7 Day 69%",
			percent: "anthropic/acct Quota 5 Hour <critical>5%</> 2h30m · Quota 7 Day <ok>69%</>",
			window: "anthropic/acct <critical>Quota 5 Hour</> <critical>5%</> <critical>2h30m</> · <ok>Quota 7 Day</> <ok>69%</>",
			split: "<critical>anthropic/acct</> <critical>Quota 5 Hour</> <critical>5%</> <critical>2h30m</> · <ok>Quota 7 Day</> <ok>69%</>",
			row: "<critical>anthropic/acct</> <critical>Quota 5 Hour</> <critical>5%</> <critical>2h30m</><critical> · </><critical>Quota 7 Day</> <critical>69%</>",
			parts: "<prefix>anthropic/acct</> Quota 5 Hour <critical>5%</> <reset>2h30m</> · Quota 7 Day <ok>69%</>",
		};
		for (const mode of Object.keys(expected) as UsageTextColorMode[]) expect(rows(mode)).toEqual([expected[mode]]);
	});

	test("beside keeps bar and window pieces in their own level colors", () => {
		const single = formatUsageReports(
			[report("anthropic", { accountId: "acct" }, [limit("anthropic", "daily", "Quota", { unit: "percent", used: 31 }, { id: "5h", label: "5 Hour" }, "5h")])],
			resolveUsedFraction,
			sanitizeText,
			{
				...DEFAULT_DISPLAY,
				label: "none",
				resets: "off",
				bar: { mode: "beside", warn: 25, critical: 10, paint },
				textColor: "window",
			},
		);
		expect(single).toEqual(["<ok>Quota 5 Hour</> <ok>███████</><empty>░░░</> <ok>69%</>"]);
	});

	test("overlay colors the shaded head and window-mode tail separately", () => {
		const single = formatUsageReports(
			[report("anthropic", { accountId: "acct" }, [limit("anthropic", "daily", "Quota", { unit: "percent", used: 31 }, { id: "5h", label: "5 Hour" }, "5h")])],
			resolveUsedFraction,
			sanitizeText,
			{
				...DEFAULT_DISPLAY,
				label: "none",
				resets: "off",
				bar: { mode: "overlay", warn: 25, critical: 10, paint },
				textColor: "window",
			},
		);
		expect(single).toEqual(["<^ok>Quota 5 Hou</><ok>r 69%</>"]);
	});
});
