/**
 * Drives `handleTbaWebhook` with a stubbed `runTick` and a fake
 * `ExecutionContext` that collects every `waitUntil` promise (quick task
 * 261019-ooj). Every signature is made with node:crypto's `createHmac`, so the
 * expectations are independent of the handler's own WebCrypto code. Asserts
 * the status codes, that only a signed acted-on message starts a tick, that
 * the answer comes back before the tick ends, and that no log line ever
 * carries the secret or a sent `X-TBA-HMAC` value. Ends with two requests
 * through the real default export's `fetch`.
 */
import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleTbaWebhook, TBA_WEBHOOK_MAX_BODY_BYTES, TBA_WEBHOOK_PATH, WEBHOOK_TICK_DEADLINE_MS } from "../src/tbaWebhook.js";
import type { TbaWebhookDeps } from "../src/tbaWebhook.js";
import worker from "../src/scheduled.js";
import type { TickResult } from "../src/scheduled.js";
import type { Env } from "../src/env.js";

const SECRET = "test-webhook-secret-not-real";
const URL_BASE = "https://sigmascout-worker.example.workers.dev";
const NOW = 1_760_000_000_000;

function makeEnv(secret?: string): Env {
  return {
    DB: {} as unknown,
    ARTIFACTS: {} as unknown,
    TBA_API_KEY: "test-tba-key",
    TBA_BASE_URL: "https://tba.example.invalid/api/v3",
    ...(secret === undefined ? {} : { TBA_WEBHOOK_SECRET: secret }),
  } as Env;
}

interface FakeContext {
  readonly ctx: ExecutionContext;
  readonly promises: Promise<unknown>[];
}

function makeContext(): FakeContext {
  const promises: Promise<unknown>[] = [];
  const ctx = {
    waitUntil: (promise: Promise<unknown>) => {
      promises.push(promise);
    },
    passThroughOnException: () => undefined,
    props: {},
  } as unknown as ExecutionContext;
  return { ctx, promises };
}

function sign(body: string, secret: string = SECRET): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

/** Every HMAC header value a test sent, so the leak check can look for each. */
const sentHmacs: string[] = [];

function webhookRequest(body: string, options: { hmac?: string | null; method?: string; path?: string } = {}): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json; charset=utf-8", "X-TBA-Version": "1" };
  const hmac = options.hmac === undefined ? sign(body) : options.hmac;
  if (hmac !== null) {
    headers["X-TBA-HMAC"] = hmac;
    sentHmacs.push(hmac);
  }
  const method = options.method ?? "POST";
  return new Request(`${URL_BASE}${options.path ?? TBA_WEBHOOK_PATH}`, { method, headers, ...(method === "GET" ? {} : { body }) });
}

function message(messageType: string, messageData?: unknown): string {
  return JSON.stringify(messageData === undefined ? { message_type: messageType } : { message_type: messageType, message_data: messageData });
}

const STUB_RESULT = { eventsConsidered: 1, eventsAdvanced: 1 } as unknown as TickResult;

function makeDeps(runTick?: TbaWebhookDeps["runTick"]): TbaWebhookDeps & { runTick: ReturnType<typeof vi.fn> } {
  return { runTick: vi.fn(runTick ?? (async () => STUB_RESULT)), now: () => NOW };
}

interface Spies {
  readonly log: ReturnType<typeof vi.spyOn>;
  readonly warn: ReturnType<typeof vi.spyOn>;
  readonly error: ReturnType<typeof vi.spyOn>;
}

function spyConsole(): Spies {
  return {
    log: vi.spyOn(console, "log").mockImplementation(() => undefined),
    warn: vi.spyOn(console, "warn").mockImplementation(() => undefined),
    error: vi.spyOn(console, "error").mockImplementation(() => undefined),
  };
}

function parsedLines(spy: { mock: { calls: unknown[][] } }): Record<string, unknown>[] {
  return spy.mock.calls.map((call) => JSON.parse(String(call[0])) as Record<string, unknown>);
}

let lastSpies: Spies | undefined;

afterEach(() => {
  // The leak check runs on EVERY case: no log line may carry the secret or a
  // sent HMAC. Booleans only, so a failure never prints the value.
  if (lastSpies !== undefined) {
    const joined = [lastSpies.log, lastSpies.warn, lastSpies.error].flatMap((spy) => spy.mock.calls.flat().map(String)).join("\n");
    const leakedSecret = joined.includes(SECRET);
    const leakedHmac = sentHmacs.some((hmac) => hmac.length > 0 && joined.includes(hmac));
    lastSpies = undefined;
    sentHmacs.length = 0;
    vi.restoreAllMocks();
    expect(leakedSecret).toBe(false);
    expect(leakedHmac).toBe(false);
    return;
  }
  sentHmacs.length = 0;
  vi.restoreAllMocks();
});

function setup(): Spies {
  lastSpies = spyConsole();
  return lastSpies;
}

describe("handleTbaWebhook — routing and configuration", () => {
  it("a POST to another path is 404", async () => {
    setup();
    const deps = makeDeps();
    const response = await handleTbaWebhook(webhookRequest(message("ping"), { path: "/other" }), makeEnv(SECRET), makeContext().ctx, deps);
    expect(response.status).toBe(404);
    expect(deps.runTick).not.toHaveBeenCalled();
  });

  it("a GET to the webhook path is 405 with Allow: POST", async () => {
    setup();
    const deps = makeDeps();
    const response = await handleTbaWebhook(webhookRequest("", { method: "GET", hmac: null }), makeEnv(SECRET), makeContext().ctx, deps);
    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("POST");
    expect(deps.runTick).not.toHaveBeenCalled();
  });

  it.each([
    ["unset", undefined],
    ["empty", ""],
  ])("a secret that is %s answers 503 with one tba-webhook-secret-missing warn line", async (_name, secret) => {
    const spies = setup();
    const deps = makeDeps();
    const response = await handleTbaWebhook(webhookRequest(message("ping")), makeEnv(secret), makeContext().ctx, deps);
    expect(response.status).toBe(503);
    expect(parsedLines(spies.warn)).toEqual([{ msg: "tba-webhook-secret-missing" }]);
    expect(deps.runTick).not.toHaveBeenCalled();
  });
});

describe("handleTbaWebhook — the signature and the size cap", () => {
  it("a wrong X-TBA-HMAC is 401, warns reason hmac, and runs no tick", async () => {
    const spies = setup();
    const deps = makeDeps();
    const body = message("match_score", { event_key: "2026test" });
    const response = await handleTbaWebhook(webhookRequest(body, { hmac: sign(body, "a-different-secret") }), makeEnv(SECRET), makeContext().ctx, deps);
    expect(response.status).toBe(401);
    expect(parsedLines(spies.warn)).toEqual([{ msg: "tba-webhook-rejected", reason: "hmac" }]);
    expect(deps.runTick).not.toHaveBeenCalled();
  });

  it("a missing X-TBA-HMAC is 401, warns reason hmac, and runs no tick", async () => {
    const spies = setup();
    const deps = makeDeps();
    const response = await handleTbaWebhook(webhookRequest(message("match_score", { event_key: "2026test" }), { hmac: null }), makeEnv(SECRET), makeContext().ctx, deps);
    expect(response.status).toBe(401);
    expect(parsedLines(spies.warn)).toEqual([{ msg: "tba-webhook-rejected", reason: "hmac" }]);
    expect(deps.runTick).not.toHaveBeenCalled();
  });

  it("a body over the 1 MiB cap is 413, warns reason size, and runs no tick", async () => {
    const spies = setup();
    const deps = makeDeps();
    const body = message("match_score", { event_key: "2026test", pad: "x".repeat(TBA_WEBHOOK_MAX_BODY_BYTES) });
    const response = await handleTbaWebhook(webhookRequest(body), makeEnv(SECRET), makeContext().ctx, deps);
    expect(response.status).toBe(413);
    expect(parsedLines(spies.warn)).toEqual([{ msg: "tba-webhook-rejected", reason: "size" }]);
    expect(deps.runTick).not.toHaveBeenCalled();
  });
});

describe("handleTbaWebhook — messages that start no tick", () => {
  it("a signed ping is 200 and runs no tick", async () => {
    const spies = setup();
    const deps = makeDeps();
    const response = await handleTbaWebhook(webhookRequest(message("ping", { title: "Test", desc: "A ping" })), makeEnv(SECRET), makeContext().ctx, deps);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ accepted: false });
    expect(parsedLines(spies.log)).toEqual([{ msg: "tba-webhook-ping" }]);
    expect(deps.runTick).not.toHaveBeenCalled();
  });

  it("a signed verification is 200, logs its verification key once, and runs no tick", async () => {
    const spies = setup();
    const deps = makeDeps();
    const response = await handleTbaWebhook(webhookRequest(message("verification", { verification_key: "abc123" })), makeEnv(SECRET), makeContext().ctx, deps);
    expect(response.status).toBe(200);
    expect(parsedLines(spies.log)).toEqual([{ msg: "tba-webhook-verification", verificationKey: "abc123" }]);
    expect(deps.runTick).not.toHaveBeenCalled();
  });

  it("a signed upcoming_match is 200, logged as ignored, and runs no tick", async () => {
    const spies = setup();
    const deps = makeDeps();
    const { ctx, promises } = makeContext();
    const response = await handleTbaWebhook(webhookRequest(message("upcoming_match", { event_key: "2026test", match_key: "2026test_qm3" })), makeEnv(SECRET), ctx, deps);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ accepted: false });
    expect(parsedLines(spies.log)).toEqual([{ msg: "tba-webhook-ignored", messageType: "upcoming_match" }]);
    expect(deps.runTick).not.toHaveBeenCalled();
    expect(promises).toHaveLength(0);
  });

  it.each([
    ["a body that is not JSON", "not json at all", "malformed"],
    ["JSON without message_type", JSON.stringify({ message_data: { event_key: "2026test" } }), "malformed"],
    ["a match_score whose event_key is a team key", message("match_score", { event_key: "frc254" }), "event_key"],
    ["a match_score whose event_key has capitals", message("match_score", { event_key: "2026TEST" }), "event_key"],
    ["a match_score with no event_key", message("match_score", { match_key: "2026test_qm1" }), "event_key"],
  ])("%s is 400 and runs no tick", async (_name, body, reason) => {
    const spies = setup();
    const deps = makeDeps();
    const response = await handleTbaWebhook(webhookRequest(body), makeEnv(SECRET), makeContext().ctx, deps);
    expect(response.status).toBe(400);
    expect(parsedLines(spies.warn)).toEqual([{ msg: "tba-webhook-rejected", reason }]);
    expect(deps.runTick).not.toHaveBeenCalled();
  });
});

describe("handleTbaWebhook — messages that start a one-event tick", () => {
  it.each(["match_score", "schedule_updated", "alliance_selection"])("a signed %s is 200 accepted and runs one tick for the named event inside waitUntil", async (messageType) => {
    const spies = setup();
    const deps = makeDeps();
    const { ctx, promises } = makeContext();

    const response = await handleTbaWebhook(webhookRequest(message(messageType, { event_key: "2026test", event_name: "Test Event" })), makeEnv(SECRET), ctx, deps);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ accepted: true });
    expect(deps.runTick).toHaveBeenCalledTimes(1);
    expect(deps.runTick.mock.calls[0]![1]).toEqual({ onlyEventKeys: ["2026test"], trigger: "webhook", deadlineMs: NOW + WEBHOOK_TICK_DEADLINE_MS });
    expect(promises).toHaveLength(1);
    // The stub tick may already have logged its own line by now; it is checked below.
    expect(parsedLines(spies.log).filter((line) => line.msg !== "tick")).toEqual([{ msg: "tba-webhook-accepted", messageType, eventKey: "2026test" }]);

    await promises[0];
    const tickLines = parsedLines(spies.log).filter((line) => line.msg === "tick");
    expect(tickLines).toHaveLength(1);
    expect(tickLines[0]).toMatchObject({ msg: "tick", ok: true, trigger: "webhook", eventKey: "2026test" });
  });

  it("answers before the tick finishes", async () => {
    setup();
    let release: (result: TickResult) => void = () => undefined;
    const pending = new Promise<TickResult>((resolve) => {
      release = resolve;
    });
    const deps = makeDeps(() => pending);
    const { ctx, promises } = makeContext();
    let settled = false;

    const response = await handleTbaWebhook(webhookRequest(message("match_score", { event_key: "2026test" })), makeEnv(SECRET), ctx, deps);
    void promises[0]!.then(() => {
      settled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(response.status).toBe(200);
    expect(settled).toBe(false);

    release(STUB_RESULT);
    await promises[0];
    expect(settled).toBe(true);
  });

  it("a tick that rejects still answers 200; the waitUntil promise rejects and one error tick line is logged", async () => {
    const spies = setup();
    const deps = makeDeps(async () => {
      throw new Error("boom");
    });
    const { ctx, promises } = makeContext();

    const response = await handleTbaWebhook(webhookRequest(message("match_score", { event_key: "2026test" })), makeEnv(SECRET), ctx, deps);

    expect(response.status).toBe(200);
    await expect(promises[0]).rejects.toThrow("boom");
    const errors = parsedLines(spies.error);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ msg: "tick", ok: false, error: "boom", trigger: "webhook", eventKey: "2026test" });
  });
});

describe("the default export's fetch entry (quick task 261019-ooj)", () => {
  it("answers 404 off the webhook path and 200 to a signed ping, starting no tick", async () => {
    setup();
    const { ctx, promises } = makeContext();
    const fetchEntry = worker.fetch;

    const offPath = await fetchEntry(webhookRequest(message("ping"), { path: "/nope" }) as Parameters<typeof fetchEntry>[0], makeEnv(SECRET), ctx);
    const ping = await fetchEntry(webhookRequest(message("ping")) as Parameters<typeof fetchEntry>[0], makeEnv(SECRET), ctx);

    expect(offPath.status).toBe(404);
    expect(ping.status).toBe(200);
    expect(promises).toHaveLength(0);
  });
});
