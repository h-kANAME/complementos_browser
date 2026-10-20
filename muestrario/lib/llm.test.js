import assert from "node:assert/strict";
import test from "node:test";
import { configFromEnv, parseEnv, parseModelJson } from "./llm.js";

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

test("parseModelJson acepta una cerca markdown", () => {
  const parsed = parseModelJson('```json\n{"title":"Login","palette":[]}\n```');
  assert.equal(parsed.title, "Login");
});
