import type { SSHConnection } from "../ssh.js";
import type { OpenClawConfig, OpenClawAgentConfig } from "../../types/index.js";

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
 * Configure OpenClaw with browser, gateway, agent, and channel settings.
 * When a gatewayToken is provided it is written to gateway.auth.token so
 * the dashboard requires authentication.
 */
export async function configureOpenClaw(
  ssh: SSHConnection,
  customConfig?: OpenClawConfig,
  agentConfig?: OpenClawAgentConfig,
  gatewayToken?: string
): Promise<void> {
  // Ensure config directory exists
  await ssh.exec("mkdir -p ~/.openclaw");

  // Build the configuration object
  const config: Record<string, unknown> = {
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
      ...(gatewayToken ? { auth: { token: gatewayToken } } : {}),
      tailscale: {
        mode: "serve",
        resetOnExit: false,
      },
      ...customConfig?.gateway,
    },
    commands: {
      native: "auto",
      nativeSkills: "auto",
    },
    messages: {
      ackReactionScope: "group-mentions",
    },
  };

  // Add agent/model config if provided
  if (agentConfig) {
    // Build the model key (e.g., "openrouter/moonshotai/kimi-k2.5")
    const modelKey = `${agentConfig.aiProvider}/${agentConfig.model}`;

    config.agents = {
      defaults: {
        maxConcurrent: 4,
        subagents: {
          maxConcurrent: 8,
        },
        workspace: "/root/.openclaw/workspace",
        models: {
          [`${agentConfig.aiProvider}/auto`]: {
            alias: agentConfig.aiProvider.charAt(0).toUpperCase() + agentConfig.aiProvider.slice(1),
          },
          [modelKey]: {},
        },
        model: {
          primary: modelKey,
        },
      },
    };

    // Add auth profile for the provider
    config.auth = {
      profiles: {
        [`${agentConfig.aiProvider}:default`]: {
          provider: agentConfig.aiProvider,
          mode: "api_key",
        },
      },
    };

    // Add channel config
    if (agentConfig.channel === "telegram" && agentConfig.telegramBotToken) {
      const telegramConfig: Record<string, unknown> = {
        enabled: true,
        botToken: agentConfig.telegramBotToken,
      };

      // Add allowFrom for access control if provided
      if (agentConfig.telegramAllowFrom) {
        telegramConfig.allowFrom = [agentConfig.telegramAllowFrom];
      }

      config.channels = {
        telegram: telegramConfig,
      };

      // Enable the telegram plugin
      config.plugins = {
        entries: {
          telegram: {
            enabled: true,
          },
        },
      };
    }
  }

  // Add wizard and meta timestamps
  const now = new Date().toISOString();
  config.wizard = {
    lastRunAt: now,
    lastRunVersion: "2026.2.3-1",
    lastRunCommand: "onboard",
    lastRunMode: "local",
  };
  config.meta = {
    lastTouchedVersion: "2026.2.3-1",
    lastTouchedAt: now,
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
 * Write environment file with AI provider API key for the OpenClaw daemon
 */
export async function writeOpenClawEnvFile(
  ssh: SSHConnection,
  agentConfig: OpenClawAgentConfig
): Promise<void> {
  // Map provider name to environment variable name
  const envVarMap: Record<string, string> = {
    anthropic: "ANTHROPIC_API_KEY",
    openai: "OPENAI_API_KEY",
    openrouter: "OPENROUTER_API_KEY",
    google: "GOOGLE_API_KEY",
    groq: "GROQ_API_KEY",
  };

  const providerKey = agentConfig.aiProvider.toLowerCase();
  const envVarName = envVarMap[providerKey] || `${agentConfig.aiProvider.toUpperCase()}_API_KEY`;

  const envContent = `# OpenClaw AI Provider Environment
${envVarName}=${agentConfig.aiApiKey}
`;

  await ssh.exec("mkdir -p ~/.openclaw");

  await execOrFail(
    ssh,
    `cat > ~/.openclaw/.env << 'EOFENV'
${envContent}
EOFENV`,
    "Failed to write OpenClaw environment file"
  );

  // Set secure permissions
  await ssh.exec("chmod 600 ~/.openclaw/.env");

  // Verify env was written
  const verifyResult = await ssh.exec("cat ~/.openclaw/.env");
  if (verifyResult.code !== 0 || !verifyResult.stdout.includes(envVarName)) {
    throw new Error("OpenClaw environment file verification failed");
  }
}

/**
 * Programmatically install and enable the OpenClaw systemd daemon service
 */
export async function installOpenClawDaemon(ssh: SSHConnection): Promise<void> {
  const nvmPrefix = "source ~/.nvm/nvm.sh &&";

  // Resolve the openclaw binary path
  const whichResult = await ssh.exec(`${nvmPrefix} which openclaw`);
  if (whichResult.code !== 0 || !whichResult.stdout.trim()) {
    throw new Error("OpenClaw binary not found. Is it installed?");
  }
  const openclawBin = whichResult.stdout.trim();

  // Resolve the node binary path (needed for the service)
  const nodeResult = await ssh.exec(`${nvmPrefix} which node`);
  if (nodeResult.code !== 0 || !nodeResult.stdout.trim()) {
    throw new Error("Node binary not found.");
  }
  const nodeBin = nodeResult.stdout.trim();
  const nodeBinDir = nodeBin.substring(0, nodeBin.lastIndexOf("/"));

  // Build the systemd service unit
  const serviceUnit = `[Unit]
Description=OpenClaw Gateway
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/root
EnvironmentFile=/root/.openclaw/.env
Environment=PATH=${nodeBinDir}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
Environment=HOME=/root
Environment=NVM_DIR=/root/.nvm
ExecStart=${openclawBin} gateway --port 18789
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
`;

  // Write the service file
  await execOrFail(
    ssh,
    `cat > /etc/systemd/system/openclaw.service << 'EOFSERVICE'
${serviceUnit}
EOFSERVICE`,
    "Failed to write OpenClaw systemd service"
  );

  // Reload systemd
  await execOrFail(ssh, "systemctl daemon-reload", "Failed to reload systemd");

  // Enable the service
  await execOrFail(ssh, "systemctl enable openclaw", "Failed to enable OpenClaw service");
}

/**
 * Start the OpenClaw daemon and verify it is running
 */
export async function startOpenClawDaemon(ssh: SSHConnection): Promise<void> {
  await execOrFail(ssh, "systemctl start openclaw", "Failed to start OpenClaw daemon");

  // Wait a moment for service to stabilize
  await new Promise((resolve) => setTimeout(resolve, 3000));

  // Verify the daemon is running
  const statusResult = await ssh.exec("systemctl is-active openclaw || true");
  if (!statusResult.stdout.includes("active")) {
    const logs = await ssh.exec("journalctl -u openclaw -n 20 --no-pager || true");
    throw new Error(`OpenClaw daemon not running after start. Logs: ${logs.stdout}`);
  }
}

/**
 * Run Telegram channel pairing via SSH
 * Returns pairing instructions/URL for the user
 */
export async function pairTelegramChannel(ssh: SSHConnection): Promise<string> {
  const nvmPrefix = "source ~/.nvm/nvm.sh &&";

  // Run the channel login command for Telegram and capture output
  const result = await ssh.exec(
    `${nvmPrefix} openclaw channels login telegram 2>&1 || true`
  );

  const output = result.stdout + result.stderr;

  // Return the full output so the user can follow the pairing instructions
  if (output.trim()) {
    return output.trim();
  }

  return "Telegram channel pairing initiated. Check the OpenClaw gateway logs for pairing status.";
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

/**
 * Get the dashboard URL from a running OpenClaw instance.
 * Tries `openclaw dashboard` first, falls back to reading the gateway auth token.
 * Returns the full URL (with token) and the remote gateway port.
 */
export async function getDashboardUrl(
  ssh: SSHConnection
): Promise<{ url: string; port: number }> {
  const nvmPrefix = "source ~/.nvm/nvm.sh &&";

  // Strategy 1: Run `openclaw dashboard` and parse the URL from output
  const dashResult = await ssh.exec(
    `${nvmPrefix} timeout 10 openclaw dashboard 2>&1 || true`
  );
  const rawOutput = dashResult.stdout + "\n" + dashResult.stderr;
  // Strip ANSI escape codes
  const output = rawOutput.replace(/\x1b\[[0-9;]*m/g, "");

  const urlMatch = output.match(/https?:\/\/[^\s\])'"<>]+/);
  if (urlMatch) {
    try {
      const parsed = new URL(urlMatch[0]);
      return { url: urlMatch[0], port: parseInt(parsed.port) || 18789 };
    } catch {
      // URL parsing failed, continue to fallback
    }
  }

  // Strategy 2: Read the gateway auth token from config
  const tokenResult = await ssh.exec(
    `${nvmPrefix} openclaw config get gateway.auth.token 2>/dev/null || true`
  );
  const token = tokenResult.stdout.trim().replace(/^["']|["']$/g, "");

  if (token) {
    return {
      url: `http://127.0.0.1:18789/?token=${encodeURIComponent(token)}`,
      port: 18789,
    };
  }

  // Strategy 3: Verify gateway is running at all
  const statusResult = await ssh.exec(
    "systemctl is-active openclaw 2>/dev/null || true"
  );
  if (statusResult.stdout.trim() !== "active") {
    throw new Error("OpenClaw gateway is not running on this server");
  }

  throw new Error(
    "Could not retrieve dashboard URL. Try running 'openclaw dashboard' on the server manually."
  );
}
