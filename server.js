// FLOW Yoga website | findyourflow.com.au
// Static pages + lead capture. Leads always land in the JSONL ledger first;
// GHL push happens on top when GHL_PIT + GHL_LOCATION_ID are configured.
const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const LEDGER = path.join(DATA_DIR, "leads.jsonl");
const FLOW_FIELD_IDS = {
  heat: process.env.GHL_FIELD_HEAT || "5cfR28VQe7ZV0R3IbxSJ",
  level: process.env.GHL_FIELD_LEVEL || "iJUcb32VwQOuNXCp0AK4",
  flow: process.env.GHL_FIELD_FLOW || "GXjhg0Jh3tqwr6t0RjJB",
  page: process.env.GHL_FIELD_PAGE || "ELyjCRnre3sBJg5LN5IA",
  utm_source: process.env.GHL_FIELD_UTM_SOURCE || "PO8orhrD6coQDTCwmt8W",
  utm_medium: process.env.GHL_FIELD_UTM_MEDIUM || "cXmOT46eIarfQBkcissZ",
  utm_campaign: process.env.GHL_FIELD_UTM_CAMPAIGN || "raZ2ou6N4UISnCOcpuRZ",
  fbclid: process.env.GHL_FIELD_FBCLID || "lmFkU1OjxuRtpz6tD8W3",
  fbc: process.env.GHL_FIELD_FBC || "cjpM9f2l4A6dJqWJsliX",
  fbp: process.env.GHL_FIELD_FBP || "januS1dVdy8exa9QMfpw",
  consent: process.env.GHL_FIELD_CONSENT || "E4SSCP3ljV7kLvYBfvDd",
};
const FIELD_LABELS = {
  heat: { high: "High heat", med: "Medium heat", low: "Low heat" },
  level: { "1": "Advanced", "2": "Intermediate", "3": "Foundation" },
  flow: { a: "Dynamic", b: "Slow", c: "Mellow" },
};

// Meta Pixel + Conversions API. Pixel id is public (also hardcoded in the page);
// the CAPI token is a secret and only ever comes from the environment.
const META_PIXEL_ID = process.env.META_PIXEL_ID || "1041284571925635";
const META_CAPI_TOKEN = process.env.META_CAPI_TOKEN;
const FUNNEL_META = {
  slug: "flow-yoga",
  name: "Flow Yoga",
  host: "findyourflow.com.au",
  pixelId: META_PIXEL_ID,
  ghlLocationId: process.env.GHL_LOCATION_ID || "QbAVgTOKdJPrtPKzWxsu",
};

fs.mkdirSync(DATA_DIR, { recursive: true });

app.use(express.json({ limit: "32kb" }));
app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"] }));

app.get("/healthz", (_req, res) => res.json({ ok: true }));

app.post("/api/register", async (req, res) => {
  const b = req.body || {};
  if (b.hp) return res.json({ ok: true }); // honeypot: swallow silently
  const email = String(b.email || "").trim().toLowerCase();
  const name = String(b.name || "").trim();
  const phone = String(b.phone || "").trim();
  if (!email || !email.includes("@") || !name) {
    return res.status(400).json({ ok: false, error: "name and email required" });
  }

  const lead = {
    ts: new Date().toISOString(),
    name,
    email,
    phone,
    consent: !!b.consent,
    heat: String(b.heat || ""),
    level: String(b.level || ""),
    flow: String(b.flow || ""),
    utm_source: String(b.utm_source || ""),
    utm_medium: String(b.utm_medium || ""),
    utm_campaign: String(b.utm_campaign || ""),
    fbclid: String(b.fbclid || ""),
    fbc: String(b.fbc || ""),
    fbp: String(b.fbp || ""),
    page: String(b.page || ""),
    ip: req.headers["x-forwarded-for"] || req.socket.remoteAddress || "",
    ua: req.headers["user-agent"] || "",
  };

  // Shared event id lets the browser Pixel and this server-side CAPI event
  // deduplicate into one Lead in Meta. The page sends its id; fall back if absent.
  const eventId = String(b.event_id || "").trim() || crypto.randomUUID();
  lead.event_id = eventId;

  const [ghlResult, capiResult] = await Promise.all([
    pushToGhl(lead),
    pushToMetaCapi(lead, eventId),
  ]);
  lead.ghl = ghlResult;
  lead.capi = capiResult;
  fs.appendFileSync(LEDGER, JSON.stringify(lead) + "\n");
  res.json({ ok: true });
});

async function pushToGhl(lead) {
  const pit = process.env.GHL_PIT;
  const locationId = process.env.GHL_LOCATION_ID;
  if (!pit || !locationId) return "not-configured";
  try {
    const r = await fetch("https://services.leadconnectorhq.com/contacts/upsert", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${pit}`,
        Version: "2021-07-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        locationId,
        name: lead.name,
        email: lead.email,
        phone: lead.phone || undefined,
        source: "Founding List | findyourflow.com.au",
        tags: ["founding-list", "flow-funnel"],
        customFields: customFieldsForGhl(lead),
      }),
      signal: AbortSignal.timeout(6000),
    });
    if (!r.ok) {
      console.error("GHL upsert failed", r.status, (await r.text()).slice(0, 300));
      return `failed-${r.status}`;
    }
    return "ok";
  } catch (err) {
    console.error("GHL upsert error", err.message);
    return "error";
  }
}

// Server-side Lead via the Meta Conversions API. Mirrors the browser Pixel's
// Lead using the same event_id so Meta counts one, not two. Never throws into
// the request path: a CAPI hiccup must not cost us the lead.
async function pushToMetaCapi(lead, eventId) {
  if (!META_CAPI_TOKEN || !META_PIXEL_ID) return "not-configured";
  const sha = (v) => crypto.createHash("sha256").update(String(v).trim().toLowerCase()).digest("hex");
  const user_data = {};
  if (lead.ua) user_data.client_user_agent = lead.ua;
  if (lead.email) user_data.em = [sha(lead.email)];
  if (lead.phone) user_data.ph = [sha(String(lead.phone).replace(/[^\d]/g, ""))];
  if (lead.fbc) user_data.fbc = lead.fbc;
  if (lead.fbp) user_data.fbp = lead.fbp;
  const ip = String(lead.ip || "").split(",")[0].trim();
  if (ip) user_data.client_ip_address = ip;

  const payload = {
    data: [
      {
        event_name: "Lead",
        event_time: Math.floor(Date.now() / 1000),
        event_id: eventId,
        action_source: "website",
        event_source_url: lead.page || "https://findyourflow.com.au/",
        user_data,
      },
    ],
  };

  try {
    const r = await fetch(
      `https://graph.facebook.com/v21.0/${META_PIXEL_ID}/events?access_token=${META_CAPI_TOKEN}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(6000),
      }
    );
    if (!r.ok) {
      console.error("Meta CAPI failed", r.status, (await r.text()).slice(0, 300));
      return `failed-${r.status}`;
    }
    const result = await r.json().catch(() => ({}));
    const accepted = Number(result.events_received);
    if (!Number.isFinite(accepted) || accepted < 1) {
      console.error("Meta CAPI returned no accepted events", JSON.stringify(result).slice(0, 300));
      return "failed-response";
    }
    return "sent";
  } catch (err) {
    console.error("Meta CAPI error", err.message);
    return "error";
  }
}

function customFieldsForGhl(lead) {
  const values = {
    heat: FIELD_LABELS.heat[lead.heat] || lead.heat,
    level: FIELD_LABELS.level[lead.level] || lead.level,
    flow: FIELD_LABELS.flow[lead.flow] || lead.flow,
    page: lead.page,
    utm_source: lead.utm_source,
    utm_medium: lead.utm_medium,
    utm_campaign: lead.utm_campaign,
    fbclid: lead.fbclid,
    fbc: lead.fbc,
    fbp: lead.fbp,
    consent: lead.consent ? "Yes" : "No",
  };
  return Object.entries(values)
    .filter(([key, value]) => FLOW_FIELD_IDS[key] && value)
    .map(([key, value]) => ({ id: FLOW_FIELD_IDS[key], value }));
}

function pct(numerator, denominator) {
  return denominator ? +((numerator / denominator) * 100).toFixed(1) : 0;
}

function ghlClass(status) {
  if (["ok", "created", "duplicate", "synced"].includes(status)) return "synced";
  if (status == null || status === "pending" || status === "not-configured") return "pending";
  return "failed";
}

function capiClass(status) {
  if (status === "ok" || status === "sent") return "sent";
  if (status == null || status === "not-configured" || status === "skipped") return "skipped";
  return "error";
}

function buildStats(rows, ledgerErrors = 0) {
  const leads = [...rows].reverse();
  const synced = leads.filter((lead) => ghlClass(lead.ghl) === "synced").length;
  const failed = leads.filter((lead) => ghlClass(lead.ghl) === "failed").length;
  const pending = leads.filter((lead) => ghlClass(lead.ghl) === "pending").length;
  const withFbc = leads.filter((lead) => lead.fbc).length;
  const capiFired = leads.filter((lead) => capiClass(lead.capi) === "sent").length;
  const capiFailed = leads.filter((lead) => capiClass(lead.capi) === "error").length;
  const lastCapi = leads.find((lead) => lead.capi != null);

  return {
    funnel: FUNNEL_META,
    health: {
      capiConfigured: !!(META_PIXEL_ID && META_CAPI_TOKEN),
      ghlConfigured: !!(process.env.GHL_PIT && process.env.GHL_LOCATION_ID),
      lastCapiResult: lastCapi ? capiClass(lastCapi.capi) : "none",
      lastCapiAt: lastCapi ? lastCapi.ts || null : null,
      ledgerHealthy: ledgerErrors === 0,
      ledgerErrors,
    },
    visits: {
      total: 0,
      today: 0,
      week: 0,
      withFbcPct: 0,
      withFbpPct: 0,
      mobilePct: 0,
    },
    optIns: {
      total: leads.length,
      synced,
      failed,
      pending,
      withFbcPct: pct(withFbc, leads.length),
    },
    capi: {
      fired: capiFired,
      failed: capiFailed,
      firedPct: pct(capiFired, leads.length),
    },
    conversion: 0,
    recentVisits: [],
    recentLeads: leads.slice(0, 50).map((lead) => ({
      at: lead.ts || null,
      name: lead.name || null,
      email: lead.email || null,
      phone: lead.phone || null,
      ghlStatus: ghlClass(lead.ghl),
      capiStatus: capiClass(lead.capi),
      fbc: !!lead.fbc,
      fbp: !!lead.fbp,
    })),
  };
}

function readLedgerRows() {
  let contents;
  try {
    contents = fs.readFileSync(LEDGER, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") return { rows: [], errors: 0, fatal: false };
    console.error("Lead ledger read failed", error.message);
    return { rows: [], errors: 1, fatal: true };
  }

  const rows = [];
  let errors = 0;
  contents.split("\n").forEach((line, index) => {
    if (!line.trim()) return;
    try {
      rows.push(JSON.parse(line));
    } catch (_error) {
      errors += 1;
      console.error(`Lead ledger line ${index + 1} is invalid JSON`);
    }
  });
  return { rows, errors, fatal: false };
}

// Secret-gated stats for the Lighthouse registry (header auth only, never query param)
app.get("/api/stats", (req, res) => {
  const secret = process.env.STATS_SECRET;
  if (!secret || req.headers["x-lighthouse-secret"] !== secret) {
    return res.status(401).json({ ok: false });
  }
  const ledger = readLedgerRows();
  if (ledger.fatal) return res.status(500).json({ ok: false, error: "lead ledger unavailable" });
  res.json(buildStats(ledger.rows, ledger.errors));
});

app.listen(PORT, () => console.log(`flow-yoga-website listening on :${PORT}`));
