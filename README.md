# FLOW Yoga | Founding List Funnel

Production website for `findyourflow.com.au` and `www.findyourflow.com.au` (FLOW, infrared heated yoga, Coffs Harbour Jetty | Enlightspace Pty Ltd). The current homepage duplicates the proven campaign funnel as an independent foundation for the full website. Registration is at `/`, confirmation at `/thanks/`, and the privacy policy is at `/privacy`.

Built from the approved V4 mockup (`kaizen-artifacts/flow-register`, Dale + Hayley feedback rounds 1-5). The mockup with the V1-V4 toggle stays live at artifacts.kaizencollective.com.au/flow-register/ as the review sandbox.

## Architecture

Small Express app (Kaizen client-funnel pattern, like spine-health-funnel / scoop-booking):

- Static pages from `public/`
- `POST /api/register`: every lead appends to `data/leads.jsonl` (persistent volume) FIRST; pushed to the Kaizen CRM (GHL upsert) when env is configured
- `GET /api/stats`: secret-gated via `x-lighthouse-secret` header, returning the full Lighthouse funnel stats contract with recent leads, GHL outcomes, CAPI outcomes, and configuration health
- `GET /healthz`

## Env (set in Coolify, never in this public repo)

| Var | Purpose |
|---|---|
| `GHL_PIT` | Private Integration Token for the Kaizen agency (Flow location) |
| `GHL_LOCATION_ID` | `QbAVgTOKdJPrtPKzWxsu` (Flow Yoga in Kaizen GHL) |
| `GHL_FIELD_HEAT` | Optional override for Flow Finder Heat Preference field |
| `GHL_FIELD_LEVEL` | Optional override for Flow Finder Level Preference field |
| `GHL_FIELD_FLOW` | Optional override for Flow Finder Pace Preference field |
| `GHL_FIELD_PAGE` | Optional override for Flow Funnel Page field |
| `GHL_FIELD_UTM_SOURCE` | Optional override for Flow UTM Source field |
| `GHL_FIELD_UTM_MEDIUM` | Optional override for Flow UTM Medium field |
| `GHL_FIELD_UTM_CAMPAIGN` | Optional override for Flow UTM Campaign field |
| `GHL_FIELD_FBCLID` | Optional override for Flow Facebook Click ID field |
| `GHL_FIELD_FBC` | Optional override for Flow FBC field |
| `GHL_FIELD_FBP` | Optional override for Flow FBP field |
| `GHL_FIELD_CONSENT` | Optional override for Flow Marketing Consent field |
| `META_PIXEL_ID` | Meta Pixel `1041284571925635` (public; also hardcoded in the page). Env is an optional override for the CAPI side |
| `META_CAPI_TOKEN` | Conversions API access token (secret). When set, `/api/register` sends a server-side `Lead` deduplicated with the browser Pixel by `event_id` |
| `STATS_SECRET` | Header secret for `/api/stats` |
| `DATA_DIR` | Defaults to `./data`; Coolify persistent volume mounts `/app/data` |

Each ledger row records both `"ghl"` and `"capi"` push status plus the shared `event_id`. CAPI records `"sent"` only when Meta returns at least one accepted event. Leads captured before a credential is set carry `"not-configured"` for that channel; backfill if needed. The stats endpoint also understands legacy CAPI rows recorded as `"ok"`.

The stats reader parses JSONL rows independently. A malformed row is reported through `health.ledgerHealthy` and `health.ledgerErrors` without hiding valid leads. An unreadable ledger returns HTTP 500 so Lighthouse retains its last successful snapshot.

## Deploy

Coolify app on the Lighthouse droplet (170.64.153.122), manual deploy trigger (no GitHub webhook). Persistent volume at `/app/data` or a redeploy wipes the ledger.

## Tracking limitation

Flow records lead delivery and CAPI outcomes in its JSONL ledger. It does not yet record page visits, so Lighthouse visit and conversion metrics remain zero while opt-in and delivery metrics are live.
