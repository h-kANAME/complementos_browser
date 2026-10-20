import assert from "node:assert/strict";
import test from "node:test";
import { quantizeImageData, rgbToHex } from "./quantize.js";

function image(width, height, paint) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [red, green, blue, alpha] = paint(x, y);
      const index = (y * width + x) * 4;
      data[index] = red;
      data[index + 1] = green;
      data[index + 2] = blue;
      data[index + 3] = alpha;
    }
  }
  return { data, width, height };
}

test("rgbToHex normaliza canales y usa minúsculas", () => {
  assert.equal(rgbToHex(255, 0, 16), "#ff0010");
  assert.equal(rgbToHex(300, -4, 15.2), "#ff000f");
});

test("un bloque rojo devuelve ese hex", () => {
  const result = quantizeImageData(
    image(8, 8, () => [255, 0, 0, 255]),
    { step: 1, maxColors: 4 },
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].hex, "#ff0000");
  assert.equal(result[0].share, 1);
});

test("ignora píxeles transparentes", () => {
  const result = quantizeImageData(
    image(4, 4, () => [0, 0, 0, 0]),
    { step: 1 },
  );
  assert.deepEqual(result, []);
});

test("separa rojo y azul", () => {
  const result = quantizeImageData(
    image(8, 4, (x) => (x < 4 ? [255, 0, 0, 255] : [0, 0, 255, 255])),
    { step: 1, maxColors: 4 },
  );
  assert.deepEqual(
    result.map((item) => item.hex).sort(),
    ["#0000ff", "#ff0000"],
  );
});

test("funde tonos cercanos en un solo hex", () => {
  const result = quantizeImageData(
    image(8, 4, (x) => (x < 4 ? [255, 0, 0, 255] : [239, 0, 0, 255])),
    { step: 1, maxColors: 4 },
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].hex, "#f70000");
});
