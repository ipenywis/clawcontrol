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

// Deployment configuration (stored in config.json)
export const DeploymentConfigSchema = z.object({
  name: z.string().min(1, "Deployment name is required"),
  provider: ProviderSchema,
  createdAt: z.string(),
  hetzner: HetznerConfigSchema.optional(),
  openclawConfig: OpenClawConfigSchema,
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

// Command types
export type CommandName =
  | "new"
  | "deploy"
  | "status"
  | "ssh"
  | "logs"
  | "destroy"
  | "help";

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
  | "help";

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
