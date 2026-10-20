import { collectPageColors, highlightColor } from "../collectors/colors.js";
import { collectPageContent } from "../collectors/content.js";
import { LLM_STORAGE_KEY, loadLlmConfig, markdownFromNormalized, normalizeCapture, redactSecrets } from "../lib/llm.js";
import { quantizeImageData } from "../lib/quantize.js";

const STORAGE_KEY = "captures";
const OPTIONS_KEY = "options";
const MAX_CAPTURES = 30;
const VERSION = "0.3.7";

const captureButton = document.querySelector("#capture");
const statusNode = document.querySelector("#status");
const cssOption = document.querySelector("#opt-css");
const pixelOption = document.querySelector("#opt-pixels");
const markdownOption = document.querySelector("#opt-markdown");
const linksOption = document.querySelector("#opt-links");
const mediaOption = document.querySelector("#opt-media");
const tablesOption = document.querySelector("#opt-tables");
const view = document.querySelector("#view");
const historyNode = document.querySelector("#history");
const historyEmpty = document.querySelector("#history-empty");

let captures = [];
let selectedId = "";
let normalized = null;

function setStatus(message) {
  statusNode.textContent = message || "";
}

function rejectionReason(url) {
  if (!url) return "No hay una pestaña activa.";
  if (/^(chrome|chrome-extension|chrome-untrusted|edge|devtools|about|view-source|file|data|blob):/i.test(url)) {
    return "Esta página no permite que un complemento la lea.";
  }
  if (
    url.startsWith("https://chrome.google.com/webstore") ||
    url.startsWith("https://chromewebstore.google.com")
  ) {
    return "La tienda de Chrome no permite que un complemento la lea.";
  }
  return "";
}

function humanize(error) {
  const message = redactSecrets(error && error.message ? error.message : String(error));
  if (/cannot be scripted|cannot access|extensions gallery|Cannot access contents/i.test(message)) {
    return "Esta página no permite que un complemento la lea.";
  }
  if (/MAX_CAPTURE_VISIBLE_TAB|cannot be captured|activeTab/i.test(message)) {
    return "No se pudo capturar la imagen de esta pestaña.";
  }
  return message;
}

function hostname(url) {
  try {
    return new URL(url).hostname || url;
  } catch {
    return url || "";
  }
}

function formatWhen(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" });
}

function percent(share) {
  const value = Math.round((share || 0) * 100);
  return value < 1 ? "<1%" : value + "%";
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    document.body.append(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
  setStatus("Copiado " + text);
}

function download(filename, payload, type) {
  const body = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
  const blob = new Blob([body], { type: type || "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function exportPayload(items) {
  return {
    tool: "muestrario",
    version: VERSION,
    exportedAt: new Date().toISOString(),
    captures: items,
  };
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function quantizeDataUrl(dataUrl) {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);
  const maxWidth = 360;
  const scale = Math.min(1, maxWidth / bitmap.width);
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return quantizeImageData(context.getImageData(0, 0, width, height), {
    step: 4,
    maxColors: 8,
  });
}

function placesOf(color) {
  return (color.samples || []).map((sample) => {
    if (typeof sample === "string") {
      return { selector: sample, label: "", role: (color.roles && color.roles[0]) || "" };
    }
    return sample;
  });
}

function swatchButton(color, detail) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "swatch";
  button.title = "Copiar " + color.hex;
  const chip = document.createElement("span");
  chip.className = "chip";
  chip.style.background = color.hex;
  const hex = document.createElement("span");
  hex.className = "hex";
  hex.textContent = color.hex;
  const roles = document.createElement("span");
  roles.className = "roles";
  roles.textContent = detail;
  button.append(chip, hex, roles);
  button.addEventListener("click", () => copyText(color.hex));
  return button;
}

async function showOnPage(hex, role, label, selector) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const blocked = rejectionReason(tab && tab.url);
  if (blocked) {
    setStatus(blocked);
    return;
  }
  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: highlightColor,
      args: [hex, role || "", selector || "", label || ""],
    });
    const result = injection && injection.result;
    if (!result || result.error) throw new Error((result && result.error) || "No se pudo marcar la página.");
    const where = label ? " «" + label + "»" : "";
    setStatus(
      result.matched
        ? "Marcado" + where + " en la pestaña activa. El recuadro dura unos segundos."
        : "Ese color no está en la pestaña activa. Volvé a capturar esta pantalla.",
    );
  } catch (error) {
    setStatus(humanize(error));
  }
}

function colorReference(color) {
  const row = document.createElement("article");
  row.className = "ref";
  const chip = document.createElement("button");
  chip.type = "button";
  chip.className = "chip";
  chip.style.background = color.hex;
  chip.title = "Copiar " + color.hex;
  chip.addEventListener("click", () => copyText(color.hex));
  const body = document.createElement("div");
  body.className = "ref-body";
  const head = document.createElement("div");
  head.className = "ref-head";
  const hex = document.createElement("button");
  hex.type = "button";
  hex.className = "hex";
  hex.textContent = color.hex;
  hex.addEventListener("click", () => copyText(color.hex));
  const meta = document.createElement("span");
  meta.className = "roles";
  const roles = (color.roles || []).join(" · ");
  meta.textContent = roles + (color.count ? " · " + color.count : "");
  head.append(hex, meta);
  body.append(head);

  const places = placesOf(color).slice(0, 3);
  if (!places.length) {
    const empty = document.createElement("p");
    empty.className = "roles";
    empty.textContent = "Sin un elemento con texto corto.";
    body.append(empty);
  }
  for (const place of places) {
    const line = document.createElement("div");
    line.className = "place";
    const text = document.createElement("span");
    const name = document.createElement("strong");
    name.textContent = place.label || place.selector || "Elemento";
    text.append(name);
    if (place.label && place.selector) {
      const selector = document.createElement("code");
      selector.textContent = place.selector;
      text.append(selector);
    }
    if (place.role) {
      const role = document.createElement("em");
      role.textContent = place.role;
      text.append(role);
    }
    const see = document.createElement("button");
    see.type = "button";
    see.className = "kyz-btn kyz-btn--ghost kyz-btn--sm";
    see.textContent = "Ver";
    see.addEventListener("click", () => showOnPage(color.hex, place.role, place.label, place.selector));
    line.append(text, see);
    body.append(line);
  }

  row.append(chip, body);
  return row;
}

function renderNormalized(result, capture) {
  const preview = document.querySelector("#llm-preview");
  const vista = document.querySelector("#pane-vista");
  vista.replaceChildren();
  const title = document.createElement("h3");
  title.textContent = result.title || capture.title || "Captura";
  const summary = document.createElement("p");
  summary.textContent = result.summary || "";
  vista.append(title, summary);
  for (const color of result.palette || []) {
    const row = document.createElement("div");
    row.className = "norm-row";
    const dot = document.createElement("span");
    dot.className = "dot";
    dot.style.background = color.hex || "transparent";
    const text = document.createElement("div");
    const hex = document.createElement("strong");
    hex.textContent = color.hex || "";
    text.append(hex);
    for (const place of color.appearsIn || []) {
      const line = document.createElement("p");
      line.textContent = place;
      text.append(line);
    }
    row.append(dot, text);
    vista.append(row);
  }
  document.querySelector("#pane-markdown").textContent = result.markdown || markdownFromNormalized(result, capture);
  document.querySelector("#pane-json").textContent = JSON.stringify(result, null, 2);
  preview.hidden = false;
  showPane("vista");
}

function showPane(name) {
  for (const pane of ["vista", "markdown", "json"]) {
    document.querySelector("#pane-" + pane).hidden = pane !== name;
    const tab = document.querySelector("#tab-" + pane);
    tab.className = "kyz-btn kyz-btn--sm " + (pane === name ? "kyz-btn--subtle" : "kyz-btn--ghost");
  }
}

function documentFromNormalized(result, capture) {
  const fromModel = String((result && result.markdown) || "").trim();
  const source = String(capture.markdown || "").trim();
  const enough = source.length < 800 || fromModel.length >= Math.min(source.length, 18000) * 0.45;
  if (fromModel && enough) return fromModel;
  const fallback = markdownFromNormalized(result || {}, capture);
  if (!fromModel) return fallback;
  return fromModel + "\n\n" + fallback;
}

function renderCapture(capture) {
  normalized = null;
  const llm = document.querySelector("#llm");
  const llmStatus = document.querySelector("#llm-status");
  const normalizeDownload = document.querySelector("#normalize-download");
  document.querySelector("#llm-preview").hidden = true;
  if (llmStatus) llmStatus.textContent = "";
  if (!capture) {
    view.hidden = true;
    if (llm) llm.hidden = true;
    if (normalizeDownload) normalizeDownload.hidden = true;
    return;
  }
  view.hidden = false;
  if (llm) llm.hidden = false;
  if (normalizeDownload) normalizeDownload.hidden = false;
  document.querySelector("#page-title").textContent = capture.title || "Sin título";
  document.querySelector("#page-url").textContent = capture.url || "";
  const bits = [formatWhen(capture.createdAt), hostname(capture.url)];
  if (capture.scannedElements) bits.push(capture.scannedElements + " elementos");
  if (capture.truncated) bits.push("recorrido parcial");
  document.querySelector("#page-meta").textContent = bits.filter(Boolean).join(" · ");

  const cssBlock = document.querySelector("#css-block");
  const cssGrid = document.querySelector("#css-grid");
  cssGrid.replaceChildren();
  const cssColors = capture.cssColors || [];
  cssBlock.hidden = cssColors.length === 0;
  document.querySelector("#css-count").textContent = capture.totalColors
    ? cssColors.length + " de " + capture.totalColors
    : String(cssColors.length);
  for (const color of cssColors) cssGrid.append(colorReference(color));

  const varBlock = document.querySelector("#var-block");
  const varList = document.querySelector("#var-list");
  varList.replaceChildren();
  const variables = capture.variables || [];
  varBlock.hidden = variables.length === 0;
  for (const variable of variables) {
    const item = document.createElement("li");
    const dot = document.createElement("span");
    dot.className = "dot";
    dot.style.background = variable.hex;
    const name = document.createElement("span");
    name.className = "var-name";
    name.textContent = variable.name;
    const hex = document.createElement("button");
    hex.type = "button";
    hex.className = "kyz-btn kyz-btn--ghost kyz-btn--sm var-hex";
    hex.textContent = variable.hex;
    hex.addEventListener("click", () => copyText(variable.hex));
    item.append(dot, name, hex);
    varList.append(item);
  }

  const pixelBlock = document.querySelector("#pixel-block");
  const pixelGrid = document.querySelector("#pixel-grid");
  pixelGrid.replaceChildren();
  const pixelColors = capture.pixelColors || [];
  pixelBlock.hidden = pixelColors.length === 0;
  for (const color of pixelColors) {
    pixelGrid.append(swatchButton(color, percent(color.share)));
  }

  renderContent(capture);
}

function renderContent(capture) {
  const markdownBlock = document.querySelector("#markdown-block");
  const sectionList = document.querySelector("#section-list");
  sectionList.replaceChildren();
  const sections = capture.sections && capture.sections.length
    ? capture.sections
    : capture.markdown
      ? [{ title: capture.title || "Página", level: 1, markdown: capture.markdown }]
      : [];
  markdownBlock.hidden = sections.length === 0;
  document.querySelector("#markdown-count").textContent = String(sections.length);
  for (const section of sections) sectionList.append(sectionCard(section));

  const links = capture.links || [];
  const linksBlock = document.querySelector("#links-block");
  const linksList = document.querySelector("#links-list");
  linksList.replaceChildren();
  linksBlock.hidden = links.length === 0;
  document.querySelector("#links-count").textContent = String(links.length);
  for (const link of links) linksList.append(linkItem(link));

  const media = capture.media || [];
  const mediaBlock = document.querySelector("#media-block");
  const mediaList = document.querySelector("#media-list");
  mediaList.replaceChildren();
  mediaBlock.hidden = media.length === 0;
  document.querySelector("#media-count").textContent = String(media.length);
  for (const item of media) mediaList.append(mediaItem(item));

  const tables = capture.tables || [];
  const tablesBlock = document.querySelector("#tables-block");
  const tablesList = document.querySelector("#tables-list");
  tablesList.replaceChildren();
  tablesBlock.hidden = tables.length === 0;
  document.querySelector("#tables-count").textContent = String(tables.length);
  for (const table of tables) tablesList.append(tableCard(table));
}

function sectionCard(section) {
  const card = document.createElement("article");
  card.className = "table-card";
  const title = document.createElement("strong");
  title.textContent = section.title || "Sección";
  const body = document.createElement("pre");
  body.className = "llm-pane";
  body.textContent = section.markdown || "";
  card.append(title, body);
  return card;
}

function linkItem(link) {
  const item = document.createElement("li");
  const anchor = document.createElement("a");
  anchor.href = link.href;
  anchor.target = "_blank";
  anchor.rel = "noreferrer";
  anchor.textContent = link.text || link.href;
  const meta = document.createElement("small");
  meta.textContent = (link.kind || "") + " · " + link.href;
  item.append(anchor, meta);
  return item;
}

function mediaItem(item) {
  const row = document.createElement("li");
  const title = document.createElement("strong");
  title.textContent = item.alt || item.kind || "medio";
  const meta = document.createElement("small");
  meta.textContent = (item.kind || "") + " · " + item.src;
  row.append(title, meta);
  return row;
}

function tableCard(table) {
  const card = document.createElement("div");
  card.className = "table-card";
  if (table.caption) {
    const caption = document.createElement("p");
    caption.textContent = table.caption;
    card.append(caption);
  }
  const grid = document.createElement("table");
  grid.className = "mini-table";
  if (table.headers && table.headers.length) {
    const head = document.createElement("thead");
    const row = document.createElement("tr");
    for (const header of table.headers) {
      const cell = document.createElement("th");
      cell.textContent = header;
      row.append(cell);
    }
    head.append(row);
    grid.append(head);
  }
  const body = document.createElement("tbody");
  for (const values of table.rows || []) {
    const row = document.createElement("tr");
    for (const value of values) {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.append(cell);
    }
    body.append(row);
  }
  grid.append(body);
  card.append(grid);
  return card;
}

function palettePreview(capture) {
  const colors = [...(capture.cssColors || []), ...(capture.pixelColors || [])].slice(0, 4);
  const wrap = document.createElement("span");
  wrap.className = "mini";
  const source = colors.length ? colors : [{ hex: "#3c3428" }];
  for (const color of source) {
    const block = document.createElement("i");
    block.style.background = color.hex;
    wrap.append(block);
  }
  return wrap;
}

function renderHistory() {
  historyNode.replaceChildren();
  historyEmpty.hidden = captures.length > 0;
  document.querySelector("#export-all").disabled = captures.length === 0;
  document.querySelector("#clear-history").disabled = captures.length === 0;
  for (const capture of captures) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "history-item" + (capture.id === selectedId ? " active" : "");
    const text = document.createElement("span");
    const title = document.createElement("strong");
    title.textContent = capture.title || hostname(capture.url) || "Captura";
    const meta = document.createElement("small");
    meta.textContent = [formatWhen(capture.createdAt), hostname(capture.url)].filter(Boolean).join(" · ");
    text.append(title, meta);
    button.append(palettePreview(capture), text);
    button.addEventListener("click", () => {
      selectedId = capture.id;
      renderCapture(capture);
      renderHistory();
    });
    item.append(button);
    historyNode.append(item);
  }
}

async function persist(next) {
  captures = next.slice(0, MAX_CAPTURES);
  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: captures });
  } catch (error) {
    captures = captures.slice(0, Math.max(1, Math.floor(captures.length / 2)));
    await chrome.storage.local.set({ [STORAGE_KEY]: captures });
    setStatus(humanize(error));
  }
}

async function saveOptions() {
  await chrome.storage.local.set({
    [OPTIONS_KEY]: {
      css: cssOption.checked,
      pixels: pixelOption.checked,
      markdown: markdownOption.checked,
      links: linksOption.checked,
      media: mediaOption.checked,
      tables: tablesOption.checked,
    },
  });
}

function collectorState() {
  return {
    css: Boolean(document.querySelector("#opt-css") && document.querySelector("#opt-css").checked),
    pixels: Boolean(document.querySelector("#opt-pixels") && document.querySelector("#opt-pixels").checked),
    markdown: Boolean(document.querySelector("#opt-markdown") && document.querySelector("#opt-markdown").checked),
    links: Boolean(document.querySelector("#opt-links") && document.querySelector("#opt-links").checked),
    media: Boolean(document.querySelector("#opt-media") && document.querySelector("#opt-media").checked),
    tables: Boolean(document.querySelector("#opt-tables") && document.querySelector("#opt-tables").checked),
  };
}

async function captureActiveTab() {
  const opts = collectorState();
  const wantCss = opts.css;
  const wantPixels = opts.pixels;
  const wantContent = opts.markdown || opts.links || opts.media || opts.tables;
  if (!wantCss && !wantPixels && !wantContent) {
    setStatus("Marcá al menos un recolector: colores, markdown, links, medios o tablas.");
    return;
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const blocked = rejectionReason(tab && tab.url);
  if (blocked) {
    setStatus(blocked);
    return;
  }

  const normalizeDownload = document.querySelector("#normalize-download");
  captureButton.disabled = true;
  if (normalizeDownload) normalizeDownload.disabled = true;
  captureButton.textContent = "Capturando…";
  setStatus("");

  try {
    const cssPromise = wantCss
      ? chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: collectPageColors,
        })
      : Promise.resolve(null);
    const shotPromise = wantPixels
      ? chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" })
      : Promise.resolve(null);
    const contentPromise = wantContent
      ? chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: collectPageContent,
        })
      : Promise.resolve(null);
    const [cssSettled, shotSettled, contentSettled] = await Promise.allSettled([
      cssPromise,
      shotPromise,
      contentPromise,
    ]);

    let page = null;
    if (wantCss) {
      if (cssSettled.status === "rejected") throw cssSettled.reason;
      page = cssSettled.value && cssSettled.value[0] && cssSettled.value[0].result;
      if (!page) throw new Error("La página no devolvió colores.");
      if (page.error) throw new Error(page.error);
    }

    let pixelColors = [];
    if (wantPixels) {
      if (shotSettled.status === "rejected") throw shotSettled.reason;
      if (!shotSettled.value) throw new Error("No se pudo capturar la imagen de esta pestaña.");
      pixelColors = await quantizeDataUrl(shotSettled.value);
    }

    let content = null;
    if (wantContent) {
      if (contentSettled.status === "rejected") throw contentSettled.reason;
      content = contentSettled.value && contentSettled.value[0] && contentSettled.value[0].result;
      if (!content) throw new Error("La página no devolvió contenido.");
      if (content.error) throw new Error(content.error);
    }

    const capture = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      url: (content && content.url) || (page && page.url) || tab.url || "",
      title: (content && content.title) || (page && page.title) || tab.title || "",
      viewport: page && page.viewport,
      scannedElements: page && page.scannedElements,
      truncated: Boolean(page && page.truncated),
      totalColors: page && page.totalColors,
      cssColors: (page && page.colors) || [],
      variables: (page && page.variables) || [],
      pixelColors,
      metadata: wantContent ? content.metadata : null,
      sections: opts.markdown ? content.sections || [] : [],
      markdown: opts.markdown ? content.markdown : "",
      links: opts.links ? content.links : [],
      media: opts.media ? content.media : [],
      tables: opts.tables ? content.tables : [],
    };
    selectedId = capture.id;
    await persist([capture, ...captures]);
    renderCapture(capture);
    renderHistory();
    const parts = [];
    if (wantCss) parts.push((capture.cssColors || []).length + " colores de CSS");
    if (wantPixels) parts.push(pixelColors.length + " colores visibles");
    if (opts.markdown) parts.push((capture.sections || []).length + " secciones");
    if (opts.links) parts.push((capture.links || []).length + " links");
    if (opts.media) parts.push((capture.media || []).length + " medios");
    if (opts.tables) parts.push((capture.tables || []).length + " tablas");
    setStatus("Listo: " + parts.join(", ") + ".");
  } catch (error) {
    setStatus(humanize(error));
  } finally {
    captureButton.disabled = false;
    captureButton.textContent = "Capturar esta pantalla";
    if (normalizeDownload) normalizeDownload.disabled = false;
  }
}

async function runNormalize(downloadAfter) {
  const capture = captures.find((item) => item.id === selectedId);
  const previewButton = document.querySelector("#normalize");
  const downloadButton = document.querySelector("#normalize-download");
  const llmStatus = document.querySelector("#llm-status");
  if (!capture) return;
  previewButton.disabled = true;
  downloadButton.disabled = true;
  previewButton.textContent = "Normalizando…";
  downloadButton.textContent = "Normalizando…";
  if (llmStatus) llmStatus.textContent = "";
  setStatus("Normalizando la extracción…");
  try {
    const config = await loadLlmConfig();
    const result = await normalizeCapture(config, capture);
    result.markdown = documentFromNormalized(result, capture);
    normalized = result;
    renderNormalized(normalized, capture);
    if (downloadAfter) {
      download("muestrario-normalizado-" + stamp() + ".md", result.markdown, "text/markdown");
      setStatus("Descargué el markdown normalizado.");
      if (llmStatus) llmStatus.textContent = "Listo. El archivo ya se descargó.";
    } else {
      setStatus("");
      if (llmStatus) llmStatus.textContent = "Listo para revisar y descargar.";
    }
  } catch (error) {
    normalized = null;
    document.querySelector("#llm-preview").hidden = true;
    setStatus(humanize(error));
    if (llmStatus) llmStatus.textContent = humanize(error);
  } finally {
    previewButton.disabled = false;
    downloadButton.disabled = false;
    previewButton.textContent = "Normalizar";
    downloadButton.textContent = "Normalizar y descargar";
  }
}

document.querySelector("#normalize").addEventListener("click", () => runNormalize(false));
document.querySelector("#normalize-download").addEventListener("click", () => runNormalize(true));

for (const pane of ["vista", "markdown", "json"]) {
  document.querySelector("#tab-" + pane).addEventListener("click", () => showPane(pane));
}

document.querySelector("#download-md").addEventListener("click", () => {
  const capture = captures.find((item) => item.id === selectedId);
  if (!normalized || !capture) return;
  const markdown = normalized.markdown || documentFromNormalized(normalized, capture);
  download("muestrario-normalizado-" + stamp() + ".md", markdown, "text/markdown");
});

document.querySelector("#download-json").addEventListener("click", () => {
  if (!normalized) return;
  download("muestrario-normalizado-" + stamp() + ".json", normalized);
});

function onOptionChange() {
  if (document.querySelector(".checks input:checked")) setStatus("");
  saveOptions();
}

captureButton.addEventListener("click", captureActiveTab);
cssOption.addEventListener("change", onOptionChange);
pixelOption.addEventListener("change", onOptionChange);
markdownOption.addEventListener("change", onOptionChange);
linksOption.addEventListener("change", onOptionChange);
mediaOption.addEventListener("change", onOptionChange);
tablesOption.addEventListener("change", onOptionChange);

document.querySelector("#download-markdown").addEventListener("click", () => {
  const capture = captures.find((item) => item.id === selectedId);
  if (!capture || !capture.markdown) return;
  download("muestrario-" + stamp() + ".md", capture.markdown, "text/markdown");
});

document.querySelector("#export-one").addEventListener("click", () => {
  const capture = captures.find((item) => item.id === selectedId);
  if (!capture) return;
  download("muestrario-" + stamp() + ".json", exportPayload([capture]));
});

document.querySelector("#export-all").addEventListener("click", () => {
  if (!captures.length) return;
  download("muestrario-todo-" + stamp() + ".json", exportPayload(captures));
});

document.querySelector("#clear-history").addEventListener("click", async () => {
  if (!captures.length) return;
  if (!confirm("¿Borrar todas las recolecciones guardadas en este navegador?")) return;
  selectedId = "";
  await persist([]);
  renderCapture(null);
  renderHistory();
  setStatus("Se borraron las recolecciones.");
});

async function refreshKeyStatus() {
  const node = document.querySelector("#key-status");
  try {
    const config = await loadLlmConfig();
    if (config.source === "navegador") node.textContent = "Clave de OpenAI guardada en este navegador.";
    else if (config.source === "desarrollo") node.textContent = "Desarrollo: se usa la clave de OpenAI del .env. No entra al paquete.";
    else node.textContent = "Todavía no hay una clave de OpenAI en este navegador.";
  } catch (error) {
    node.textContent = humanize(error);
  }
}

document.querySelector("#save-key").addEventListener("click", async () => {
  const input = document.querySelector("#llm-key");
  const value = input.value.trim();
  if (!value) {
    document.querySelector("#key-status").textContent = "Pegá la clave API de OpenAI antes de guardarla.";
    return;
  }
  if (!value.startsWith("sk-")) {
    document.querySelector("#key-status").textContent = "Se espera una clave API de OpenAI, que empieza con sk-.";
    return;
  }
  const current = await chrome.storage.local.get(LLM_STORAGE_KEY);
  const previous = current[LLM_STORAGE_KEY] || {};
  await chrome.storage.local.set({
    [LLM_STORAGE_KEY]: { ...previous, apiKey: value, baseUrl: "https://api.openai.com/v1" },
  });
  input.value = "";
  await refreshKeyStatus();
});

document.querySelector("#clear-key").addEventListener("click", async () => {
  const current = await chrome.storage.local.get(LLM_STORAGE_KEY);
  const previous = { ...(current[LLM_STORAGE_KEY] || {}) };
  delete previous.apiKey;
  await chrome.storage.local.set({ [LLM_STORAGE_KEY]: previous });
  document.querySelector("#llm-key").value = "";
  await refreshKeyStatus();
});

const stored = await chrome.storage.local.get([STORAGE_KEY, OPTIONS_KEY]);
captures = Array.isArray(stored[STORAGE_KEY]) ? stored[STORAGE_KEY] : [];
cssOption.checked = false;
pixelOption.checked = false;
markdownOption.checked = true;
linksOption.checked = false;
mediaOption.checked = false;
tablesOption.checked = false;
selectedId = captures[0] ? captures[0].id : "";
renderCapture(captures[0]);
renderHistory();
refreshKeyStatus();
