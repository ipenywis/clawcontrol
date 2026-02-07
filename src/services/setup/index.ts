import type { SSHConnection } from "../ssh.js";
import type { OpenClawConfig } from "../../types/index.js";

/**
 * Execute a command and throw if it fails
 */
async function execOrFail(
  ssh: SSHConnection,
  command: string,
  errorMessage: string
): Promise<string> {
  const result = await ssh.exec(command);
  if (result.code !== 0) {
    throw new Error(`${errorMessage}: ${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

/**
 * Setup 4GB swap file for low memory servers
 */
export async function setupSwap(ssh: SSHConnection): Promise<void> {
  // Check if swap already exists
  const checkResult = await ssh.exec("swapon --show");
  if (checkResult.stdout.includes("/swapfile")) {
    return; // Swap already configured
  }

  const commands = [
    // Create 4GB swap file
    "fallocate -l 4G /swapfile",
    // Set permissions
    "chmod 600 /swapfile",
    // Setup swap area
    "mkswap /swapfile",
    // Enable swap
    "swapon /swapfile",
    // Make permanent
    "echo '/swapfile none swap sw 0 0' >> /etc/fstab",
    // Increase swappiness
    "sysctl vm.swappiness=100",
    "echo 'vm.swappiness=100' >> /etc/sysctl.conf",
  ];

  for (const cmd of commands) {
    await execOrFail(ssh, cmd, "Failed to setup swap");
  }

  // Verify swap is active
  const verifyResult = await ssh.exec("free -h | grep -i swap");
  if (!verifyResult.stdout.includes("4.0G") && !verifyResult.stdout.includes("4G")) {
    throw new Error("Swap verification failed");
  }
}

/**
 * Update system packages
 */
export async function updateSystem(ssh: SSHConnection): Promise<void> {
  // Set non-interactive mode for apt
  const aptEnv = "DEBIAN_FRONTEND=noninteractive";

  await execOrFail(
    ssh,
    `${aptEnv} apt-get update`,
    "Failed to update package lists"
  );

  await execOrFail(
    ssh,
    `${aptEnv} apt-get upgrade -y`,
    "Failed to upgrade packages"
  );

  // Install essential dependencies
  await execOrFail(
    ssh,
    `${aptEnv} apt-get install -y curl wget git build-essential`,
    "Failed to install essential packages"
  );
}

/**
 * Install NVM (Node Version Manager)
 */
export async function installNVM(ssh: SSHConnection): Promise<void> {
  // Check if NVM is already installed
  const checkResult = await ssh.exec("source ~/.nvm/nvm.sh 2>/dev/null && nvm --version");
  if (checkResult.code === 0 && checkResult.stdout.trim()) {
    return; // NVM already installed
  }

  // Install NVM
  await execOrFail(
    ssh,
    "curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash",
    "Failed to install NVM"
  );

  // Add NVM to bashrc if not already there
  await ssh.exec(`
    if ! grep -q 'NVM_DIR' ~/.bashrc; then
      echo 'export NVM_DIR="$HOME/.nvm"' >> ~/.bashrc
      echo '[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"' >> ~/.bashrc
      echo '[ -s "$NVM_DIR/bash_completion" ] && . "$NVM_DIR/bash_completion"' >> ~/.bashrc
    fi
  `);

  // Verify installation
  const verifyResult = await ssh.exec("source ~/.nvm/nvm.sh && nvm --version");
  if (verifyResult.code !== 0) {
    throw new Error("NVM installation verification failed");
  }
}

/**
 * Install Node.js LTS using NVM
 */
export async function installNode(ssh: SSHConnection): Promise<void> {
  // Source NVM and install Node.js LTS
  const nvmPrefix = "source ~/.nvm/nvm.sh &&";

  // Check if Node is already installed
  const checkResult = await ssh.exec(`${nvmPrefix} node --version`);
  if (checkResult.code === 0 && checkResult.stdout.includes("v")) {
    return; // Node already installed
  }

  await execOrFail(
    ssh,
    `${nvmPrefix} nvm install --lts`,
    "Failed to install Node.js LTS"
  );

  await execOrFail(
    ssh,
    `${nvmPrefix} nvm alias default lts/*`,
    "Failed to set default Node.js version"
  );

  // Verify installation
  const verifyResult = await ssh.exec(`${nvmPrefix} node --version`);
  if (verifyResult.code !== 0 || !verifyResult.stdout.includes("v")) {
    throw new Error("Node.js installation verification failed");
  }
}

/**
 * Install pnpm package manager
 */
export async function installPnpm(ssh: SSHConnection): Promise<void> {
  const nvmPrefix = "source ~/.nvm/nvm.sh &&";

  // Check if pnpm is already installed
  const checkResult = await ssh.exec(`${nvmPrefix} pnpm --version`);
  if (checkResult.code === 0 && checkResult.stdout.trim()) {
    return; // pnpm already installed
  }

  await execOrFail(
    ssh,
    `${nvmPrefix} npm install -g pnpm`,
    "Failed to install pnpm"
  );

  // Verify installation
  const verifyResult = await ssh.exec(`${nvmPrefix} pnpm --version`);
  if (verifyResult.code !== 0) {
    throw new Error("pnpm installation verification failed");
  }
}

/**
 * Install Google Chrome (stable)
 */
export async function installChrome(ssh: SSHConnection): Promise<void> {
  // Check if Chrome is already installed
  const checkResult = await ssh.exec("which google-chrome");
  if (checkResult.code === 0 && checkResult.stdout.includes("google-chrome")) {
    return; // Chrome already installed
  }

  const aptEnv = "DEBIAN_FRONTEND=noninteractive";

  // Download Chrome
  await execOrFail(
    ssh,
    "wget -q https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb -O /tmp/chrome.deb",
    "Failed to download Google Chrome"
  );

  // Install Chrome (apt install will handle dependencies)
  await execOrFail(
    ssh,
    `${aptEnv} apt-get install -y /tmp/chrome.deb`,
    "Failed to install Google Chrome"
  );

  // Clean up
  await ssh.exec("rm -f /tmp/chrome.deb");

  // Verify installation
  const verifyResult = await ssh.exec("google-chrome --version");
  if (verifyResult.code !== 0) {
    throw new Error("Google Chrome installation verification failed");
  }
}

/**
 * Install OpenClaw
 */
export async function installOpenClaw(ssh: SSHConnection): Promise<void> {
  const nvmPrefix = "source ~/.nvm/nvm.sh &&";

  // Check if openclaw is already installed
  const checkResult = await ssh.exec(`${nvmPrefix} openclaw --version`);
  if (checkResult.code === 0 && checkResult.stdout.trim()) {
    return; // OpenClaw already installed
  }

  // Install openclaw globally
  await execOrFail(
    ssh,
    `${nvmPrefix} curl -fsSL https://openclaw.ai/install.sh | bash`,
    "Failed to install OpenClaw"
  );

  // Verify installation
  const verifyResult = await ssh.exec(`${nvmPrefix} openclaw --version`);
  if (verifyResult.code !== 0) {
    throw new Error("OpenClaw installation verification failed");
  }
}

/**
 * Configure OpenClaw with browser and gateway settings
 */
export async function configureOpenClaw(
  ssh: SSHConnection,
  customConfig?: OpenClawConfig
): Promise<void> {
  // Ensure config directory exists
  await ssh.exec("mkdir -p ~/.openclaw");

  // Build the configuration object
  const config = {
    browser: {
      enabled: true,
      remoteCdpTimeoutMs: 15000,
      remoteCdpHandshakeTimeoutMs: 3000,
      defaultProfile: "openclaw",
      color: "#FF4500",
      headless: true,
      noSandbox: true,
      attachOnly: false,
      executablePath: "/usr/bin/google-chrome",
      profiles: {
        openclaw: { cdpPort: 18800, color: "#FF4500" },
      },
      ...customConfig?.browser,
    },
    gateway: {
      port: 18789,
      mode: "local",
      bind: "loopback",
      tailscale: {
        mode: "serve",
        resetOnExit: false,
      },
      ...customConfig?.gateway,
    },
  };

  // Write configuration file
  const configJson = JSON.stringify(config, null, 2);
  await execOrFail(
    ssh,
    `cat > ~/.openclaw/openclaw.json << 'EOFCONFIG'
${configJson}
EOFCONFIG`,
    "Failed to write OpenClaw configuration"
  );

  // Verify config was written
  const verifyResult = await ssh.exec("cat ~/.openclaw/openclaw.json");
  if (verifyResult.code !== 0 || !verifyResult.stdout.includes("browser")) {
    throw new Error("OpenClaw configuration verification failed");
  }
}

/**
 * Install Tailscale
 */
export async function installTailscale(ssh: SSHConnection): Promise<void> {
  // Check if Tailscale is already installed
  const checkResult = await ssh.exec("which tailscale");
  if (checkResult.code === 0 && checkResult.stdout.includes("tailscale")) {
    return; // Tailscale already installed
  }

  await execOrFail(
    ssh,
    "curl -fsSL https://tailscale.com/install.sh | sh",
    "Failed to install Tailscale"
  );

  // Enable and start tailscaled service
  await ssh.exec("systemctl enable tailscaled");
  await ssh.exec("systemctl start tailscaled");

  // Verify installation
  const verifyResult = await ssh.exec("tailscale --version");
  if (verifyResult.code !== 0) {
    throw new Error("Tailscale installation verification failed");
  }
}

/**
 * Get Tailscale authentication URL
 * Returns the URL or null if already authenticated
 */
export async function getTailscaleAuthUrl(ssh: SSHConnection): Promise<string | null> {
  // Check if already connected
  const statusResult = await ssh.exec("tailscale status --json");
  if (statusResult.code === 0) {
    try {
      const status = JSON.parse(statusResult.stdout);
      if (status.BackendState === "Running" && status.Self?.Online) {
        return null; // Already authenticated
      }
    } catch {
      // Continue to get auth URL
    }
  }

  // Start tailscale up in background and capture auth URL
  const upResult = await ssh.exec(
    "timeout 10 tailscale up 2>&1 | grep -oP 'https://[^\\s]+' | head -1"
  );

  if (upResult.stdout.trim().startsWith("https://")) {
    return upResult.stdout.trim();
  }

  // Try alternate method
  const loginResult = await ssh.exec(
    "tailscale login 2>&1 | grep -oP 'https://[^\\s]+' | head -1"
  );

  if (loginResult.stdout.trim().startsWith("https://")) {
    return loginResult.stdout.trim();
  }

  return null;
}

/**
 * Wait for Tailscale authentication to complete
 */
export async function waitForTailscaleAuth(
  ssh: SSHConnection,
  timeoutMs: number = 300000
): Promise<void> {
  const startTime = Date.now();
  const pollInterval = 5000;

  while (Date.now() - startTime < timeoutMs) {
    const statusResult = await ssh.exec("tailscale status --json");

    if (statusResult.code === 0) {
      try {
        const status = JSON.parse(statusResult.stdout);
        if (status.BackendState === "Running" && status.Self?.Online) {
          return; // Authenticated!
        }
      } catch {
        // Continue waiting
      }
    }

    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  throw new Error("Tailscale authentication timed out");
}

/**
 * Configure Tailscale serve for OpenClaw gateway
 * Returns the Tailscale IP address
 */
export async function configureTailscaleServe(ssh: SSHConnection): Promise<string> {
  // Get Tailscale IP
  const ipResult = await ssh.exec("tailscale ip -4");
  if (ipResult.code !== 0 || !ipResult.stdout.trim()) {
    throw new Error("Failed to get Tailscale IP");
  }
  const tailscaleIp = ipResult.stdout.trim();

  // Configure Tailscale serve for the gateway port
  await execOrFail(
    ssh,
    "tailscale serve --bg 18789",
    "Failed to configure Tailscale serve"
  );

  return tailscaleIp;
}

/**
 * Start OpenClaw as a daemon service
 * Note: This is now handled interactively via `openclaw onboard --install-daemon`
 * This function just verifies the daemon is running after interactive setup
 */
export async function verifyOpenClawDaemon(ssh: SSHConnection): Promise<void> {
  // Verify daemon is running
  const statusResult = await ssh.exec("systemctl is-active openclaw || true");
  if (!statusResult.stdout.includes("active")) {
    // Check logs for errors
    const logs = await ssh.exec("journalctl -u openclaw -n 30 --no-pager || true");
    throw new Error(`OpenClaw daemon is not running. Logs: ${logs.stdout || logs.stderr}`);
  }
}

/**
 * Check if OpenClaw daemon is running
 */
export async function isOpenClawRunning(ssh: SSHConnection): Promise<boolean> {
  const result = await ssh.exec("systemctl is-active openclaw");
  return result.stdout.trim() === "active";
}

/**
 * Get OpenClaw logs
 */
export async function getOpenClawLogs(
  ssh: SSHConnection,
  lines: number = 100
): Promise<string> {
  const result = await ssh.exec(`journalctl -u openclaw -n ${lines} --no-pager`);
  return result.stdout;
}

/**
 * Restart OpenClaw daemon
 */
export async function restartOpenClawDaemon(ssh: SSHConnection): Promise<void> {
  await execOrFail(
    ssh,
    "systemctl restart openclaw",
    "Failed to restart OpenClaw daemon"
  );
}
