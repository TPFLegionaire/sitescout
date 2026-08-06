const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const retainedChunks = new Set(["IHDR", "PLTE", "IDAT", "IEND", "tRNS"]);

export function stripPngMetadata(input: Uint8Array) {
  if (input.length < signature.length || !signature.every((byte, index) => input[index] === byte)) throw new Error("Invalid PNG signature.");
  const chunks: Uint8Array[] = [input.slice(0, 8)];
  let offset = 8;
  let sawHeader = false;
  let sawData = false;
  let sawEnd = false;
  while (offset + 12 <= input.length) {
    const view = new DataView(input.buffer, input.byteOffset + offset, 4);
    const dataLength = view.getUint32(0, false);
    const end = offset + 12 + dataLength;
    if (dataLength > 25 * 1024 * 1024 || end > input.length) throw new Error("Malformed PNG chunk.");
    const type = String.fromCharCode(...input.slice(offset + 4, offset + 8));
    if (type === "IHDR") sawHeader = true;
    if (type === "IDAT") sawData = true;
    if (type === "IEND") sawEnd = true;
    if (retainedChunks.has(type)) chunks.push(input.slice(offset, end));
    offset = end;
    if (type === "IEND") break;
  }
  if (!sawHeader || !sawData || !sawEnd) throw new Error("PNG is missing required image chunks.");
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(total);
  let writeOffset = 0;
  for (const chunk of chunks) { output.set(chunk, writeOffset); writeOffset += chunk.length; }
  return output;
}
