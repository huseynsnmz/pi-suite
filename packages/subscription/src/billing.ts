// How Claude Code says a request is billed. Its rate_limit_event arrives with the response, so the
// first such request can only be stopped once it has started. Later ones are asked about first.
export interface RateLimitInfo {
	status?: string;
	resetsAt?: number;
	overageResetsAt?: number;
	rateLimitType?: string;
	isUsingOverage?: boolean;
	overageInUse?: boolean;
}

export function billsExtraUsage(info: RateLimitInfo | undefined): boolean {
	if (info === undefined) return false;
	// Over the plan's limit the status is "rejected", yet the request is served from extra usage.
	if (info.isUsingOverage === true) return true;
	return info.status !== "rejected" && (info.overageInUse === true || info.rateLimitType === "overage");
}

export const EXTRA_USAGE_QUESTION = "Claude says requests are now billed as extra usage, beyond your plan's limits. Nothing more is sent unless you allow it. Allow it?";
export const EXTRA_USAGE_NO = "No, stop";
export const EXTRA_USAGE_YES = "Yes, bill extra usage for this session";

export const EXTRA_USAGE_STOPPED = "Stopped, because requests are billed as extra usage and it wasn't approved. Anything used before it stopped may still be billed.";
export const EXTRA_USAGE_RESEND = "Extra usage is approved for this session. The reply had already started, so send your message again.";

/** Whether this report still holds. With no end time to go by, it holds until a request says otherwise. */
export function stillBilling(info: RateLimitInfo | undefined, nowSeconds: number): boolean {
	if (info === undefined) return false;
	const until = info.resetsAt;
	return until === undefined || until > nowSeconds;
}

const THIRD_PARTY = /third-party apps now draw from your extra usage/i;

/** Claude's wording alone doesn't say what happened to the request, or what to do about it. */
export function explainError(text: string): string {
	if (!THIRD_PARTY.test(text)) return text;
	return `${text}\nAnthropic refused this request as third-party use. To go on, turn on extra usage in your Claude settings or choose another model. You'll be asked here before it's billed.`;
}
