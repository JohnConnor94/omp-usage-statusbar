import { describe, expect, test } from "bun:test";
import { resolveUsedFraction, type UsageLimit, type UsageReport } from "@oh-my-pi/pi-ai";
import { sanitizeText } from "@oh-my-pi/pi-utils";
import { DEFAULT_DISPLAY, formatUsageReports, listUsageSubscriptions, type UsageResetMode } from "./usage-summary";

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
