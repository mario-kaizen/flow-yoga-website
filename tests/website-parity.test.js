const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), "utf8");

test("the website has an independent identity and canonical root domain", () => {
  const packageJson = JSON.parse(read("package.json"));
  const landing = read("public/index.html");

  assert.equal(packageJson.name, "flow-yoga-website");
  assert.match(packageJson.description, /findyourflow\.com\.au/);
  assert.match(landing, /<link rel="canonical" href="https:\/\/findyourflow\.com\.au\/">/);
  assert.doesNotMatch(landing, /canonical[^>]+join\.findyourflow\.com\.au/);
});

test("the website preserves the browser Pixel and form attribution contract", () => {
  const landing = read("public/index.html");

  for (const required of [
    "1041284571925635",
    "fbq('track','PageView')",
    "fetch('/api/register'",
    "event_id:eventId",
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "fbclid",
    "fbc:ck('_fbc')",
    "fbp:ck('_fbp')",
    "page:location.href",
    "consent:document.getElementById('cons').checked",
    "fbq('track','Lead',{},{eventID:eventId})",
  ]) {
    assert.ok(landing.includes(required), `expected landing page to preserve ${required}`);
  }
});

test("the website preserves GHL, CAPI, ledger and stats behaviour", () => {
  const server = read("server.js");

  for (const required of [
    "https://services.leadconnectorhq.com/contacts/upsert",
    'source: "Founding List | findyourflow.com.au"',
    'tags: ["founding-list", "flow-funnel"]',
    "https://graph.facebook.com/v21.0/",
    'event_name: "Lead"',
    "event_id: eventId",
    'action_source: "website"',
    'event_source_url: lead.page || "https://findyourflow.com.au/"',
    "client_user_agent",
    "client_ip_address",
    "user_data.em",
    "user_data.ph",
    "user_data.fbc",
    "user_data.fbp",
    "fs.appendFileSync(LEDGER",
    'app.get("/api/stats"',
  ]) {
    assert.ok(server.includes(required), `expected server to preserve ${required}`);
  }
});

test("the website preserves the thank you and privacy routes", () => {
  const thanks = read("public/thanks/index.html");
  const privacy = read("public/privacy.html");

  assert.match(thanks, /href="\/privacy"[^>]*>Privacy Policy<\/a>/);
  assert.match(privacy, /Privacy Policy/);
  assert.match(privacy, /dale@theverse\.com\.au/);
  assert.match(privacy, /Meta Pixel/);
  assert.match(privacy, /Conversions API/);
});
