import { describe, expect, test } from "bun:test";
import { resolveUsedFraction, type UsageLimit, type UsageReport } from "@oh-my-pi/pi-ai";
import { sanitizeText } from "@oh-my-pi/pi-utils";
import { formatUsageReports } from "./usage-summary";

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

describe("formatUsageReports", () => {
	test("renders sorted provider, account, and window entries with compact labels", () => {
		const reports = [
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
		const expected = [
			"anthropic/a@example.com (Team One) Quota 5 Hour 67% · Quota 7 Day 67%",
			"openai-codex/same@example.com (#4) Hourly 90%",
			"openai-codex/same@example.com (acct-a, Team) Weekly 25%",
			"openai-codex/same@example.com (org-z, Plus) 5 Hour 50%",
		];

		expect(formatUsageReports(reports, resolveUsedFraction, sanitizeText)).toEqual(expected);
		expect(formatUsageReports([...reports.slice(0, 3)].reverse(), resolveUsedFraction, sanitizeText)).toEqual([
			"anthropic/a@example.com (Team One) Quota 5 Hour 67% · Quota 7 Day 67%",
			"openai-codex/same@example.com (acct-a, Team) Weekly 25%",
			"openai-codex/same@example.com (org-z, Plus) 5 Hour 50%",
		]);
	});

	test("clamps over-limit and negative usage, and skips unresolved or non-finite amounts", () => {
		const quotas = report("anthropic", { accountId: "acct" }, [
			limit("anthropic", "over", "Over", { unit: "tokens", usedFraction: 1.25 }),
			limit("anthropic", "negative", "Negative", { unit: "tokens", usedFraction: -0.1 }),
			limit("anthropic", "nan", "NaN", { unit: "tokens", usedFraction: Number.NaN }),
			limit("anthropic", "infinite", "Infinite", { unit: "tokens", usedFraction: Number.POSITIVE_INFINITY }),
			limit("anthropic", "missing", "Missing", { unit: "tokens" }),
		]);

		expect(formatUsageReports([quotas], resolveUsedFraction, sanitizeText)).toEqual([
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
		const rows = formatUsageReports(reports, resolveUsedFraction, sanitizeText);

		expect(rows).toContain("anthropic/scope-account 5h 50%");
		expect(rows).toContain("google-antigravity/account 4 Weekly 70%");
		expect(rows).toContain("google-antigravity/metadata-project (org-1) Daily 80%");
		expect(rows).toContain("google-antigravity/scope-project Quota monthly 90%");
		expect(rows.join(" · ")).not.toContain("secret");
	});

	test("returns empty text for empty reports or reports without resolved quota", () => {
		expect(formatUsageReports([], resolveUsedFraction, sanitizeText)).toEqual([]);
		expect(
			formatUsageReports([report("anthropic", {}, [limit("anthropic", "unknown", "Unknown", { unit: "unknown" })])], resolveUsedFraction, sanitizeText),
		).toEqual([]);
	});
});
