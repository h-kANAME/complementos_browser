function channel(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

export function rgbToHex(red, green, blue) {
  return (
    "#" +
    [red, green, blue]
      .map((value) => channel(value).toString(16).padStart(2, "0"))
      .join("")
  );
}

function distance(left, right) {
  const red = left.r - right.r;
  const green = left.g - right.g;
  const blue = left.b - right.b;
  return Math.sqrt(red * red + green * green + blue * blue);
}

export function quantizeImageData(imageData, options = {}) {
  const step = Math.max(1, options.step || 4);
  const maxColors = Math.max(1, options.maxColors || 8);
  const data = imageData && imageData.data;
  const width = imageData && imageData.width;
  const height = imageData && imageData.height;
  if (!data || !width || !height) return [];

  const buckets = new Map();
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const index = (y * width + x) * 4;
      if (data[index + 3] < 220) continue;
      const red = data[index];
      const green = data[index + 1];
      const blue = data[index + 2];
      const key = ((red >> 4) << 8) | ((green >> 4) << 4) | (blue >> 4);
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { n: 0, r: 0, g: 0, b: 0 };
        buckets.set(key, bucket);
      }
      bucket.n += 1;
      bucket.r += red;
      bucket.g += green;
      bucket.b += blue;
    }
  }

  const ranked = [...buckets.values()].sort((left, right) => right.n - left.n);
  const total = ranked.reduce((sum, bucket) => sum + bucket.n, 0);
  if (!total) return [];

  const picked = [];
  for (const bucket of ranked) {
    const color = {
      r: bucket.r / bucket.n,
      g: bucket.g / bucket.n,
      b: bucket.b / bucket.n,
    };
    const near = picked.find((item) => distance(item, color) < 26);
    if (near) {
      const next = near.count + bucket.n;
      near.r = (near.r * near.count + color.r * bucket.n) / next;
      near.g = (near.g * near.count + color.g * bucket.n) / next;
      near.b = (near.b * near.count + color.b * bucket.n) / next;
      near.count = next;
      continue;
    }
    picked.push({ ...color, count: bucket.n });
  }

  return picked
    .map((item) => ({
      hex: rgbToHex(item.r, item.g, item.b),
      count: item.count,
    }))
    .sort((left, right) => right.count - left.count)
    .slice(0, maxColors)
    .map((item) => ({
      hex: item.hex,
      count: item.count,
      share: item.count / total,
    }));
}
