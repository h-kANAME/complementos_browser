import assert from "node:assert/strict";
import test from "node:test";
import { assertSafeEndpoint, configFromEnv, parseEnv, parseModelJson, redactSecrets, resolveLlmConfig, temperatureFor } from "./llm.js";

test("parseEnv ignora comentarios y comillas", () => {
  const env = parseEnv("# nota\nLLM_API_KEY=\"abc\"\nLLM_PROVIDER=openai/gpt-4o-mini\n");
  assert.equal(env.LLM_API_KEY, "abc");
  assert.equal(env.LLM_PROVIDER, "openai/gpt-4o-mini");
});

test("configFromEnv separa el modelo del proveedor", () => {
  const config = configFromEnv({
    LLM_PROVIDER: "openai/gpt-4o-mini",
    LLM_API_KEY: "sk-test",
    LLM_BASE_URL: "https://api.openai.com/v1/",
  });
  assert.equal(config.model, "gpt-4o-mini");
  assert.equal(config.baseUrl, "https://api.openai.com/v1");
  assert.equal(config.apiKey, "sk-test");
});

test("gpt-6 no envía temperature y gpt-4o-mini sigue en 0.1", () => {
  assert.equal(temperatureFor("gpt-6.1-sol"), undefined);
  assert.equal(temperatureFor("gpt-4o-mini"), 0.1);
});

test("el paquete publicado ignora la clave del .env", () => {
  const unpacked = resolveLlmConfig(null, "LLM_API_KEY=sk-local\nLLM_BASE_URL=https://api.openai.com/v1\n", {
    packaged: false,
  });
  assert.equal(unpacked.source, "desarrollo");
  assert.equal(unpacked.apiKey, "sk-local");

  const published = resolveLlmConfig(null, "LLM_API_KEY=sk-local\nLLM_BASE_URL=https://api.openai.com/v1\n", {
    packaged: true,
  });
  assert.equal(published.source, "ninguna");
  assert.equal(published.apiKey, "");

  const stored = resolveLlmConfig(
    { apiKey: "sk-browser", baseUrl: "https://api.openai.com/v1" },
    "LLM_API_KEY=sk-local\n",
    { packaged: false },
  );
  assert.equal(stored.source, "navegador");
  assert.equal(stored.apiKey, "sk-browser");
});

test("la clave no sale por http ni vuelve en un error", () => {
  assert.throws(() => assertSafeEndpoint("http://example.com/v1"), /https/);
  assert.doesNotThrow(() => assertSafeEndpoint("https://api.openai.com/v1"));
  assert.doesNotThrow(() => assertSafeEndpoint("http://127.0.0.1:11434/v1"));
  assert.equal(redactSecrets("bad sk-proj-secret Bearer abc.def"), "bad sk-… Bearer …");
});

test("parseModelJson acepta una cerca markdown", () => {
  const parsed = parseModelJson('```json\n{"title":"Login","palette":[]}\n```');
  assert.equal(parsed.title, "Login");
});
