export function isCrossOriginWrite(request: {
  method: string;
  url: string;
  origin: string | null;
  secFetchSite: string | null;
}): boolean;
export function contentSecurityPolicy(nonce: string, options?: { allowEval?: boolean }): string;
