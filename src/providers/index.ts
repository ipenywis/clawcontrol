export * from "./hetzner/index.js";

import type { Provider } from "../types/index.js";

export const SUPPORTED_PROVIDERS: Provider[] = ["hetzner"];

export const PROVIDER_NAMES: Record<Provider, string> = {
  hetzner: "Hetzner Cloud",
  digitalocean: "DigitalOcean",
  vultr: "Vultr",
};

export function isProviderSupported(provider: Provider): boolean {
  return SUPPORTED_PROVIDERS.includes(provider);
}
