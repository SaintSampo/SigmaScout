/**
 * The TBA webhook entry (quick task 261019-ooj): push instead of poll.
 *
 * THE PROTOCOL (read from TBA's own source, `webhook_request.py` and the
 * notification classes). TBA POSTs JSON, `Content-Type: application/json;
 * charset=utf-8`, with `X-TBA-Version: 1` and `X-TBA-HMAC`: the lowercase hex
 * HMAC-SHA256 of the raw request body bytes, keyed with the shared secret as
 * UTF-8. `X-TBA-Checksum` is a deprecated SHA-1 and is ignored. The body is
 * `{"message_type": "<type>", "message_data": {...}}`. Three types are acted
 * on: `match_score`, `schedule_updated` and `alliance_selection`, each naming
 * an `event_key`. `verification` (carrying the key the operator types into the
 * TBA account page) and `ping` are answered. Every other type is answered 200
 * and ignored.
 *
 * THE 10 SECOND RULE. TBA waits at most 10 s for an answer, and a non-200 or a
 * timeout can get the webhook deleted. So the handler answers at once and runs
 * the tick inside `ctx.waitUntil`, never awaiting it.
 *
 * THE 30 SECOND CAP. Cloudflare extends a fetch invocation for up to 30 s after
 * the response is sent; `waitUntil` work not settled by then is cancelled. The
 * cron's `scheduled()` path has no such cap. A webhook tick therefore runs under
 * a deadline of `WEBHOOK_TICK_DEADLINE_MS` from the handler's entry: after it,
 * the tick takes no new fold claim and no new fold lease, so a Phase A section
 * never starts with less than about 10 s left.
 *
 * NOTHING SECRET IS EVER LOGGED OR ECHOED: not the body, not the `X-TBA-HMAC`
 * value, not the computed digest, not the secret. Error responses carry short
 * fixed text.
 *
 * `scheduled.ts` imports this module by value, so this module takes
 * `RunTickDeps` and `TickResult` from it as types only and receives `runTick`
 * through `deps`: there is no value import cycle.
 */
import { z } from "zod";
import type { RunTickDeps, TickResult } from "./scheduled.js";
import type { Env } from "./env.js";
import { reportTick } from "./tickLog.js";

/** The one path the fetch entry serves. */
export const TBA_WEBHOOK_PATH = "/tba-webhook";

/** The largest body accepted, 1 MiB. TBA's largest message (an alliance selection carrying the whole event) is far smaller. */
export const TBA_WEBHOOK_MAX_BODY_BYTES = 1_048_576;

/** A TBA event key: a four digit year, then lowercase letters and digits. Anything else never reaches `runTick`. */
export const TBA_EVENT_KEY_PATTERN = /^\d{4}[a-z0-9]+$/;

/**
 * How long after the handler's entry a webhook tick may still take a new fold
 * section. Cloudflare cancels `waitUntil` work 30 s after the response; the
 * fold lease wait and the fold claim both stop at 20 s, so a Phase A section
 * never starts with less than 10 s left. One-event ticks take about 4 s.
 */
export const WEBHOOK_TICK_DEADLINE_MS = 20_000;

export interface TbaWebhookDeps {
  /** Required: this module cannot default it without a value import of `scheduled.ts`. */
  readonly runTick: (env: Env, deps?: RunTickDeps) => Promise<TickResult>;
  /** Test-only: the clock for `durationMs` and the tick deadline. Defaults to `Date.now`. */
  readonly now?: () => number;
}

/** The message types that start a one-event tick. */
const ACTED_ON_TYPES: ReadonlySet<string> = new Set(["match_score", "schedule_updated", "alliance_selection"]);

const EnvelopeSchema = z.object({ message_type: z.string(), message_data: z.unknown().optional() });
const VerificationDataSchema = z.object({ verification_key: z.string().min(1) });
const EventKeyDataSchema = z.object({ event_key: z.string().regex(TBA_EVENT_KEY_PATTERN) });

function textResponse(status: number, text: string, headers: Record<string, string> = {}): Response {
  return new Response(text, { status, headers: { "Content-Type": "text/plain; charset=utf-8", ...headers } });
}

function jsonResponse(body: { readonly accepted: boolean }): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

function rejected(status: number, text: string, reason: "hmac" | "size" | "malformed" | "event_key"): Response {
  console.warn(JSON.stringify({ msg: "tba-webhook-rejected", reason }));
  return textResponse(status, text);
}

function toHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Compares two strings in constant time over their bytes: unequal lengths
 * reject, and otherwise every byte pair is XOR-accumulated with no early exit,
 * accepting only when the accumulator is 0. `crypto.subtle.timingSafeEqual` is
 * Workers-only and the tests run in Node, so it is not used.
 */
function constantTimeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left[i]! ^ right[i]!;
  return diff === 0;
}

async function hmacSha256Hex(secret: string, body: ArrayBuffer): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toHex(await crypto.subtle.sign("HMAC", key, body));
}

/**
 * Answers one request to the fetch entry. Never throws: a rejecting `runTick`
 * surfaces only through the `waitUntil` promise, which `reportTick` logs and
 * rethrows. The checks run in order and the first that applies answers.
 */
export async function handleTbaWebhook(request: Request, env: Env, ctx: ExecutionContext, deps: TbaWebhookDeps): Promise<Response> {
  const now = deps.now ?? Date.now;
  const startedMs = now();

  if (new URL(request.url).pathname !== TBA_WEBHOOK_PATH) return textResponse(404, "Not found");
  if (request.method !== "POST") return textResponse(405, "Method not allowed", { Allow: "POST" });

  const secret = env.TBA_WEBHOOK_SECRET;
  if (secret === undefined || secret === "") {
    console.warn(JSON.stringify({ msg: "tba-webhook-secret-missing" }));
    return textResponse(503, "Webhook not configured");
  }

  // The size cap, against the declared length before reading and against the
  // real length after.
  const declaredLength = Number.parseInt(request.headers.get("Content-Length") ?? "", 10);
  if (Number.isFinite(declaredLength) && declaredLength > TBA_WEBHOOK_MAX_BODY_BYTES) return rejected(413, "Payload too large", "size");
  let body: ArrayBuffer;
  try {
    body = await request.arrayBuffer();
  } catch {
    return rejected(400, "Bad request", "malformed");
  }
  if (body.byteLength > TBA_WEBHOOK_MAX_BODY_BYTES) return rejected(413, "Payload too large", "size");

  // The signature, over the exact bytes received.
  const sent = request.headers.get("X-TBA-HMAC");
  if (sent === null) return rejected(401, "Unauthorized", "hmac");
  const expected = await hmacSha256Hex(secret, body);
  if (!constantTimeEqual(sent.trim().toLowerCase(), expected)) return rejected(401, "Unauthorized", "hmac");

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(new TextDecoder().decode(body));
  } catch {
    return rejected(400, "Bad request", "malformed");
  }
  const envelope = EnvelopeSchema.safeParse(parsedJson);
  if (!envelope.success) return rejected(400, "Bad request", "malformed");
  const messageType = envelope.data.message_type;

  if (messageType === "verification") {
    const data = VerificationDataSchema.safeParse(envelope.data.message_data);
    if (!data.success) return rejected(400, "Bad request", "malformed");
    // Not a secret: a one-time activation key, usable only from the logged-in
    // TBA account page. The operator reads it from `wrangler tail`.
    console.log(JSON.stringify({ msg: "tba-webhook-verification", verificationKey: data.data.verification_key }));
    return jsonResponse({ accepted: false });
  }

  if (messageType === "ping") {
    console.log(JSON.stringify({ msg: "tba-webhook-ping" }));
    return jsonResponse({ accepted: false });
  }

  if (ACTED_ON_TYPES.has(messageType)) {
    const data = EventKeyDataSchema.safeParse(envelope.data.message_data);
    if (!data.success) return rejected(400, "Bad request", "event_key");
    const eventKey = data.data.event_key;
    console.log(JSON.stringify({ msg: "tba-webhook-accepted", messageType, eventKey }));
    // Not awaited: the answer goes back now, and the tick runs after it.
    ctx.waitUntil(
      reportTick(
        deps.runTick(env, { onlyEventKeys: [eventKey], trigger: "webhook", deadlineMs: startedMs + WEBHOOK_TICK_DEADLINE_MS }),
        startedMs,
        { trigger: "webhook", eventKey },
        now
      )
    );
    return jsonResponse({ accepted: true });
  }

  console.log(JSON.stringify({ msg: "tba-webhook-ignored", messageType }));
  return jsonResponse({ accepted: false });
}
