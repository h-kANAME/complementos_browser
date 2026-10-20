export function parseEnv(text) {
  const values = {};
  for (const line of String(text || "").split(/\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

export function configFromEnv(env) {
  const provider = env.LLM_PROVIDER || "openai/gpt-4o-mini";
  const model = provider.includes("/") ? provider.split("/").slice(1).join("/") : provider;
  return {
    provider,
    model,
    apiKey: env.LLM_API_KEY || "",
    baseUrl: (env.LLM_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, ""),
  };
}

export async function loadLlmConfig() {
  const response = await fetch(chrome.runtime.getURL(".env"));
  if (!response.ok) {
    throw new Error("No encuentro muestrario/.env. Copiá .env.example y recargá el complemento.");
  }
  return configFromEnv(parseEnv(await response.text()));
}

export function compactCapture(capture) {
  return {
    url: capture.url || "",
    title: capture.title || "",
    colors: (capture.cssColors || []).slice(0, 40).map((color) => ({
      hex: color.hex,
      roles: color.roles || [],
      count: color.count || 0,
      where: (color.samples || []).slice(0, 3).map((sample) =>
        typeof sample === "string"
          ? { selector: sample, label: "", role: "" }
          : {
              label: sample.label || "",
              role: sample.role || "",
              selector: sample.selector || "",
            },
      ),
    })),
    pixelColors: (capture.pixelColors || []).slice(0, 8).map((color) => ({
      hex: color.hex,
      share: color.share || 0,
    })),
  };
}

export function parseModelJson(text) {
  const stripped = String(text || "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  try {
    return JSON.parse(stripped);
  } catch {
    const start = stripped.indexOf("{");
    const end = stripped.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(stripped.slice(start, end + 1));
    throw new Error("El modelo no devolvió JSON.");
  }
}

function systemPrompt() {
  return [
    "Normalizá una captura visual de una página web.",
    "No inventes colores ni elementos que no estén en la entrada.",
    "Conservá cada hex tal como viene.",
    "Agrupá las referencias de un mismo hex.",
    "Escribí el markdown en español, con un título, un resumen breve y la paleta.",
    "Respondé solo con un JSON de esta forma:",
    '{"title":"","summary":"","markdown":"","palette":[{"hex":"","roles":[],"count":0,"appearsIn":["Login · fondo · button.login"]}]}',
  ].join(" ");
}

export async function normalizeCapture(config, capture) {
  const local = /localhost|127\.0\.0\.1/.test(config.baseUrl);
  if (!config.apiKey && !local) {
    throw new Error("Falta LLM_API_KEY en muestrario/.env. Completala y recargá el complemento.");
  }
  const headers = { "Content-Type": "application/json" };
  if (config.apiKey) headers.Authorization = "Bearer " + config.apiKey;
  const response = await fetch(config.baseUrl + "/chat/completions", {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: config.model,
      temperature: 0.1,
      messages: [
        { role: "system", content: systemPrompt() },
        { role: "user", content: JSON.stringify(compactCapture(capture)) },
      ],
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload.error && payload.error.message ? payload.error.message : "El modelo rechazó el pedido.";
    throw new Error(message);
  }
  const content = payload.choices && payload.choices[0] && payload.choices[0].message
    ? payload.choices[0].message.content
    : "";
  const normalized = parseModelJson(content);
  if (!normalized.markdown) {
    normalized.markdown = markdownFromNormalized(normalized, capture);
  }
  return normalized;
}

export function markdownFromNormalized(normalized, capture) {
  const lines = ["# " + (normalized.title || capture.title || "Captura"), ""];
  if (normalized.summary) lines.push(normalized.summary, "");
  if (capture.url) lines.push(capture.url, "");
  lines.push("## Paleta", "");
  for (const color of normalized.palette || []) {
    const roles = (color.roles || []).join(", ");
    lines.push("- " + color.hex + (roles ? " (" + roles + ")" : ""));
    for (const place of color.appearsIn || []) lines.push("  - " + place);
  }
  return lines.join("\n");
}
