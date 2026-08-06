function decodeEntities(value) {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function stripTags(value) {
  return decodeEntities(value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function attributes(fragment) {
  const result = {};
  const pattern = /([:\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  for (const match of fragment.matchAll(pattern)) result[match[1].toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? "");
  return result;
}

export function parseHtml(html, pageUrl) {
  const htmlTag = html.match(/<html\b([^>]*)>/i);
  const title = stripTags(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  const headings = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map((match) => stripTags(match[1])).filter(Boolean);
  const links = [];
  for (const match of html.matchAll(/<a\b([^>]*)>/gi)) {
    const href = attributes(match[1]).href;
    if (!href || /^(mailto:|tel:|javascript:|data:)/i.test(href)) continue;
    try { links.push(new URL(href, pageUrl).href); } catch { /* malformed link becomes a page-level observation elsewhere */ }
  }
  const images = [...html.matchAll(/<img\b([^>]*)>/gi)].map((match) => attributes(match[1]));
  const metas = [...html.matchAll(/<meta\b([^>]*)>/gi)].map((match) => attributes(match[1]));
  const linkTags = [...html.matchAll(/<link\b([^>]*)>/gi)].map((match) => attributes(match[1]));
  return {
    title,
    description: metas.find((meta) => meta.name?.toLowerCase() === "description")?.content ?? "",
    canonical: linkTags.find((link) => link.rel?.toLowerCase().split(/\s+/).includes("canonical"))?.href ?? "",
    lang: attributes(htmlTag?.[1] ?? "").lang ?? "",
    h1: headings,
    links: [...new Set(links)],
    images,
    text: stripTags(html),
  };
}
