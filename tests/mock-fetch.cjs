const fs = require("fs");

global.fetch = async (input, init = {}) => {
  const url = String(input);
  const entry = {
    url,
    method: init.method || "GET",
    headers: init.headers || {},
    body: init.body || null,
  };
  if (process.env.MOCK_FETCH_LOG) {
    fs.appendFileSync(process.env.MOCK_FETCH_LOG, JSON.stringify(entry) + "\n");
  }

  if (url.includes("services.leadconnectorhq.com")) {
    return new Response(JSON.stringify({ contact: { id: "contact-test" } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (url.includes("graph.facebook.com")) {
    const mode = process.env.MOCK_META_RESPONSE_MODE || "accepted";
    const bodies = {
      accepted: JSON.stringify({ events_received: 1, messages: [], fbtrace_id: "test" }),
      zero: JSON.stringify({ events_received: 0, messages: [], fbtrace_id: "test" }),
      missing: JSON.stringify({ messages: [], fbtrace_id: "test" }),
      nonnumeric: JSON.stringify({ events_received: "not-a-number", messages: [], fbtrace_id: "test" }),
      malformed: "not-json",
    };
    return new Response(bodies[mode] || bodies.accepted, {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ error: "unexpected test URL" }), {
    status: 500,
    headers: { "Content-Type": "application/json" },
  });
};
