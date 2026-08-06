import { hasExpectedImageSignature } from "./image-signature";
import { stripPngMetadata } from "./png-sanitize";

const allowedImageTypes = new Set(["image/png", "image/jpeg", "image/webp"]);
export const maxEvidenceFileBytes = 5 * 1024 * 1024;

export async function prepareEvidenceUpload(value: FormDataEntryValue, requirePrivacySafePng = false) {
  if (!(value instanceof File) || value.size === 0) throw Object.assign(new Error("A screenshot is required."), { status: 400 });
  if (!allowedImageTypes.has(value.type) || value.size > maxEvidenceFileBytes) throw Object.assign(new Error("Screenshot must be PNG, JPEG or WebP and no larger than 5 MB."), { status: 400 });
  if (requirePrivacySafePng && value.type !== "image/png") throw Object.assign(new Error("The Site Scout editor must submit a privacy-safe PNG."), { status: 400 });
  const uploadedBytes = new Uint8Array(await value.arrayBuffer());
  if (!hasExpectedImageSignature(value.type, uploadedBytes)) throw Object.assign(new Error("Screenshot content does not match its declared image type."), { status: 400 });
  let bytes = uploadedBytes;
  if (value.type === "image/png") {
    try { bytes = stripPngMetadata(uploadedBytes); } catch { throw Object.assign(new Error("Screenshot PNG could not be safely normalised."), { status: 400 }); }
  }
  return {
    bytes,
    contentType: value.type,
    extension: value.type === "image/png" ? "png" : value.type === "image/webp" ? "webp" : "jpg",
    originalName: value.name.slice(0, 160),
    sizeBytes: bytes.byteLength,
  };
}
