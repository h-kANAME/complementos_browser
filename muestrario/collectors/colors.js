/**
 * Se inyecta en la pestaña. Tiene que ser autosuficiente:
 * Chrome serializa esta función y no conserva imports ni cierres.
 */
export function collectPageColors() {
  const MAX_ELEMENTS = 5000;
  const MAX_COLORS = 60;
  const MAX_VARIABLES = 80;
  const ROLE_ORDER = [
    "texto",
    "fondo",
    "borde",
    "contorno",
    "sombra",
    "degradado",
    "relleno",
    "trazo",
  ];
  const SKIP_TAGS = new Set([
    "SCRIPT",
    "STYLE",
    "NOSCRIPT",
    "TEMPLATE",
    "META",
    "LINK",
    "HEAD",
    "TITLE",
  ]);
  const TEXTUAL_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT", "BUTTON", "OPTION"]);
  const SVG_NS = "http://www.w3.org/2000/svg";
  const COLOR_TOKEN = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]+\)|hsla?\([^)]+\)/g;

  try {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    const rows = new Map();
    const seen = new Set();
    const ids = new WeakMap();
    let nextId = 1;
    let scanned = 0;
    let truncated = false;

    function channel(value) {
      return Math.max(0, Math.min(255, Math.round(Number(value))));
    }

    function rgbToHex(red, green, blue) {
      return (
        "#" +
        [red, green, blue]
          .map((value) => channel(value).toString(16).padStart(2, "0"))
          .join("")
      );
    }

    function normalize(value) {
      const text = String(value || "").trim().toLowerCase();
      if (text.startsWith("#")) {
        if (text.length === 4) {
          return (
            "#" +
            text
              .slice(1)
              .split("")
              .map((digit) => digit + digit)
              .join("")
          );
        }
        return text;
      }
      const match = text.match(
        /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/,
      );
      if (!match) return null;
      const alpha = match[4] === undefined ? 1 : Number(match[4]);
      if (alpha < 0.04) return null;
      const hex = rgbToHex(match[1], match[2], match[3]);
      if (alpha < 0.995) {
        return hex + channel(alpha * 255).toString(16).padStart(2, "0");
      }
      return hex;
    }

    function toHex(input) {
      if (!context || input == null) return null;
      const raw = String(input).trim();
      if (!raw) return null;
      const lower = raw.toLowerCase();
      if (
        lower === "transparent" ||
        lower === "none" ||
        lower === "inherit" ||
        lower === "initial" ||
        lower === "unset" ||
        lower === "currentcolor"
      ) {
        return null;
      }
      context.fillStyle = "#010203";
      context.fillStyle = raw;
      const out = context.fillStyle;
      if (out === "#010203") {
        const compact = lower.replace(/\s+/g, "");
        const isProbe =
          compact === "#010203" ||
          compact === "rgb(1,2,3)" ||
          compact === "rgba(1,2,3,1)";
        if (!isProbe) return null;
      }
      return normalize(out);
    }

    function uid(element) {
      let id = ids.get(element);
      if (!id) {
        id = nextId;
        nextId += 1;
        ids.set(element, id);
      }
      return id;
    }

    function descriptor(element) {
      const id = element.id ? "#" + CSS.escape(element.id) : "";
      const raw = element.getAttribute && element.getAttribute("class");
      const classes = raw
        ? raw
            .trim()
            .split(/\s+/)
            .slice(0, 2)
            .filter(Boolean)
            .map((name) => "." + CSS.escape(name))
            .join("")
        : "";
      return (element.tagName.toLowerCase() + id + classes).slice(0, 90);
    }

    function clip(text) {
      const clean = String(text || "").replace(/\s+/g, " ").trim();
      if (!clean) return "";
      return clean.length > 42 ? clean.slice(0, 41) + "…" : clean;
    }

    function ownText(element) {
      let text = "";
      for (const node of element.childNodes) {
        if (node.nodeType === Node.TEXT_NODE) text += node.textContent;
      }
      return clip(text);
    }

    function labelFor(element, rect) {
      const named =
        (element.getAttribute && element.getAttribute("aria-label")) ||
        (element.getAttribute && element.getAttribute("alt")) ||
        (element.getAttribute && element.getAttribute("title")) ||
        (element.getAttribute && element.getAttribute("placeholder"));
      if (named) return clip(named);
      const own = ownText(element);
      if (own) return own;
      if (!rect || rect.height > 320 || rect.width > 960) return "";
      const nodes = element.querySelectorAll("h1,h2,h3,h4,button,a,label,span,p,strong");
      const limit = Math.min(nodes.length, 12);
      for (let index = 0; index < limit; index += 1) {
        const text = ownText(nodes[index]);
        if (text && text.length <= 32) return text;
      }
      return "";
    }

    function rememberSample(row, element, role, rect) {
      const needsLabel = row.samples.length < 4 || row.samples.some((sample) => !sample.label);
      if (!needsLabel) return;
      const sample = {
        selector: descriptor(element),
        label: labelFor(element, rect),
        role,
      };
      const key = sample.role + "|" + sample.selector + "|" + sample.label;
      if (row.samples.some((item) => item.key === key)) return;
      sample.key = key;
      if (row.samples.length < 4) {
        row.samples.push(sample);
        return;
      }
      if (!sample.label) return;
      const replace = row.samples.findIndex((item) => !item.label);
      if (replace >= 0) row.samples[replace] = sample;
    }

    function add(value, role, element, rect) {
      const hex = toHex(value);
      if (!hex) return;
      const mark = hex + "|" + role + "|" + uid(element);
      if (seen.has(mark)) return;
      seen.add(mark);
      let row = rows.get(hex);
      if (!row) {
        row = { hex, count: 0, roles: new Set(), samples: [] };
        rows.set(hex, row);
      }
      row.count += 1;
      row.roles.add(role);
      rememberSample(row, element, role, rect);
    }

    function addTokens(value, role, element, rect) {
      if (!value || value === "none") return;
      const matches = String(value).match(COLOR_TOKEN);
      if (!matches) return;
      for (const token of matches) add(token, role, element, rect);
    }

    function hasOwnText(element) {
      for (const node of element.childNodes) {
        if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) return true;
      }
      return false;
    }

    function inspect(element) {
      if (SKIP_TAGS.has(element.tagName)) return;
      const style = getComputedStyle(element);
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        Number(style.opacity) === 0
      ) {
        return;
      }
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      if (hasOwnText(element) || TEXTUAL_TAGS.has(element.tagName)) {
        add(style.color, "texto", element, rect);
      }
      add(style.backgroundColor, "fondo", element, rect);

      const borders = [
        ["borderTopWidth", "borderTopColor"],
        ["borderRightWidth", "borderRightColor"],
        ["borderBottomWidth", "borderBottomColor"],
        ["borderLeftWidth", "borderLeftColor"],
      ];
      for (const [widthName, colorName] of borders) {
        if (parseFloat(style[widthName]) > 0) add(style[colorName], "borde", element, rect);
      }
      if (style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0) {
        add(style.outlineColor, "contorno", element, rect);
      }
      if (style.boxShadow && style.boxShadow !== "none") {
        addTokens(style.boxShadow, "sombra", element, rect);
      }
      if (style.backgroundImage && style.backgroundImage.includes("gradient(")) {
        addTokens(style.backgroundImage, "degradado", element, rect);
      }
      if (element.namespaceURI === SVG_NS) {
        add(style.fill, "relleno", element, rect);
        add(style.stroke, "trazo", element, rect);
      }
    }

    function walk(root, bucket) {
      let nodes;
      try {
        nodes = root.querySelectorAll("*");
      } catch {
        return;
      }
      for (const element of nodes) {
        if (bucket.length >= MAX_ELEMENTS) {
          truncated = true;
          return;
        }
        bucket.push(element);
        if (element.shadowRoot) walk(element.shadowRoot, bucket);
        if (element.tagName === "IFRAME") {
          try {
            if (element.contentDocument) walk(element.contentDocument, bucket);
          } catch {
            // El iframe es de otro origen.
          }
        }
        if (bucket.length >= MAX_ELEMENTS) {
          truncated = true;
          return;
        }
      }
    }

    function collectVariables() {
      const found = [];
      const seenNames = new Set();
      const rootStyle = getComputedStyle(document.documentElement);
      let visited = 0;

      function visit(rules) {
        for (const rule of rules) {
          if (visited >= 4000 || found.length >= MAX_VARIABLES) return;
          visited += 1;
          if (rule.cssRules) {
            try {
              visit(rule.cssRules);
            } catch {
              // Regla anidada inaccesible.
            }
          }
          if (!rule.style) continue;
          for (let index = 0; index < rule.style.length; index += 1) {
            const name = rule.style.item(index);
            if (!name || !name.startsWith("--") || seenNames.has(name)) continue;
            seenNames.add(name);
            const value = (
              rootStyle.getPropertyValue(name) ||
              rule.style.getPropertyValue(name) ||
              ""
            ).trim();
            const hex = toHex(value);
            if (!hex) continue;
            found.push({ name, hex, value: value.slice(0, 120) });
            if (found.length >= MAX_VARIABLES) return;
          }
        }
      }

      for (const sheet of document.styleSheets) {
        try {
          visit(sheet.cssRules);
        } catch {
          // Hoja de otro origen.
        }
        if (found.length >= MAX_VARIABLES) break;
      }
      return found;
    }

    const elements = [];
    walk(document, elements);
    for (const element of elements) {
      scanned += 1;
      try {
        inspect(element);
      } catch {
        // Un nodo raro no frena el resto.
      }
    }

    const colors = [...rows.values()]
      .map((row) => ({
        hex: row.hex,
        count: row.count,
        roles: ROLE_ORDER.filter((role) => row.roles.has(role)),
        samples: row.samples.map((sample) => ({
          selector: sample.selector,
          label: sample.label,
          role: sample.role,
        })),
      }))
      .sort((left, right) => right.count - left.count || left.hex.localeCompare(right.hex));

    return {
      url: location.href.slice(0, 2000),
      title: (document.title || "").slice(0, 300),
      viewport: { width: window.innerWidth, height: window.innerHeight },
      scannedElements: scanned,
      truncated,
      totalColors: colors.length,
      colors: colors.slice(0, MAX_COLORS),
      variables: collectVariables(),
    };
  } catch (error) {
    return {
      error: error && error.message ? error.message : String(error),
    };
  }
}

/** Recuadra en la pestaña los elementos que usan este hex. También se inyecta sola. */
export function highlightColor(hex, role, selector, label) {
  const wanted = String(hex || "").toLowerCase();
  const STYLE_ID = "muestrario-highlight-style";
  const MARK = "muestrario-mark";

  function channel(value) {
    return Math.max(0, Math.min(255, Math.round(Number(value))));
  }

  function toHex(input) {
    const canvas = toHex.canvas || (toHex.canvas = document.createElement("canvas"));
    const context = canvas.getContext("2d");
    if (!context || input == null) return "";
    const raw = String(input).trim();
    if (!raw || raw === "transparent" || raw === "none") return "";
    context.fillStyle = "#010203";
    context.fillStyle = raw;
    const out = String(context.fillStyle || "").toLowerCase();
    if (out.startsWith("#")) return out;
    const match = out.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/);
    if (!match) return "";
    return (
      "#" +
      [match[1], match[2], match[3]]
        .map((value) => channel(value).toString(16).padStart(2, "0"))
        .join("")
    );
  }

  function matches(element, style) {
    const checks = [];
    if (!role || role === "texto") checks.push(style.color);
    if (!role || role === "fondo") checks.push(style.backgroundColor);
    if (!role || role === "borde") {
      if (parseFloat(style.borderTopWidth) > 0) checks.push(style.borderTopColor);
      if (parseFloat(style.borderRightWidth) > 0) checks.push(style.borderRightColor);
      if (parseFloat(style.borderBottomWidth) > 0) checks.push(style.borderBottomColor);
      if (parseFloat(style.borderLeftWidth) > 0) checks.push(style.borderLeftColor);
    }
    if (!role || role === "contorno") checks.push(style.outlineColor);
    if (!role || role === "relleno") checks.push(style.fill);
    if (!role || role === "trazo") checks.push(style.stroke);
    return checks.some((value) => toHex(value) === wanted);
  }

  try {
    document.querySelectorAll("." + MARK).forEach((element) => element.classList.remove(MARK));
    let styleNode = document.getElementById(STYLE_ID);
    if (!styleNode) {
      styleNode = document.createElement("style");
      styleNode.id = STYLE_ID;
      styleNode.textContent =
        "." + MARK + "{outline:3px solid #4E9A06 !important;outline-offset:2px !important;}";
      document.documentElement.append(styleNode);
    }

    const wantedLabel = String(label || "").replace(/\s+/g, " ").trim().toLowerCase();

    function textOf(element) {
      const named =
        (element.getAttribute && element.getAttribute("aria-label")) ||
        (element.getAttribute && element.getAttribute("alt")) ||
        "";
      const visible = element.innerText || "";
      return (named + " " + visible).replace(/\s+/g, " ").trim().toLowerCase();
    }

    function keep(element) {
      const style = getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden") return false;
      if (!matches(element, style)) return false;
      if (wantedLabel && !textOf(element).includes(wantedLabel)) return false;
      return true;
    }

    const found = [];
    function take(element) {
      if (found.length >= 8 || found.includes(element) || !keep(element)) return;
      element.classList.add(MARK);
      found.push(element);
    }

    if (selector) {
      try {
        document.querySelectorAll(selector).forEach(take);
      } catch {
        // El selector de muestra no es válido en esta página.
      }
    }
    if (!found.length) {
      const nodes = document.querySelectorAll("body *");
      const limit = Math.min(nodes.length, 5000);
      for (let index = 0; index < limit && found.length < 8; index += 1) take(nodes[index]);
    }

    if (found[0] && found[0].scrollIntoView) {
      found[0].scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
    }
    window.setTimeout(() => {
      found.forEach((element) => element.classList.remove(MARK));
    }, 6000);
    return { matched: found.length };
  } catch (error) {
    return { error: error && error.message ? error.message : String(error) };
  }
}
