/**
 * Se inyecta en la pestaña. Tiene que ser autosuficiente:
 * Chrome serializa esta función y no conserva imports ni cierres.
 * Arma un markdown por sección, al estilo de la salida limpia de Crawl4AI.
 */
export function collectPageContent() {
  const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "SVG", "CANVAS", "IFRAME"]);
  const NOISE = "nav, footer, [role='navigation'], [role='contentinfo']";
  const MAX_SECTIONS = 40;
  const MAX_SECTION = 4000;
  const MAX_LINKS = 80;
  const MAX_MEDIA = 40;
  const MAX_TABLES = 8;
  const MAX_ROWS = 12;
  const MAX_COLS = 8;

  function clean(text) {
    return String(text || "").replace(/\s+/g, " ").trim();
  }

  function clip(text, max) {
    const value = clean(text);
    if (value.length <= max) return value;
    return value.slice(0, max - 1) + "…";
  }

  function absoluteUrl(value) {
    try {
      return new URL(value, location.href).href;
    } catch {
      return "";
    }
  }

  function visible(element) {
    if (!element || element.nodeType !== 1) return false;
    if (element.closest(NOISE)) return false;
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 || rect.height > 0;
  }

  function inline(element) {
    const parts = [];
    for (const node of element.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = clean(node.textContent);
        if (text) parts.push(text);
        continue;
      }
      if (node.nodeType !== Node.ELEMENT_NODE || SKIP.has(node.tagName)) continue;
      if (node.closest(NOISE) && node.closest(NOISE) !== element) continue;
      const tag = node.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") continue;
      const inner = inline(node);
      if (!inner) continue;
      if (tag === "STRONG" || tag === "B") parts.push("**" + inner + "**");
      else if (tag === "EM" || tag === "I") parts.push("*" + inner + "*");
      else if (tag === "A") {
        const href = absoluteUrl(node.getAttribute("href") || "");
        parts.push(href ? "[" + inner + "](" + href + ")" : inner);
      } else if (tag === "CODE") parts.push("`" + inner + "`");
      else parts.push(inner);
    }
    return clean(parts.join(" "));
  }

  function tableMarkdown(table) {
    const headers = [];
    for (const cell of table.querySelectorAll("thead th")) {
      if (headers.length >= MAX_COLS) break;
      headers.push(clip(cell.innerText, 40));
    }
    const rows = [];
    for (const row of table.querySelectorAll("tbody tr, tr")) {
      if (rows.length >= MAX_ROWS) break;
      if (row.closest("thead")) continue;
      const values = [];
      for (const cell of row.querySelectorAll("th, td")) {
        if (values.length >= MAX_COLS) break;
        values.push(clip(cell.innerText, 40));
      }
      if (values.some(Boolean)) rows.push(values);
    }
    const head = headers.length ? headers : rows.shift();
    if (!head || !head.length) return "";
    const width = Math.max(head.length, ...rows.map((row) => row.length));
    while (head.length < width) head.push("");
    const lines = [
      "| " + head.join(" | ") + " |",
      "| " + head.map(() => "---").join(" | ") + " |",
    ];
    for (const row of rows) {
      const copy = row.slice();
      while (copy.length < width) copy.push("");
      lines.push("| " + copy.join(" | ") + " |");
    }
    return lines.join("\n");
  }

  function blockLine(element) {
    const tag = element.tagName;
    if (tag === "TABLE") return tableMarkdown(element);
    if (tag === "PRE") {
      const text = clip(element.innerText, 800);
      return text ? "```\n" + text + "\n```" : "";
    }
    if (tag === "IMG") {
      const src = absoluteUrl(element.currentSrc || element.getAttribute("src") || "");
      if (!src) return "";
      return "![" + clip(element.getAttribute("alt") || "imagen", 80) + "](" + src + ")";
    }
    if (tag === "LI") {
      const text = inline(element);
      return text ? "- " + text : "";
    }
    if (tag === "BLOCKQUOTE") {
      const text = inline(element);
      return text ? "> " + text : "";
    }
    return inline(element);
  }

  try {
    const root = document.querySelector("main, [role='main'], article") || document.body;
    const description = document.querySelector('meta[name="description"]');
    const pageTitle = clip(document.title, 300) || "Página";
    const sections = [];
    let current = null;

    function startSection(title, level) {
      if (sections.length >= MAX_SECTIONS) return null;
      current = { title: title || "Sección", level: level || 2, lines: [] };
      sections.push(current);
      return current;
    }

    const blocks = root.querySelectorAll("h1, h2, h3, p, li, pre, blockquote, table, img");
    for (const block of blocks) {
      if (!visible(block)) continue;
      if (/^H[1-3]$/.test(block.tagName)) {
        const title = inline(block);
        if (title) startSection(title, Number(block.tagName[1]));
        continue;
      }
      if (block.closest("h1, h2, h3, li, pre, blockquote, table") && block.tagName !== "LI" && block.tagName !== "PRE" && block.tagName !== "BLOCKQUOTE" && block.tagName !== "TABLE") {
        continue;
      }
      if (block.tagName === "LI" && block.parentElement && block.parentElement.closest("li")) continue;
      const line = blockLine(block);
      if (!line) continue;
      if (!current) startSection(pageTitle, 1);
      if (!current) break;
      if (current.lines.join("\n\n").length >= MAX_SECTION) continue;
      current.lines.push(line);
    }

    if (!sections.length) {
      const text = clip(root.innerText, MAX_SECTION);
      if (text) sections.push({ title: pageTitle, level: 1, lines: [text] });
    }

    const normalized = [];
    for (const section of sections) {
      const markdown = section.lines.join("\n\n").slice(0, MAX_SECTION);
      if (!markdown) continue;
      normalized.push({ title: section.title, level: section.level, markdown });
    }

    const parts = ["# " + pageTitle, ""];
    for (const section of normalized) {
      const sameTitle = normalized.length === 1 && section.title === pageTitle;
      if (!sameTitle) {
        const level = Math.min(6, Math.max(2, section.level + 1));
        parts.push("#".repeat(level) + " " + section.title, "");
      }
      parts.push(section.markdown, "");
    }

    const links = [];
    const seenLinks = new Set();
    for (const anchor of root.querySelectorAll("a[href]")) {
      if (links.length >= MAX_LINKS || !visible(anchor)) continue;
      const href = absoluteUrl(anchor.getAttribute("href"));
      if (!href || href.startsWith("javascript:") || seenLinks.has(href)) continue;
      seenLinks.add(href);
      let external = false;
      try {
        external = new URL(href).hostname !== location.hostname;
      } catch {
        external = false;
      }
      links.push({
        text: clip(anchor.innerText, 80) || href,
        href,
        kind: external ? "externo" : "interno",
      });
    }

    const media = [];
    const seenMedia = new Set();
    for (const image of root.querySelectorAll("img[src], video[src], source[src]")) {
      if (media.length >= MAX_MEDIA) break;
      const src = absoluteUrl(image.currentSrc || image.getAttribute("src") || "");
      if (!src || seenMedia.has(src)) continue;
      if (image.tagName === "IMG" && !visible(image)) continue;
      seenMedia.add(src);
      media.push({
        kind: image.tagName === "IMG" ? "imagen" : "video",
        src,
        alt: clip(image.getAttribute("alt") || image.getAttribute("title") || "", 80),
      });
    }

    const tables = [];
    for (const table of root.querySelectorAll("table")) {
      if (tables.length >= MAX_TABLES || !visible(table)) continue;
      const headers = [];
      for (const cell of table.querySelectorAll("thead th")) {
        if (headers.length >= MAX_COLS) break;
        headers.push(clip(cell.innerText, 40));
      }
      const rows = [];
      for (const row of table.querySelectorAll("tbody tr, tr")) {
        if (rows.length >= MAX_ROWS) break;
        if (row.closest("thead")) continue;
        const values = [];
        for (const cell of row.querySelectorAll("th, td")) {
          if (values.length >= MAX_COLS) break;
          values.push(clip(cell.innerText, 40));
        }
        if (values.some(Boolean)) rows.push(values);
      }
      if (!headers.length && !rows.length) continue;
      tables.push({
        caption: clip((table.caption && table.caption.innerText) || "", 80),
        headers,
        rows,
      });
    }

    const headings = normalized.slice(0, 20).map((section) => ({
      level: "h" + section.level,
      text: section.title,
    }));

    return {
      url: location.href.slice(0, 2000),
      title: pageTitle,
      metadata: {
        description: clip(description && description.getAttribute("content"), 240),
        headings,
      },
      sections: normalized,
      markdown: parts.join("\n").trim().slice(0, 24000),
      links,
      media,
      tables,
    };
  } catch (error) {
    return { error: error && error.message ? error.message : String(error) };
  }
}
