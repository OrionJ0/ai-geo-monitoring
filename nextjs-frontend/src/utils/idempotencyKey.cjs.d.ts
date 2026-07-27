export interface BrowserCrypto {
  randomUUID?: () => string;
  getRandomValues?: <T extends ArrayBufferView | null>(array: T) => T;
}

export function createIdempotencyKey(cryptoApi?: BrowserCrypto): string;
