export function hasExpectedImageSignature(contentType: string, bytes: Uint8Array) {
  if (contentType === "image/png") {
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    return bytes.length >= signature.length && signature.every((value, index) => bytes[index] === value);
  }
  if (contentType === "image/jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (contentType === "image/webp") {
    return bytes.length >= 12 && text(bytes, 0, 4) === "RIFF" && text(bytes, 8, 12) === "WEBP";
  }
  return false;
}

function text(bytes: Uint8Array, start: number, end: number) {
  return String.fromCharCode(...bytes.slice(start, end));
}
