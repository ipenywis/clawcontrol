import type {
  CheckpointName,
  Checkpoint,
  DeploymentState,
  Deployment,
} from "../types/index.js";
import {
  readDeploymentState,
  updateDeploymentState,
  readDeployment,
} from "./config.js";
import {
  generateSSHKeyPair,
  saveSSHKeyPair,
  loadSSHKeyPair,
  createSSHConnection,
  waitForSSH,
  type SSHConnection,
} from "./ssh.js";
import { randomBytes } from "crypto";
import { createHetznerClient, HetznerAPIError } from "../providers/hetzner/api.js";
import { createDigitalOceanClient, DigitalOceanAPIError } from "../providers/digitalocean/api.js";
import * as SetupScripts from "./setup/index.js";

const MAX_RETRIES = 3;
const CHECKPOINT_ORDER: CheckpointName[] = [
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
];

export interface DeploymentProgress {
  currentStep: CheckpointName;
  completedSteps: CheckpointName[];
  totalSteps: number;
  progress: number;
  message: string;
}

export type ProgressCallback = (progress: DeploymentProgress) => void;
export type ConfirmCallback = (message: string) => Promise<boolean>;
export type OpenUrlCallback = (url: string) => Promise<void>;
export type SpawnTerminalCallback = (deploymentName: string, serverIp: string, command: string) => Promise<void>;

export class DeploymentError extends Error {
  checkpoint: CheckpointName;
  retryCount: number;
  recoverable: boolean;

  constructor(
    message: string,
    checkpoint: CheckpointName,
    retryCount: number,
    recoverable: boolean = true
  ) {
    super(message);
    this.name = "DeploymentError";
    this.checkpoint = checkpoint;
    this.retryCount = retryCount;
    this.recoverable = recoverable;
  }
}

/**
 * Get the last completed checkpoint for a deployment
 */
export function getLastCheckpoint(state: DeploymentState): CheckpointName | null {
  if (state.checkpoints.length === 0) {
    return null;
  }

  // Sort by order and return the last one
  const sorted = state.checkpoints
    .filter((cp) => CHECKPOINT_ORDER.includes(cp.name))
    .sort(
      (a, b) =>
        CHECKPOINT_ORDER.indexOf(a.name) - CHECKPOINT_ORDER.indexOf(b.name)
    );

  return sorted.length > 0 ? sorted[sorted.length - 1].name : null;
}

/**
 * Get the next checkpoint to execute
 */
export function getNextCheckpoint(state: DeploymentState): CheckpointName {
  const lastCheckpoint = getLastCheckpoint(state);

  if (!lastCheckpoint) {
    return CHECKPOINT_ORDER[0];
  }

  const currentIndex = CHECKPOINT_ORDER.indexOf(lastCheckpoint);
  if (currentIndex === -1 || currentIndex >= CHECKPOINT_ORDER.length - 1) {
    return "completed";
  }

  return CHECKPOINT_ORDER[currentIndex + 1];
}

/**
 * Mark a checkpoint as completed
 */
export function markCheckpointComplete(
  deploymentName: string,
  checkpointName: CheckpointName,
  retryCount: number = 0
): DeploymentState {
  const state = readDeploymentState(deploymentName);

  // Check if checkpoint already exists
  const existingIndex = state.checkpoints.findIndex(
    (cp) => cp.name === checkpointName
  );

  const checkpoint: Checkpoint = {
    name: checkpointName,
    completedAt: new Date().toISOString(),
    retryCount,
  };

  if (existingIndex >= 0) {
    state.checkpoints[existingIndex] = checkpoint;
  } else {
    state.checkpoints.push(checkpoint);
  }

  return updateDeploymentState(deploymentName, {
    checkpoints: state.checkpoints,
    status: checkpointName === "completed" ? "deployed" : "configuring",
  });
}

/**
 * Get retry count for a specific checkpoint
 */
export function getCheckpointRetryCount(
  state: DeploymentState,
  checkpointName: CheckpointName
): number {
  const checkpoint = state.checkpoints.find((cp) => cp.name === checkpointName);
  return checkpoint?.retryCount ?? 0;
}

/**
 * Reset deployment to a specific checkpoint
 */
export function resetToCheckpoint(
  deploymentName: string,
  checkpointName: CheckpointName
): DeploymentState {
  const state = readDeploymentState(deploymentName);
  const checkpointIndex = CHECKPOINT_ORDER.indexOf(checkpointName);

  // Keep only checkpoints before the target
  const newCheckpoints = state.checkpoints.filter((cp) => {
    const cpIndex = CHECKPOINT_ORDER.indexOf(cp.name);
    return cpIndex < checkpointIndex;
  });

  return updateDeploymentState(deploymentName, {
    checkpoints: newCheckpoints,
    status: newCheckpoints.length > 0 ? "configuring" : "initialized",
    lastError: undefined,
  });
}

/**
 * Main deployment orchestrator
 */
export class DeploymentOrchestrator {
  private deploymentName: string;
  private deployment: Deployment;
  private sshConnection: SSHConnection | null = null;
  private onProgress: ProgressCallback;
  private onConfirm: ConfirmCallback;
  private onOpenUrl: OpenUrlCallback;
  private onSpawnTerminal: SpawnTerminalCallback;
  private tailscaleSkipped = false;

  constructor(
    deploymentName: string,
    onProgress: ProgressCallback,
    onConfirm: ConfirmCallback,
    onOpenUrl: OpenUrlCallback,
    onSpawnTerminal: SpawnTerminalCallback
  ) {
    this.deploymentName = deploymentName;
    this.deployment = readDeployment(deploymentName);
    this.onProgress = onProgress;
    this.onConfirm = onConfirm;
    this.onOpenUrl = onOpenUrl;
    this.onSpawnTerminal = onSpawnTerminal;
  }

  /**
   * Run the full deployment workflow
   */
  async deploy(): Promise<void> {
    const state = readDeploymentState(this.deploymentName);
    const startCheckpoint = getNextCheckpoint(state);

    updateDeploymentState(this.deploymentName, {
      status: "provisioning",
    });

    try {
      await this.executeFromCheckpoint(startCheckpoint);
    } finally {
      // Clean up SSH connection
      if (this.sshConnection?.isConnected()) {
        this.sshConnection.disconnect();
      }
    }
  }

  /**
   * Execute deployment from a specific checkpoint
   */
  private async executeFromCheckpoint(startCheckpoint: CheckpointName): Promise<void> {
    const startIndex = CHECKPOINT_ORDER.indexOf(startCheckpoint);

    for (let i = startIndex; i < CHECKPOINT_ORDER.length; i++) {
      const checkpoint = CHECKPOINT_ORDER[i];
      const state = readDeploymentState(this.deploymentName);
      let retryCount = getCheckpointRetryCount(state, checkpoint);

      this.reportProgress(checkpoint, this.getCheckpointDescription(checkpoint));

      while (retryCount < MAX_RETRIES) {
        try {
          await this.executeCheckpoint(checkpoint);
          markCheckpointComplete(this.deploymentName, checkpoint, retryCount);
          break;
        } catch (error) {
          retryCount++;
          const errorMessage = error instanceof Error ? error.message : String(error);
          const stepDescription = this.getCheckpointDescription(checkpoint);

          updateDeploymentState(this.deploymentName, {
            lastError: errorMessage,
            status: "failed",
          });

          if (retryCount < MAX_RETRIES) {
            // Notify about retry
            this.reportProgress(
              checkpoint,
              `${stepDescription} failed (attempt ${retryCount}/${MAX_RETRIES}), retrying...`
            );
            // Wait before retry
            await new Promise((resolve) => setTimeout(resolve, 5000));
          } else {
            // Ask user what to do after all retries exhausted
            const shouldRetry = await this.onConfirm(
              `"${stepDescription}" failed after ${MAX_RETRIES} attempts.\n\n` +
              `Error: ${errorMessage}\n\n` +
              `This could be caused by a temporary network issue, a misconfigured API key, ` +
              `or a problem with the remote server. You can retry the deployment from the beginning ` +
              `to try again.\n\n` +
              `Would you like to retry from the beginning?`
            );

            if (shouldRetry) {
              resetToCheckpoint(this.deploymentName, CHECKPOINT_ORDER[0]);
              await this.executeFromCheckpoint(CHECKPOINT_ORDER[0]);
              return;
            } else {
              throw new DeploymentError(
                `Deployment failed at "${stepDescription}": ${errorMessage}`,
                checkpoint,
                retryCount,
                false
              );
            }
          }
        }
      }
    }

    updateDeploymentState(this.deploymentName, {
      status: "deployed",
      deployedAt: new Date().toISOString(),
    });
  }

  /**
   * Execute a single checkpoint
   */
  private async executeCheckpoint(checkpoint: CheckpointName): Promise<void> {
    switch (checkpoint) {
      case "server_created":
        await this.createServer();
        break;
      case "ssh_key_uploaded":
        await this.uploadSSHKey();
        break;
      case "ssh_connected":
        await this.connectSSH();
        break;
      case "swap_configured":
        await this.setupSwap();
        break;
      case "system_updated":
        await this.updateSystem();
        break;
      case "nvm_installed":
        await this.installNVM();
        break;
      case "node_installed":
        await this.installNode();
        break;
      case "pnpm_installed":
        await this.installPnpm();
        break;
      case "chrome_installed":
        await this.installChrome();
        break;
      case "openclaw_installed":
        await this.installOpenClaw();
        break;
      case "openclaw_configured":
        await this.configureOpenClaw();
        break;
      case "tailscale_installed":
        await this.installTailscale();
        break;
      case "tailscale_authenticated":
        await this.authenticateTailscale();
        break;
      case "tailscale_configured":
        await this.configureTailscale();
        break;
      case "daemon_started":
        await this.startDaemon();
        break;
      case "completed":
        // Final step - nothing to do
        break;
    }
  }

  // ============ Checkpoint Implementations ============

  private async createServer(): Promise<void> {
    const config = this.deployment.config;

    if (config.provider === "hetzner") {
      await this.createHetznerServer();
    } else if (config.provider === "digitalocean") {
      await this.createDigitalOceanServer();
    } else {
      throw new Error(`Unsupported provider: ${config.provider}`);
    }
  }

  private async createHetznerServer(): Promise<void> {
    const config = this.deployment.config;

    if (!config.hetzner) {
      throw new Error("Hetzner configuration is missing");
    }

    const client = createHetznerClient(config.hetzner.apiKey);
    const state = readDeploymentState(this.deploymentName);
    const sshKeyName = `clawcontrol-${config.name}`;

    // Check if local SSH keys exist
    let keyPair = loadSSHKeyPair(config.name);
    const localKeysExist = keyPair !== null;

    // If local keys don't exist but we have remote resources, we need to clean up
    if (!localKeysExist && (state.serverId || state.sshKeyId)) {
      this.reportProgress("server_created", "Local SSH keys missing, cleaning up remote resources...");

      if (state.serverId) {
        try {
          await client.deleteServer(Number(state.serverId));
          this.reportProgress("server_created", "Deleted existing server...");
        } catch (error) {
          if (!(error instanceof HetznerAPIError && error.code === "not_found")) {
            throw error;
          }
        }
      }

      if (state.sshKeyId) {
        try {
          await client.deleteSSHKey(Number(state.sshKeyId));
          this.reportProgress("server_created", "Deleted existing SSH key...");
        } catch (error) {
          if (!(error instanceof HetznerAPIError && error.code === "not_found")) {
            throw error;
          }
        }
      }

      updateDeploymentState(config.name, {
        serverId: undefined,
        serverIp: undefined,
        sshKeyId: undefined,
        sshKeyFingerprint: undefined,
      });
    }

    if (!keyPair) {
      this.reportProgress("server_created", "Generating SSH key pair...");
      keyPair = generateSSHKeyPair(sshKeyName);
      saveSSHKeyPair(config.name, keyPair);
    }

    const existingKeys = await client.listSSHKeys();
    const existingKey = existingKeys.find((k) => k.name === sshKeyName);
    if (existingKey) {
      this.reportProgress("server_created", "Removing stale SSH key from Hetzner...");
      await client.deleteSSHKey(existingKey.id);
    }

    this.reportProgress("server_created", "Uploading SSH key to Hetzner...");
    const sshKey = await client.createSSHKey(sshKeyName, keyPair.publicKey);

    updateDeploymentState(config.name, {
      sshKeyId: String(sshKey.id),
      sshKeyFingerprint: sshKey.fingerprint,
    });

    const existingServers = await client.listServers();
    const existingServer = existingServers.find((s) => s.name === config.name);
    if (existingServer) {
      this.reportProgress("server_created", "Removing existing server with same name...");
      await client.deleteServer(existingServer.id);
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }

    this.reportProgress("server_created", "Creating VPS server...");
    const result = await client.createServer({
      name: config.name,
      server_type: config.hetzner.serverType || "cpx11",
      image: config.hetzner.image || "ubuntu-24.04",
      location: config.hetzner.location || "ash",
      ssh_keys: [sshKey.id],
      start_after_create: true,
    });

    updateDeploymentState(config.name, {
      serverId: String(result.server.id),
    });

    this.reportProgress("server_created", "Waiting for server to start...");
    const server = await client.waitForServerRunning(result.server.id);

    updateDeploymentState(config.name, {
      serverIp: server.public_net.ipv4.ip,
    });
  }

  private async createDigitalOceanServer(): Promise<void> {
    const config = this.deployment.config;

    if (!config.digitalocean) {
      throw new Error("DigitalOcean configuration is missing");
    }

    const client = createDigitalOceanClient(config.digitalocean.apiKey);
    const state = readDeploymentState(this.deploymentName);
    const sshKeyName = `clawcontrol-${config.name}`;

    // Check if local SSH keys exist
    let keyPair = loadSSHKeyPair(config.name);
    const localKeysExist = keyPair !== null;

    // If local keys don't exist but we have remote resources, we need to clean up
    if (!localKeysExist && (state.serverId || state.sshKeyId)) {
      this.reportProgress("server_created", "Local SSH keys missing, cleaning up remote resources...");

      if (state.serverId) {
        try {
          await client.deleteDroplet(Number(state.serverId));
          this.reportProgress("server_created", "Deleted existing droplet...");
        } catch (error) {
          if (!(error instanceof DigitalOceanAPIError && error.code === "not_found")) {
            throw error;
          }
        }
      }

      if (state.sshKeyId) {
        try {
          await client.deleteSSHKey(state.sshKeyId);
          this.reportProgress("server_created", "Deleted existing SSH key...");
        } catch (error) {
          if (!(error instanceof DigitalOceanAPIError && error.code === "not_found")) {
            throw error;
          }
        }
      }

      updateDeploymentState(config.name, {
        serverId: undefined,
        serverIp: undefined,
        sshKeyId: undefined,
        sshKeyFingerprint: undefined,
      });
    }

    if (!keyPair) {
      this.reportProgress("server_created", "Generating SSH key pair...");
      keyPair = generateSSHKeyPair(sshKeyName);
      saveSSHKeyPair(config.name, keyPair);
    }

    // Clean up stale SSH keys on DigitalOcean
    const existingKeys = await client.listSSHKeys();
    const existingKey = existingKeys.find((k) => k.name === sshKeyName);
    if (existingKey) {
      this.reportProgress("server_created", "Removing stale SSH key from DigitalOcean...");
      await client.deleteSSHKey(existingKey.id);
    }

    this.reportProgress("server_created", "Uploading SSH key to DigitalOcean...");
    const sshKey = await client.createSSHKey(sshKeyName, keyPair.publicKey);

    updateDeploymentState(config.name, {
      sshKeyId: String(sshKey.id),
      sshKeyFingerprint: sshKey.fingerprint,
    });

    // Remove existing droplet with same name
    const existingDroplets = await client.listDroplets();
    const existingDroplet = existingDroplets.find((d) => d.name === config.name);
    if (existingDroplet) {
      this.reportProgress("server_created", "Removing existing droplet with same name...");
      await client.deleteDroplet(existingDroplet.id);
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }

    this.reportProgress("server_created", "Creating droplet...");
    const result = await client.createDroplet({
      name: config.name,
      size: config.digitalocean.size || "s-1vcpu-2gb",
      image: config.digitalocean.image || "ubuntu-24-04-x64",
      region: config.digitalocean.region || "nyc1",
      ssh_keys: [sshKey.id],
    });

    updateDeploymentState(config.name, {
      serverId: String(result.droplet.id),
    });

    this.reportProgress("server_created", "Waiting for droplet to become active...");
    const droplet = await client.waitForDropletActive(result.droplet.id);

    const publicIp = droplet.networks.v4.find((n) => n.type === "public")?.ip_address;
    if (!publicIp) {
      throw new Error("Droplet has no public IPv4 address");
    }

    updateDeploymentState(config.name, {
      serverIp: publicIp,
    });
  }

  private async uploadSSHKey(): Promise<void> {
    // SSH key is uploaded as part of server creation
    // This checkpoint is for compatibility with resume from this point
    const state = readDeploymentState(this.deploymentName);
    if (!state.sshKeyId) {
      throw new Error("SSH key not found in state");
    }
  }

  private async connectSSH(): Promise<void> {
    const state = readDeploymentState(this.deploymentName);

    if (!state.serverIp) {
      throw new Error("Server IP not found in state");
    }

    const keyPair = loadSSHKeyPair(this.deploymentName);
    if (!keyPair) {
      throw new Error("SSH key pair not found");
    }

    this.reportProgress("ssh_connected", "Waiting for SSH to become available...");

    // Wait for SSH to be available
    await waitForSSH(state.serverIp, keyPair.privateKey, 180000, 5000);

    // Connect
    this.sshConnection = createSSHConnection(state.serverIp, keyPair.privateKey);
    await this.sshConnection.connect();
  }

  private async ensureSSHConnected(): Promise<SSHConnection> {
    // If already connected, return existing connection
    if (this.sshConnection?.isConnected()) {
      return this.sshConnection;
    }

    // Otherwise, establish a new connection
    const state = readDeploymentState(this.deploymentName);
    if (!state.serverIp) {
      throw new Error("Server IP not found in state");
    }

    const keyPair = loadSSHKeyPair(this.deploymentName);
    if (!keyPair) {
      throw new Error("SSH key pair not found");
    }

    this.sshConnection = createSSHConnection(state.serverIp, keyPair.privateKey);
    await this.sshConnection.connect();
    return this.sshConnection;
  }

  private async setupSwap(): Promise<void> {
    const ssh = await this.ensureSSHConnected();
    await SetupScripts.setupSwap(ssh);
  }

  private async updateSystem(): Promise<void> {
    const ssh = await this.ensureSSHConnected();
    await SetupScripts.updateSystem(ssh);
  }

  private async installNVM(): Promise<void> {
    const ssh = await this.ensureSSHConnected();
    await SetupScripts.installNVM(ssh);
  }

  private async installNode(): Promise<void> {
    const ssh = await this.ensureSSHConnected();
    await SetupScripts.installNode(ssh);
  }

  private async installPnpm(): Promise<void> {
    const ssh = await this.ensureSSHConnected();
    await SetupScripts.installPnpm(ssh);
  }

  private async installChrome(): Promise<void> {
    const ssh = await this.ensureSSHConnected();
    await SetupScripts.installChrome(ssh);
  }

  private async installOpenClaw(): Promise<void> {
    const ssh = await this.ensureSSHConnected();
    await SetupScripts.installOpenClaw(ssh);
  }

  private async configureOpenClaw(): Promise<void> {
    const ssh = await this.ensureSSHConnected();
    const customConfig = this.deployment.config.openclawConfig;
    const agentConfig = this.deployment.config.openclawAgent;

    // Generate a secure gateway auth token for dashboard access
    const gatewayToken = randomBytes(32).toString("hex");
    await SetupScripts.configureOpenClaw(ssh, customConfig, agentConfig, gatewayToken);

    // Persist the token locally so /dashboard can use it without SSH
    updateDeploymentState(this.deploymentName, { gatewayToken });

    // Write the environment file with the AI provider API key
    if (agentConfig) {
      this.reportProgress("openclaw_configured", "Writing AI provider environment...");
      await SetupScripts.writeOpenClawEnvFile(ssh, agentConfig);
    }
  }

  private async installTailscale(): Promise<void> {
    if (this.deployment.config.skipTailscale) {
      this.tailscaleSkipped = true;
      this.reportProgress("tailscale_installed", "Tailscale setup skipped.");
      return;
    }

    const ssh = await this.ensureSSHConnected();
    await SetupScripts.installTailscale(ssh);
  }

  private async authenticateTailscale(): Promise<void> {
    if (this.tailscaleSkipped) return;

    const ssh = await this.ensureSSHConnected();

    // Handle resume: if tailscale isn't installed it was skipped previously
    const check = await ssh.exec("which tailscale 2>/dev/null");
    if (check.code !== 0) return;

    // Get the auth URL
    const authUrl = await SetupScripts.getTailscaleAuthUrl(ssh);

    if (authUrl) {
      // Ask user for confirmation before opening browser
      const confirmed = await this.onConfirm(
        `Tailscale needs authentication.\n\n` +
        `Tailscale is a secure networking tool that creates a private VPN between your devices ` +
        `and your OpenClaw server, so the gateway is only accessible to you.\n\n` +
        `What is Tailscale? https://tailscale.com/docs/concepts/what-is-tailscale\n` +
        `OpenClaw Tailscale docs: https://docs.openclaw.ai/gateway/tailscale\n\n` +
        `Would you like to open your browser to authenticate?\n\n` +
        `URL: ${authUrl}`
      );

      if (confirmed) {
        await this.onOpenUrl(authUrl);
      }

      // Wait for authentication to complete
      this.reportProgress("tailscale_authenticated", "Waiting for Tailscale authentication...");
      await SetupScripts.waitForTailscaleAuth(ssh, 300000); // 5 minute timeout
    }
  }

  private async configureTailscale(): Promise<void> {
    if (this.tailscaleSkipped) return;

    const ssh = await this.ensureSSHConnected();

    // Handle resume: if tailscale isn't installed it was skipped previously
    const check = await ssh.exec("which tailscale 2>/dev/null");
    if (check.code !== 0) return;

    const tailscaleIp = await SetupScripts.configureTailscaleServe(ssh);

    updateDeploymentState(this.deploymentName, {
      tailscaleIp,
    });
  }

  private async startDaemon(): Promise<void> {
    const ssh = await this.ensureSSHConnected();
    const state = readDeploymentState(this.deploymentName);

    if (!state.serverIp) {
      throw new Error("Server IP not found");
    }

    // Step 1: Programmatically install the systemd daemon
    this.reportProgress("daemon_started", "Installing OpenClaw systemd service...");
    await SetupScripts.installOpenClawDaemon(ssh);

    // Step 2: Start the daemon
    this.reportProgress("daemon_started", "Starting OpenClaw daemon...");
    await SetupScripts.startOpenClawDaemon(ssh);

    this.reportProgress("daemon_started", "OpenClaw daemon is running.");

    // Step 3: Offer the user to also run openclaw onboard interactively
    const wantsOnboard = await this.onConfirm(
      `Your OpenClaw config has been applied and the daemon is running.\n\n` +
      `Would you like to also run 'openclaw onboard' interactively for additional setup?\n` +
      `(This is optional — your agent is already configured.)`
    );

    if (wantsOnboard) {
      const keyPair = loadSSHKeyPair(this.deploymentName);
      if (!keyPair) {
        throw new Error("SSH key pair not found");
      }

      this.reportProgress("daemon_started", "Opening terminal for optional OpenClaw onboard...");
      await this.onSpawnTerminal(
        this.deploymentName,
        state.serverIp,
        "source ~/.nvm/nvm.sh && openclaw onboard --install-daemon"
      );

      // Re-verify after onboard
      this.reportProgress("daemon_started", "Verifying OpenClaw daemon after onboard...");
      const freshSsh = await this.ensureSSHConnected();
      await new Promise((resolve) => setTimeout(resolve, 3000));

      const statusResult = await freshSsh.exec("systemctl is-active openclaw || true");
      if (!statusResult.stdout.includes("active")) {
        await freshSsh.exec("systemctl restart openclaw || true");
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
  }

  // ============ Progress Reporting ============

  private reportProgress(step: CheckpointName, message: string): void {
    const state = readDeploymentState(this.deploymentName);
    const completedSteps = state.checkpoints.map((cp) => cp.name);
    const currentIndex = CHECKPOINT_ORDER.indexOf(step);
    const progress = (currentIndex / (CHECKPOINT_ORDER.length - 1)) * 100;

    this.onProgress({
      currentStep: step,
      completedSteps,
      totalSteps: CHECKPOINT_ORDER.length,
      progress,
      message,
    });
  }

  private getCheckpointDescription(checkpoint: CheckpointName): string {
    const descriptions: Record<CheckpointName, string> = {
      server_created: "Creating VPS server",
      ssh_key_uploaded: "Uploading SSH keys",
      ssh_connected: "Connecting via SSH",
      swap_configured: "Setting up swap memory",
      system_updated: "Updating system packages",
      nvm_installed: "Installing NVM",
      node_installed: "Installing Node.js",
      pnpm_installed: "Installing pnpm",
      chrome_installed: "Installing Google Chrome",
      openclaw_installed: "Installing OpenClaw",
      openclaw_configured: "Configuring OpenClaw",
      tailscale_installed: "Installing Tailscale",
      tailscale_authenticated: "Authenticating Tailscale",
      tailscale_configured: "Configuring Tailscale",
      daemon_started: "Starting OpenClaw daemon",
      completed: "Deployment complete",
    };
    return descriptions[checkpoint] || checkpoint;
  }
}

/**
 * Start a deployment
 */
export async function startDeployment(
  deploymentName: string,
  onProgress: ProgressCallback,
  onConfirm: ConfirmCallback,
  onOpenUrl: OpenUrlCallback,
  onSpawnTerminal: SpawnTerminalCallback
): Promise<void> {
  const orchestrator = new DeploymentOrchestrator(
    deploymentName,
    onProgress,
    onConfirm,
    onOpenUrl,
    onSpawnTerminal
  );
  await orchestrator.deploy();
}
