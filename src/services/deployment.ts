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
import { createHetznerClient, HetznerAPIError } from "../providers/hetzner/api.js";
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

      this.reportProgress(checkpoint, `Starting: ${this.getCheckpointDescription(checkpoint)}`);

      while (retryCount < MAX_RETRIES) {
        try {
          await this.executeCheckpoint(checkpoint);
          markCheckpointComplete(this.deploymentName, checkpoint, retryCount);
          break;
        } catch (error) {
          retryCount++;
          const errorMessage = error instanceof Error ? error.message : String(error);

          updateDeploymentState(this.deploymentName, {
            lastError: errorMessage,
            status: "failed",
          });

          if (retryCount >= MAX_RETRIES) {
            // Ask user what to do
            const shouldContinue = await this.onConfirm(
              `Step "${this.getCheckpointDescription(checkpoint)}" failed ${MAX_RETRIES} times.\n` +
              `Last error: ${errorMessage}\n\n` +
              `Would you like to retry from the beginning?`
            );

            if (shouldContinue) {
              // Reset to first checkpoint and restart
              resetToCheckpoint(this.deploymentName, CHECKPOINT_ORDER[0]);
              await this.executeFromCheckpoint(CHECKPOINT_ORDER[0]);
              return;
            } else {
              throw new DeploymentError(
                `Deployment failed at ${checkpoint}: ${errorMessage}`,
                checkpoint,
                retryCount,
                false
              );
            }
          }

          // Wait before retry
          await new Promise((resolve) => setTimeout(resolve, 5000));
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

    if (config.provider !== "hetzner" || !config.hetzner) {
      throw new Error("Only Hetzner is supported at this time");
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

      // Delete existing server if any
      if (state.serverId) {
        try {
          await client.deleteServer(Number(state.serverId));
          this.reportProgress("server_created", "Deleted existing server...");
        } catch (error) {
          // Ignore if server doesn't exist
          if (!(error instanceof HetznerAPIError && error.code === "not_found")) {
            throw error;
          }
        }
      }

      // Delete existing SSH key from Hetzner if any
      if (state.sshKeyId) {
        try {
          await client.deleteSSHKey(Number(state.sshKeyId));
          this.reportProgress("server_created", "Deleted existing SSH key...");
        } catch (error) {
          // Ignore if key doesn't exist
          if (!(error instanceof HetznerAPIError && error.code === "not_found")) {
            throw error;
          }
        }
      }

      // Reset state
      updateDeploymentState(config.name, {
        serverId: undefined,
        serverIp: undefined,
        sshKeyId: undefined,
        sshKeyFingerprint: undefined,
      });
    }

    // Generate new SSH key pair if needed
    if (!keyPair) {
      this.reportProgress("server_created", "Generating SSH key pair...");
      keyPair = generateSSHKeyPair(sshKeyName);
      saveSSHKeyPair(config.name, keyPair);
    }

    // Check if SSH key already exists on Hetzner with the same name and delete it
    // (in case of previous partial cleanup)
    const existingKeys = await client.listSSHKeys();
    const existingKey = existingKeys.find((k) => k.name === sshKeyName);
    if (existingKey) {
      this.reportProgress("server_created", "Removing stale SSH key from Hetzner...");
      await client.deleteSSHKey(existingKey.id);
    }

    // Upload SSH key to Hetzner
    this.reportProgress("server_created", "Uploading SSH key to Hetzner...");
    const sshKey = await client.createSSHKey(sshKeyName, keyPair.publicKey);

    updateDeploymentState(config.name, {
      sshKeyId: String(sshKey.id),
      sshKeyFingerprint: sshKey.fingerprint,
    });

    // Check if server already exists with the same name and delete it
    const existingServers = await client.listServers();
    const existingServer = existingServers.find((s) => s.name === config.name);
    if (existingServer) {
      this.reportProgress("server_created", "Removing existing server with same name...");
      await client.deleteServer(existingServer.id);
      // Wait a bit for deletion to complete
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }

    // Create server - using cpx11 for US-East (best price at $4.99/mo)
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

    // Wait for server to be running
    this.reportProgress("server_created", "Waiting for server to start...");
    const server = await client.waitForServerRunning(result.server.id);

    updateDeploymentState(config.name, {
      serverIp: server.public_net.ipv4.ip,
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
    await SetupScripts.configureOpenClaw(ssh, customConfig);
  }

  private async installTailscale(): Promise<void> {
    const ssh = await this.ensureSSHConnected();
    await SetupScripts.installTailscale(ssh);
  }

  private async authenticateTailscale(): Promise<void> {
    const ssh = await this.ensureSSHConnected();

    // Get the auth URL
    const authUrl = await SetupScripts.getTailscaleAuthUrl(ssh);

    if (authUrl) {
      // Ask user for confirmation before opening browser
      const confirmed = await this.onConfirm(
        `Tailscale needs authentication.\n\n` +
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
    const ssh = await this.ensureSSHConnected();
    const tailscaleIp = await SetupScripts.configureTailscaleServe(ssh);

    updateDeploymentState(this.deploymentName, {
      tailscaleIp,
    });
  }

  private async startDaemon(): Promise<void> {
    const state = readDeploymentState(this.deploymentName);
    if (!state.serverIp) {
      throw new Error("Server IP not found");
    }

    const keyPair = loadSSHKeyPair(this.deploymentName);
    if (!keyPair) {
      throw new Error("SSH key pair not found");
    }

    // Ask user to complete OpenClaw onboarding interactively
    const confirmed = await this.onConfirm(
      `OpenClaw needs interactive setup.\n\n` +
      `You will be connected to the server to run the onboarding command.\n` +
      `Please complete the setup and then type 'exit' to continue deployment.\n\n` +
      `Ready to connect?`
    );

    if (!confirmed) {
      throw new Error("User cancelled OpenClaw setup");
    }

    // Spawn a real terminal window for interactive SSH session
    this.reportProgress("daemon_started", "Opening terminal for OpenClaw setup...");
    await this.onSpawnTerminal(
      this.deploymentName,
      state.serverIp,
      "source ~/.nvm/nvm.sh && openclaw onboard --install-daemon"
    );

    // Verify the daemon is running after user completes setup
    this.reportProgress("daemon_started", "Verifying OpenClaw daemon...");
    const ssh = await this.ensureSSHConnected();

    // Wait a moment for service to stabilize
    await new Promise((resolve) => setTimeout(resolve, 3000));

    const statusResult = await ssh.exec("systemctl is-active openclaw || true");
    if (!statusResult.stdout.includes("active")) {
      // Check if it was installed but not started
      const serviceExists = await ssh.exec("systemctl list-unit-files | grep openclaw || true");
      if (serviceExists.stdout.includes("openclaw")) {
        await ssh.exec("systemctl start openclaw || true");
        await new Promise((resolve) => setTimeout(resolve, 2000));

        const retryStatus = await ssh.exec("systemctl is-active openclaw || true");
        if (!retryStatus.stdout.includes("active")) {
          const logs = await ssh.exec("journalctl -u openclaw -n 20 --no-pager || true");
          throw new Error(`OpenClaw daemon not running after setup. Logs: ${logs.stdout}`);
        }
      } else {
        throw new Error("OpenClaw daemon was not installed. Please run setup again.");
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
