import Busboy from "busboy";
import sharp from "sharp";
import { fail } from "./service.js";
function imageParser({ product = false } = {}) {
return function parseUpload(req, res, next) {
  let parser;
  try {
    parser = Busboy({
      headers: req.headers,
      limits: {
        fileSize: 5 * 1024 * 1024,
        files: 1,
        fields: product ? 8 : 3,
        fieldSize: product ? 16384 : 128,
        parts: product ? 10 : 5,
        headerPairs: 32,
      },
    });
  } catch {
    return next(fail(400, "Ожидается форма с фотографией."));
  }
  const fields = Object.create(null),
    chunks = [];
  let invalid = false,
    hasFile = false,
    size = 0,
    total = 0,
    done = false;
  const finish = (err) => {
    if (done) return;
    done = true;
    req.removeListener("data", count);
    if (err) {
      req.unpipe(parser);
      req.resume();
      next(err);
    } else {
      req.body = fields;
      req.shopImage = hasFile ? Buffer.concat(chunks) : null;
      next();
    }
  };
  const count = (chunk) => {
    total += chunk.length;
    if (total > 6 * 1024 * 1024)
      finish(
        Object.assign(fail(413, "Форма слишком большая."), {
          type: "entity.too.large",
        }),
      );
  };
  req.on("data", count);
  parser.on("field", (name, value, info) => {
    if (
      !(product ? ["_csrf", "key", "version", "name", "category", "description", "characteristics", "active"] : ["_csrf", "key", "version"]).includes(name) ||
      Object.hasOwn(fields, name) ||
      info.valueTruncated ||
      info.nameTruncated
    )
      invalid = true;
    fields[name] = value;
  });
  parser.on("file", (name, file, info) => {
    if (product && name === "image" && !info.filename) {
      file.on("data", chunk => { if (chunk.length) invalid = true; });
      file.on("error", () => { invalid = true; });
      file.resume(); return;
    }
    if (
      name !== "image" ||
      hasFile ||
      !["image/jpeg", "image/png", "image/webp"].includes(info.mimeType)
    )
      invalid = true;
    hasFile = true;
    file.on("limit", () => {
      invalid = true;
    });
    file.on("data", (chunk) => {
      size += chunk.length;
      if (size <= 5 * 1024 * 1024) chunks.push(chunk);
    });
    file.on("error", () => {
      invalid = true;
    });
  });
  for (const event of ["filesLimit", "fieldsLimit", "partsLimit"])
    parser.on(event, () => {
      invalid = true;
    });
  parser.on("error", () => finish(fail(400, "Некорректная форма фотографии.")));
  parser.on("close", () =>
    finish(
      invalid || (hasFile && !size) || (!product && !hasFile)
        ? fail(400, "Нужен один JPEG, PNG или WebP до 5 МБ.")
        : null,
    ),
  );
  req.pipe(parser);
};
}
export const parseImage = imageParser();
export const parseProductImage = imageParser({ product: true });
export async function normalizeImage(input) {
  try {
    const png = input
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const jpeg = input[0] === 255 && input[1] === 216 && input[2] === 255;
    const webp =
      input.subarray(0, 4).toString("ascii") === "RIFF" &&
      input.subarray(8, 12).toString("ascii") === "WEBP";
    if (!png && !jpeg && !webp) throw Error();
    const image = sharp(input, {
        limitInputPixels: 20000000,
        animated: false,
        failOn: "warning",
      }),
      m = await image.metadata();
    if (!["jpeg", "png", "webp"].includes(m.format) || (m.pages || 1) > 1)
      throw Error();
    const data = await image
      .rotate()
      .resize({
        width: 1600,
        height: 1600,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 82 })
      .toBuffer();
    if (!data.length || data.length > 1048576) throw Error();
    return data;
  } catch {
    throw fail(400, "Нужен статический JPEG, PNG или WebP до 20 мегапикселей.");
  }
}
