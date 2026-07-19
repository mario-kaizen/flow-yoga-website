const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { once } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const FETCH_MOCK = path.join(__dirname, "mock-fetch.cjs");
let nextPort = 45000 + (process.pid % 10000);

async function waitForHealth(baseUrl, child, output) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`server exited before health check: ${output.join("")}`);
    }
    try {
      const response = await fetch(`${baseUrl}/healthz`);
      if (response.ok) return;
    } catch (_error) {
      // The child may still be binding its port.
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`server did not become healthy: ${output.join("")}`);
}

async function startServer(t, { rows = [], rawLedger = null, metaResponseMode = "accepted" } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "flow-stats-test-"));
  const ledger = path.join(dataDir, "leads.jsonl");
  const fetchLog = path.join(dataDir, "fetch.jsonl");
  if (rawLedger != null) {
    fs.writeFileSync(ledger, rawLedger);
  } else if (rows.length) {
    fs.writeFileSync(ledger, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
  }

  const port = nextPort++;
  const output = [];
  const child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      DATA_DIR: dataDir,
      STATS_SECRET: "stats-test-secret",
      GHL_PIT: "ghl-test-token",
      GHL_LOCATION_ID: "flow-test-location",
      META_PIXEL_ID: "1041284571925635",
      META_CAPI_TOKEN: "meta-test-token",
      MOCK_META_RESPONSE_MODE: metaResponseMode,
      MOCK_FETCH_LOG: fetchLog,
      NODE_OPTIONS: `${process.env.NODE_OPTIONS || ""} --require ${FETCH_MOCK}`.trim(),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => output.push(chunk.toString()));
  child.stderr.on("data", (chunk) => output.push(chunk.toString()));
  t.after(async () => {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await once(child, "exit");
    }
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForHealth(baseUrl, child, output);
  return { baseUrl, ledger, fetchLog };
}

test("stats endpoint returns Flow leads, delivery outcomes, and health in the Lighthouse contract", async (t) => {
  const rows = [
    {
      ts: "2026-07-18T10:00:00.000Z",
      name: "First Lead",
      email: "first@example.com",
      phone: "+61400000001",
      ghl: "ok",
      capi: "ok",
      fbc: "fb.1.abc",
      fbp: "fb.1.def",
    },
    {
      ts: "2026-07-18T11:00:00.000Z",
      name: "Second Lead",
      email: "second@example.com",
      phone: "+61400000002",
      ghl: "failed-500",
      capi: "failed-400",
      fbc: "",
      fbp: "fb.1.ghi",
    },
  ];
  const { baseUrl } = await startServer(t, { rows });

  const response = await fetch(`${baseUrl}/api/stats`, {
    headers: { "x-lighthouse-secret": "stats-test-secret" },
  });
  assert.equal(response.status, 200);
  const stats = await response.json();

  for (const key of ["funnel", "health", "visits", "optIns", "capi", "conversion", "recentVisits", "recentLeads"]) {
    assert.ok(key in stats, `expected stats.${key}`);
  }
  assert.equal(stats.funnel.slug, "flow-yoga");
  assert.equal(stats.optIns.total, 2);
  assert.equal(stats.optIns.synced, 1);
  assert.equal(stats.optIns.failed, 1);
  assert.equal(stats.capi.fired, 1);
  assert.equal(stats.capi.failed, 1);
  assert.equal(stats.health.capiConfigured, true);
  assert.equal(stats.health.ghlConfigured, true);
  assert.equal(stats.recentLeads.length, 2);
  assert.equal(stats.recentLeads[0].email, "second@example.com");
  assert.equal(stats.recentLeads[1].capiStatus, "sent");
});

test("stats endpoint keeps valid leads visible when one ledger line is malformed", async (t) => {
  const validLead = {
    ts: "2026-07-18T10:00:00.000Z",
    name: "Visible Lead",
    email: "visible@example.com",
    ghl: "ok",
    capi: "ok",
  };
  const rawLedger = `${JSON.stringify(validLead)}\n{malformed-json\n`;
  const { baseUrl } = await startServer(t, { rawLedger });

  const response = await fetch(`${baseUrl}/api/stats`, {
    headers: { "x-lighthouse-secret": "stats-test-secret" },
  });
  assert.equal(response.status, 200);
  const stats = await response.json();
  assert.equal(stats.optIns.total, 1);
  assert.equal(stats.recentLeads[0].email, "visible@example.com");
  assert.equal(stats.health.ledgerHealthy, false);
  assert.equal(stats.health.ledgerErrors, 1);
});

test("register sends a deduplicated Lead to Meta CAPI and records Meta acceptance", async (t) => {
  const { baseUrl, ledger, fetchLog } = await startServer(t);
  const eventId = "flow-test-event-123";
  const response = await fetch(`${baseUrl}/api/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "Flow test browser" },
    body: JSON.stringify({
      name: "CAPI Test",
      email: "capi@example.com",
      phone: "+61 400 000 003",
      event_id: eventId,
      page: "https://join.findyourflow.com.au/?utm_source=meta",
      fbc: "fb.1.capi",
      fbp: "fb.1.browser",
      consent: true,
    }),
  });
  assert.equal(response.status, 200);

  const calls = fs.readFileSync(fetchLog, "utf8").trim().split("\n").map(JSON.parse);
  const capiCall = calls.find((call) => call.url.includes("graph.facebook.com"));
  assert.ok(capiCall, "expected a Meta CAPI request");
  const payload = JSON.parse(capiCall.body);
  assert.equal(payload.data[0].event_name, "Lead");
  assert.equal(payload.data[0].event_id, eventId);
  assert.equal(payload.data[0].action_source, "website");
  assert.equal(payload.data[0].user_data.em[0], crypto.createHash("sha256").update("capi@example.com").digest("hex"));
  assert.equal(JSON.stringify(payload).includes("capi@example.com"), false);

  const lead = JSON.parse(fs.readFileSync(ledger, "utf8").trim());
  assert.equal(lead.event_id, eventId);
  assert.equal(lead.ghl, "ok");
  assert.equal(lead.capi, "sent");
});

test("register rejects ambiguous HTTP 200 responses as CAPI delivery failures", async (t) => {
  for (const metaResponseMode of ["zero", "missing", "nonnumeric", "malformed"]) {
    await t.test(metaResponseMode, async (subtest) => {
      const { baseUrl, ledger } = await startServer(subtest, { metaResponseMode });
      const response = await fetch(`${baseUrl}/api/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "CAPI Failure Test",
          email: `${metaResponseMode}@example.com`,
          event_id: `flow-${metaResponseMode}`,
          page: "https://join.findyourflow.com.au/",
        }),
      });
      assert.equal(response.status, 200);
      const lead = JSON.parse(fs.readFileSync(ledger, "utf8").trim());
      assert.equal(lead.capi, "failed-response");
    });
  }
});

test("privacy page publishes Flow's actual collection and disclosure practices", async (t) => {
  const { baseUrl } = await startServer(t);
  const response = await fetch(`${baseUrl}/privacy`);

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /^text\/html/);

  const html = await response.text();
  for (const requiredText of [
    "Privacy Policy",
    "Enlightspace Pty Ltd",
    "dale@theverse.com.au",
    "Meta Pixel",
    "Conversions API",
    "LeadConnector",
    "19 July 2026",
  ]) {
    assert.ok(html.includes(requiredText), `expected privacy page to include ${requiredText}`);
  }
});

test("public page footers link to the privacy policy", async (t) => {
  const { baseUrl } = await startServer(t);

  for (const route of ["/", "/thanks/"]) {
    const response = await fetch(`${baseUrl}${route}`);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /<footer>[\s\S]*href="\/privacy"[\s\S]*Privacy Policy[\s\S]*<\/footer>/);
  }
});
