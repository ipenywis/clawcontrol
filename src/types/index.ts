import { z } from "zod";

// Provider types
export type Provider = "hetzner" | "digitalocean" | "vultr";

export const ProviderSchema = z.enum(["hetzner", "digitalocean", "vultr"]);

// Deployment status
export type DeploymentStatus =
  | "initialized"
  | "provisioning"
  | "configuring"
  | "deployed"
  | "failed"
  | "updating";

export const DeploymentStatusSchema = z.enum([
  "initialized",
  "provisioning",
  "configuring",
  "deployed",
  "failed",
  "updating",
]);

// Checkpoint for deployment recovery
// Note: "channel_paired" is kept for backward compatibility with existing deployments
export type CheckpointName =
  | "server_created"
  | "ssh_key_uploaded"
  | "ssh_connected"
  | "swap_configured"
  | "system_updated"
  | "nvm_installed"
  | "node_installed"
  | "pnpm_installed"
  | "chrome_installed"
  | "openclaw_installed"
  | "openclaw_configured"
  | "tailscale_installed"
  | "tailscale_authenticated"
  | "tailscale_configured"
  | "daemon_started"
  | "channel_paired"
  | "completed";

export const CheckpointNameSchema = z.enum([
  "server_created",
  "ssh_key_uploaded",
  "ssh_connected",
  "swap_configured",
  "system_updated",
  "nvm_installed",
  "node_installed",
  "pnpm_installed",
  "chrome_installed",
  "openclaw_installed",
  "openclaw_configured",
  "tailscale_installed",
  "tailscale_authenticated",
  "tailscale_configured",
  "daemon_started",
  "channel_paired",
  "completed",
]);

export interface Checkpoint {
  name: CheckpointName;
  completedAt: string;
  retryCount: number;
}

// Hetzner-specific config
export const HetznerConfigSchema = z.object({
  apiKey: z.string().min(1, "Hetzner API key is required"),
  serverType: z.string().default("cpx11"),
  location: z.string().default("ash"),
  image: z.string().default("ubuntu-24.04"),
});

export type HetznerConfig = z.infer<typeof HetznerConfigSchema>;

// DigitalOcean-specific config
export const DigitalOceanConfigSchema = z.object({
  apiKey: z.string().min(1, "DigitalOcean API token is required"),
  size: z.string().default("s-1vcpu-2gb"),
  region: z.string().default("nyc1"),
  image: z.string().default("ubuntu-24-04-x64"),
});

export type DigitalOceanConfig = z.infer<typeof DigitalOceanConfigSchema>;

// DigitalOcean API types
export interface DODroplet {
  id: number;
  name: string;
  status: string;
  networks: {
    v4: { ip_address: string; type: string }[];
    v6: { ip_address: string; type: string }[];
  };
  size_slug: string;
  region: { slug: string; name: string };
  image: { slug: string; name: string };
  created_at: string;
}

export interface DOSSHKey {
  id: number;
  name: string;
  fingerprint: string;
  public_key: string;
}

export interface DOSize {
  slug: string;
  memory: number;
  vcpus: number;
  disk: number;
  transfer: number;
  price_monthly: number;
  available: boolean;
  regions: string[];
}

export interface DORegion {
  slug: string;
  name: string;
  available: boolean;
  sizes: string[];
}

// OpenClaw custom config (optional overrides)
export const OpenClawConfigSchema = z
  .object({
    gateway: z
      .object({
        port: z.number().default(18789),
        mode: z.string().default("local"),
        bind: z.string().default("loopback"),
      })
      .optional(),
    browser: z
      .object({
        headless: z.boolean().default(true),
        defaultProfile: z.string().default("openclaw"),
      })
      .optional(),
  })
  .optional();

export type OpenClawConfig = z.infer<typeof OpenClawConfigSchema>;

// OpenClaw agent config (AI provider + channel)
export const OpenClawAgentConfigSchema = z.object({
  aiProvider: z.string().min(1, "AI provider is required"),
  aiApiKey: z.string().min(1, "AI provider API key is required"),
  model: z.string().min(1, "Model identifier is required"),
  channel: z.string().default("telegram"),
  telegramBotToken: z.string().min(1, "Telegram bot token is required"),
  telegramAllowFrom: z.string().optional(), // Telegram user ID or @username for access control
});

export type OpenClawAgentConfig = z.infer<typeof OpenClawAgentConfigSchema>;

// Deployment configuration (stored in config.json)
export const DeploymentConfigSchema = z.object({
  name: z.string().min(1, "Deployment name is required"),
  provider: ProviderSchema,
  createdAt: z.string(),
  hetzner: HetznerConfigSchema.optional(),
  digitalocean: DigitalOceanConfigSchema.optional(),
  openclawConfig: OpenClawConfigSchema,
  openclawAgent: OpenClawAgentConfigSchema.optional(),
});

export type DeploymentConfig = z.infer<typeof DeploymentConfigSchema>;

// Deployment state (stored in state.json)
export const DeploymentStateSchema = z.object({
  status: DeploymentStatusSchema,
  serverId: z.string().optional(),
  serverIp: z.string().optional(),
  tailscaleIp: z.string().optional(),
  sshKeyId: z.string().optional(),
  sshKeyFingerprint: z.string().optional(),
  checkpoints: z.array(
    z.object({
      name: CheckpointNameSchema,
      completedAt: z.string(),
      retryCount: z.number(),
    })
  ),
  lastError: z.string().optional(),
  deployedAt: z.string().optional(),
  updatedAt: z.string(),
});

export type DeploymentState = z.infer<typeof DeploymentStateSchema>;

// Full deployment (config + state combined)
export interface Deployment {
  config: DeploymentConfig;
  state: DeploymentState;
  sshKeyPath: string;
}

// Template types
export const TemplateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  builtIn: z.boolean(),
  createdAt: z.string(),
  provider: ProviderSchema,
  hetzner: z.object({
    serverType: z.string(),
    location: z.string(),
    image: z.string(),
  }).optional(),
  digitalocean: z.object({
    size: z.string(),
    region: z.string(),
    image: z.string(),
  }).optional(),
  aiProvider: z.string().min(1),
  model: z.string().min(1),
  channel: z.string().default("telegram"),
});

export type Template = z.infer<typeof TemplateSchema>;

// Saved secret types (for reusable API key storage)
export const SavedSecretSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  value: z.string().min(1),
  createdAt: z.string(),
});
export type SavedSecret = z.infer<typeof SavedSecretSchema>;

export const SecretFileSchema = z.object({
  keys: z.array(SavedSecretSchema),
});
export type SecretFile = z.infer<typeof SecretFileSchema>;

// Command types
export type CommandName =
  | "new"
  | "deploy"
  | "status"
  | "ssh"
  | "logs"
  | "destroy"
  | "help"
  | "templates";

export interface Command {
  name: CommandName;
  description: string;
  execute: () => Promise<void>;
}

// UI State
export type ViewName =
  | "home"
  | "new"
  | "deploy"
  | "deploying"
  | "status"
  | "ssh"
  | "logs"
  | "destroy"
  | "help"
  | "templates";

export interface AppState {
  currentView: ViewName;
  selectedDeployment: string | null;
  deployments: Map<string, Deployment>;
  isLoading: boolean;
  error: string | null;
}

// Hetzner API types
export interface HetznerServer {
  id: number;
  name: string;
  status: string;
  public_net: {
    ipv4: {
      ip: string;
    };
    ipv6: {
      ip: string;
    };
  };
  server_type: {
    name: string;
    description: string;
  };
  datacenter: {
    name: string;
    location: {
      name: string;
      city: string;
      country: string;
    };
  };
  created: string;
}

export interface HetznerSSHKey {
  id: number;
  name: string;
  fingerprint: string;
  public_key: string;
}

export interface HetznerServerType {
  id: number;
  name: string;
  description: string;
  cores: number;
  memory: number;
  disk: number;
  prices: {
    location: string;
    price_monthly: {
      gross: string;
    };
  }[];
}

export interface HetznerLocation {
  id: number;
  name: string;
  description: string;
  country: string;
  city: string;
  network_zone: string;
}
