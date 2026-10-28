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

/** Compact `<provider>/<account> <window> <remaining>%` summary; skips limits without a resolvable fraction. */
export function formatUsageReports(
	reports: readonly UsageReport[],
	resolveUsedFraction: (limit: UsageLimit) => number | undefined,
	sanitizeText: (text: string) => string,
): string {
	const codexEmails = new Map<string, number>();
	for (const report of reports) {
		const email = report.provider === "openai-codex" ? str(report.metadata?.email) : undefined;
		if (email) codexEmails.set(email, (codexEmails.get(email) ?? 0) + 1);
	}

	const entries: { provider: string; account: string; window: string; text: string }[] = [];
	reports.forEach((report, index) => {
		const email = str(report.metadata?.email);
		const account = accountLabel(report, index, !!email && (codexEmails.get(email) ?? 0) > 1);
		for (const limit of report.limits) {
			const used = resolveUsedFraction(limit);
			if (used === undefined || !Number.isFinite(used)) continue;
			const remaining = Math.round(Math.min(Math.max(1 - used, 0), 1) * 100);
			const window = windowLabel(limit);
			entries.push({
				provider: report.provider,
				account,
				window,
				text: sanitizeText(`${report.provider}/${account} ${window} ${remaining}%`),
			});
		}
	});

	const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
	entries.sort((a, b) => cmp(a.provider, b.provider) || cmp(a.account, b.account) || cmp(a.window, b.window));
	return entries.map(e => e.text).join(" · ");
}
