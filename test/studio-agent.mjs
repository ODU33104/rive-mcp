import assert from "node:assert/strict";
import {
  askAgent,
  validateAgentEndpoint,
  estimateTokens,
} from "../dist/agentProviders.js";

const checkReject = (url) => {
  assert.throws(() => validateAgentEndpoint(url));
};

checkReject("file:///etc/passwd");
checkReject("ftp://example.com");
checkReject("https://user:pass@example.com");
checkReject("https://example.com/?token=secret");
checkReject("https://example.com/#secret");

assert.equal(
  validateAgentEndpoint("http://127.0.0.1:11434").insecure,
  false,
);
assert.equal(
  validateAgentEndpoint("http://example.com").insecure,
  true,
);
assert.ok(estimateTokens("test") > 0);

const originalFetch = globalThis.fetch;
const requests = [];

try {
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), options });
    if (String(url).endsWith("/v1/messages")) {
      return new Response(JSON.stringify({
        content: [{ type: "text", text: "response" }],
        usage: { input_tokens: 10, output_tokens: 5 },
      }), { status: 200 });
    }
    if (String(url).endsWith("/api/chat")) {
      return new Response(JSON.stringify({
        message: { role: "assistant", content: "response" },
        prompt_eval_count: 10,
        eval_count: 5,
      }), { status: 200 });
    }
    return new Response(JSON.stringify({
      choices: [{ message: { content: "response" } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    }), { status: 200 });
  };

  const cases = [
    ["openai", "https://api.openai.com/v1", "/chat/completions"],
    ["anthropic", "https://api.anthropic.com", "/v1/messages"],
    ["ollama", "http://127.0.0.1:11434", "/api/chat"],
  ];

  for (const [provider, endpoint, suffix] of cases) {
    const result = await askAgent({
      provider,
      endpoint,
      model: "test-model",
      apiKey: "test-key",
    }, [
      { role: "user", content: "hello" },
    ], { artboards: [] });

    assert.equal(result.text, "response");
    assert.equal(result.usage.inputTokens, 10);
    assert.equal(result.usage.outputTokens, 5);
    assert.equal(result.usage.estimated, false);

    const request = requests.at(-1);
    assert.ok(request.url.endsWith(suffix));
    assert.equal(request.options.redirect, "manual");
    assert.equal(request.options.method, "POST");
    assert.ok(!request.url.includes("test-key"));
  }

  globalThis.fetch = async () => new Response("", {
    status: 302,
    headers: { Location: "http://127.0.0.1:9999" },
  });
  await assert.rejects(
    askAgent({
      provider: "ollama",
      endpoint: "http://127.0.0.1:11434",
      model: "test-model",
      apiKey: "",
    }, [{ role: "user", content: "hello" }], {}),
    (error) => error.code === "provider_redirect_blocked",
  );
} finally {
  globalThis.fetch = originalFetch;
}

console.log("ALL PASS");
