import { spawn, type ChildProcess } from "child_process";
import { createServer } from "net";
import { getSSHKeyPath } from "./config.js";

export interface ActiveTunnel {
  deploymentName: string;
  serverIp: string;
  localPort: number;
  remotePort: number;
  process: ChildProcess;
  dashboardUrl: string | null;
  startedAt: string;
}

/** Module-level state — tunnels persist across view changes */
const activeTunnels = new Map<string, ActiveTunnel>();

/**
 * Check if a local port is available for binding
 */
function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

/**
 * Find the next available local port starting from startPort.
 * Scans up to 100 ports ahead to handle cases where multiple
 * tunnels are bound to the same default gateway port.
 */
export async function findAvailablePort(startPort: number): Promise<number> {
  for (let port = startPort; port < startPort + 100; port++) {
    if (await isPortAvailable(port)) return port;
  }
  throw new Error(`No available port found in range ${startPort}–${startPort + 99}`);
}

/**
 * Start an SSH tunnel for a deployment.
 * If a live tunnel already exists for this deployment, returns it.
 */
export async function startTunnel(
  deploymentName: string,
  serverIp: string,
  remotePort: number = 18789
): Promise<ActiveTunnel> {
  const existing = getTunnel(deploymentName);
  if (existing) return existing;

  const sshKeyPath = getSSHKeyPath(deploymentName);
  const localPort = await findAvailablePort(remotePort);

  const proc = spawn("ssh", [
    "-N",
    "-L", `${localPort}:127.0.0.1:${remotePort}`,
    "-i", sshKeyPath,
    "-o", "StrictHostKeyChecking=no",
    "-o", "UserKnownHostsFile=/dev/null",
    "-o", "ServerAliveInterval=15",
    "-o", "ServerAliveCountMax=3",
    "-o", "ExitOnForwardFailure=yes",
    `root@${serverIp}`,
  ], {
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });

  const tunnel: ActiveTunnel = {
    deploymentName,
    serverIp,
    localPort,
    remotePort,
    process: proc,
    dashboardUrl: null,
    startedAt: new Date().toISOString(),
  };

  activeTunnels.set(deploymentName, tunnel);

  // Auto-cleanup when the tunnel process exits
  proc.on("exit", () => {
    activeTunnels.delete(deploymentName);
  });

  // Give the tunnel time to establish (or fail immediately)
  await new Promise((resolve) => setTimeout(resolve, 2500));

  if (proc.exitCode !== null || proc.killed) {
    activeTunnels.delete(deploymentName);
    throw new Error("SSH tunnel failed to establish. Check that the server is reachable.");
  }

  return tunnel;
}

/**
 * Stop and clean up a tunnel for a deployment
 */
export function stopTunnel(deploymentName: string): void {
  const tunnel = activeTunnels.get(deploymentName);
  if (tunnel) {
    tunnel.process.kill();
    activeTunnels.delete(deploymentName);
  }
}

/**
 * Get the active tunnel for a deployment, or null if none/dead
 */
export function getTunnel(deploymentName: string): ActiveTunnel | null {
  const tunnel = activeTunnels.get(deploymentName);
  if (tunnel && tunnel.process.exitCode === null && !tunnel.process.killed) {
    return tunnel;
  }
  // Clean up stale entry
  if (tunnel) activeTunnels.delete(deploymentName);
  return null;
}

/**
 * Get all currently active tunnels (purges dead ones)
 */
export function getActiveTunnels(): ActiveTunnel[] {
  for (const [name, tunnel] of activeTunnels) {
    if (tunnel.process.exitCode !== null || tunnel.process.killed) {
      activeTunnels.delete(name);
    }
  }
  return Array.from(activeTunnels.values());
}

/**
 * Stop all active tunnels (called on process exit)
 */
export function stopAllTunnels(): void {
  for (const [, tunnel] of activeTunnels) {
    tunnel.process.kill();
  }
  activeTunnels.clear();
}
