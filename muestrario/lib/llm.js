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

export const LLM_STORAGE_KEY = "llmSettings";

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

export function assertSafeEndpoint(baseUrl) {
  let url;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error("La dirección del modelo no es válida.");
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol === "https:") return;
  if (url.protocol === "http:" && local) return;
  throw new Error("La clave solo se envía por https, o a localhost.");
}

export function redactSecrets(message) {
  return String(message || "")
    .replace(/sk-[A-Za-z0-9_-]{4,}/g, "sk-…")
    .replace(/Bearer\s+\S+/gi, "Bearer …");
}

export function isPackagedExtension() {
  try {
    return Boolean(chrome.runtime.getManifest().update_url);
  } catch {
    return false;
  }
}

export function resolveLlmConfig(stored, envText, options = {}) {
  const env = envText ? configFromEnv(parseEnv(envText)) : null;
  const saved = stored && typeof stored === "object" ? stored : null;
  const provider = (saved && saved.provider) || (env && env.provider) || "openai/gpt-4o-mini";
  const model = provider.includes("/") ? provider.split("/").slice(1).join("/") : provider;
  const baseUrl = ((saved && saved.baseUrl) || (env && env.baseUrl) || "https://api.openai.com/v1").replace(/\/$/, "");
  let apiKey = (saved && saved.apiKey) || "";
  let source = apiKey ? "navegador" : "ninguna";
  if (!apiKey && env && env.apiKey && !options.packaged) {
    apiKey = env.apiKey;
    source = "desarrollo";
  }
  assertSafeEndpoint(baseUrl);
  return { provider, model, apiKey, baseUrl, source };
}

export async function loadLlmConfig() {
  const stored = await chrome.storage.local.get(LLM_STORAGE_KEY);
  const packaged = isPackagedExtension();
  let envText = "";
  if (!packaged) {
    const response = await fetch(chrome.runtime.getURL(".env"));
    if (response.ok) envText = await response.text();
  }
  return resolveLlmConfig(stored[LLM_STORAGE_KEY], envText, { packaged });
}

function packSections(sections, budget) {
  const packed = [];
  let left = budget;
  for (const section of sections || []) {
    if (left <= 0) break;
    const markdown = String(section.markdown || "").slice(0, left);
    if (!markdown) continue;
    packed.push({ title: section.title || "Sección", markdown });
    left -= markdown.length;
  }
  return packed;
}

export function compactCapture(capture) {
  const sections = packSections(capture.sections, 18000);
  return {
    url: capture.url || "",
    title: capture.title || "",
    description: (capture.metadata && capture.metadata.description) || "",
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
    sections,
    markdown: sections.length ? "" : String(capture.markdown || "").slice(0, 18000),
    links: (capture.links || []).slice(0, 80),
    media: (capture.media || []).slice(0, 40),
    tables: (capture.tables || []).slice(0, 8),
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
    "Normalizá la extracción completa de una página.",
    "No inventes secciones, textos, links, medios, tablas ni colores que no estén en la entrada.",
    "Conservá cada hex tal como viene y agrupá las referencias de un mismo hex.",
    "El campo markdown tiene que incluir toda la extracción, en este orden:",
    "título, resumen breve, cada sección con su contenido limpio, links, medios, tablas y, si hay colores, la paleta.",
    "No omitas secciones presentes en la entrada y no las reemplaces por un resumen de una línea.",
    "Escribí en español.",
    "Respondé solo con un JSON de esta forma:",
    '{"title":"","summary":"","markdown":"","palette":[{"hex":"","roles":[],"count":0,"appearsIn":["Login · fondo · button.login"]}]}',
  ].join(" ");
}

export function temperatureFor(model) {
  const name = String(model || "").toLowerCase();
  if (/gpt-[5-9]|gpt-6|o\d/.test(name)) return undefined;
  return 0.1;
}

export async function normalizeCapture(config, capture) {
  const local = /localhost|127\.0\.0\.1/.test(config.baseUrl);
  assertSafeEndpoint(config.baseUrl);
  if (!config.apiKey && !local) {
    throw new Error("Falta la clave del modelo. Guardala en este navegador. El paquete publicado no incluye un .env.");
  }
  const headers = { "Content-Type": "application/json" };
  if (config.apiKey) headers.Authorization = "Bearer " + config.apiKey;
  const messages = [
    { role: "system", content: systemPrompt() },
    { role: "user", content: JSON.stringify(compactCapture(capture)) },
  ];

  async function complete(temperature) {
    const body = { model: config.model, messages };
    if (temperature !== undefined) body.temperature = temperature;
    const response = await fetch(config.baseUrl + "/chat/completions", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    const raw = payload.error && payload.error.message ? payload.error.message : "El modelo rechazó el pedido.";
    return { ok: response.ok, payload, message: redactSecrets(raw) };
  }

  let temperature = temperatureFor(config.model);
  let result = await complete(temperature);
  if (!result.ok && temperature !== undefined && /temperature/i.test(result.message)) {
    result = await complete(undefined);
  }
  if (!result.ok) throw new Error(result.message);
  const payload = result.payload;
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
  const sections = capture.sections || [];
  if (sections.length) {
    lines.push("## Contenido", "");
    for (const section of sections) {
      lines.push("### " + (section.title || "Sección"), "", section.markdown || "", "");
    }
  } else if (capture.markdown) {
    lines.push(capture.markdown, "");
  }
  if ((capture.links || []).length) {
    lines.push("## Links", "");
    for (const link of capture.links) {
      lines.push("- [" + (link.text || link.href) + "](" + link.href + ")");
    }
    lines.push("");
  }
  if ((capture.media || []).length) {
    lines.push("## Medios", "");
    for (const item of capture.media) {
      lines.push("- " + (item.alt || item.kind || "medio") + ": " + item.src);
    }
    lines.push("");
  }
  if ((capture.tables || []).length) {
    lines.push("## Tablas", "");
    for (const table of capture.tables) {
      if (table.caption) lines.push(table.caption, "");
      const headers = table.headers || [];
      const rows = table.rows || [];
      if (headers.length) {
        lines.push("| " + headers.join(" | ") + " |");
        lines.push("| " + headers.map(() => "---").join(" | ") + " |");
      }
      for (const row of rows) lines.push("| " + row.join(" | ") + " |");
      lines.push("");
    }
  }
  if ((normalized.palette || []).length) {
    lines.push("## Paleta", "");
    for (const color of normalized.palette) {
      const roles = (color.roles || []).join(", ");
      lines.push("- " + color.hex + (roles ? " (" + roles + ")" : ""));
      for (const place of color.appearsIn || []) lines.push("  - " + place);
    }
  }
  return lines.join("\n").trim();
}
