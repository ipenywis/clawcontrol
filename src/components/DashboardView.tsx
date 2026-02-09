import { useState, useCallback } from "react";
import { useKeyboard, useRenderer } from "@opentui/react";
import { spawnSync } from "child_process";
import { platform } from "os";
import type { AppContext } from "../App.js";
import type { Deployment } from "../types/index.js";
import {
  startTunnel,
  stopTunnel,
  getTunnel,
  getActiveTunnels,
  type ActiveTunnel,
} from "../services/tunnel.js";
import { connectToDeployment } from "../services/ssh.js";
import { getDashboardUrl } from "../services/setup/index.js";
import { t } from "../theme.js";

interface Props {
  context: AppContext;
}

type ViewState = "selecting" | "connecting" | "active" | "error";

/**
 * Open a URL in the user's default browser
 */
function openInBrowser(url: string): boolean {
  try {
    if (platform() === "darwin") {
      spawnSync("open", [url]);
    } else {
      spawnSync("xdg-open", [url]);
    }
    return true;
  } catch {
    return false;
  }
}

export function DashboardView({ context }: Props) {
  const renderer = useRenderer();
  const [viewState, setViewState] = useState<ViewState>("selecting");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [activeTunnel, setActiveTunnel] = useState<ActiveTunnel | null>(null);
  const [dashboardUrl, setDashboardUrl] = useState<string | null>(null);
  const [connectMessage, setConnectMessage] = useState("");
  const [copied, setCopied] = useState(false);

  const deployedDeployments = context.deployments.filter(
    (d) => d.state.status === "deployed" && d.state.serverIp
  );

  const connectToDashboard = useCallback(async (deployment: Deployment) => {
    setViewState("connecting");
    setError(null);
    setCopied(false);
    setConnectMessage("Establishing SSH tunnel...");

    try {
      const serverIp = deployment.state.serverIp!;
      const remotePort =
        deployment.config.openclawConfig?.gateway?.port || 18789;

      // Start or reuse tunnel
      const tunnel = await startTunnel(
        deployment.config.name,
        serverIp,
        remotePort
      );
      setActiveTunnel(tunnel);

      // If URL is already cached on the tunnel, skip the fetch
      if (tunnel.dashboardUrl) {
        setDashboardUrl(tunnel.dashboardUrl);
        setViewState("active");
        return;
      }

      setConnectMessage("Retrieving dashboard URL...");

      // Fast path: build URL from the locally stored gateway token
      const localToken = deployment.state.gatewayToken;
      if (localToken) {
        const localUrl = `http://127.0.0.1:${tunnel.localPort}/?token=${encodeURIComponent(localToken)}`;
        tunnel.dashboardUrl = localUrl;
        setDashboardUrl(localUrl);
        setViewState("active");
        return;
      }

      // Fallback for older deployments: SSH in and run `openclaw dashboard`
      const ssh = await connectToDeployment(
        deployment.config.name,
        serverIp
      );
      try {
        const info = await getDashboardUrl(ssh);

        // Replace the remote host:port with our local tunnel port
        const parsed = new URL(info.url);
        parsed.hostname = "127.0.0.1";
        parsed.port = String(tunnel.localPort);
        const localUrl = parsed.toString();

        tunnel.dashboardUrl = localUrl;
        setDashboardUrl(localUrl);
        setViewState("active");
      } finally {
        ssh.disconnect();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setViewState("error");
    }
  }, []);

  useKeyboard((key) => {
    if (viewState === "selecting") {
      if (deployedDeployments.length === 0) {
        if (key.name === "escape" || key.name === "return") {
          context.navigateTo("home");
        }
        return;
      }

      if (key.name === "up" && selectedIndex > 0) {
        setSelectedIndex(selectedIndex - 1);
      } else if (
        key.name === "down" &&
        selectedIndex < deployedDeployments.length - 1
      ) {
        setSelectedIndex(selectedIndex + 1);
      } else if (key.name === "return") {
        const deployment = deployedDeployments[selectedIndex];

        // If tunnel is already active with a cached URL, jump straight to active view
        const existing = getTunnel(deployment.config.name);
        if (existing && existing.dashboardUrl) {
          setActiveTunnel(existing);
          setDashboardUrl(existing.dashboardUrl);
          setViewState("active");
          return;
        }

        connectToDashboard(deployment);
      } else if (key.name === "escape") {
        context.navigateTo("home");
      }
    } else if (viewState === "active") {
      if (key.sequence === "o" || key.sequence === "O") {
        if (dashboardUrl) openInBrowser(dashboardUrl);
      } else if (key.sequence === "c" || key.sequence === "C") {
        if (dashboardUrl) {
          renderer.copyToClipboardOSC52(dashboardUrl);
          setCopied(true);
          setTimeout(() => setCopied(false), 3000);
        }
      } else if (key.sequence === "d" || key.sequence === "D") {
        if (activeTunnel) {
          stopTunnel(activeTunnel.deploymentName);
          setActiveTunnel(null);
          setDashboardUrl(null);
          setViewState("selecting");
        }
      } else if (key.name === "escape") {
        // Go back to selecting — tunnel stays active
        setViewState("selecting");
      }
    } else if (viewState === "error") {
      if (key.name === "escape" || key.name === "return") {
        setViewState("selecting");
      }
    }
    // No keyboard handling during "connecting" — just wait
  });

  // ── No deployed deployments ──────────────────────────────────────────
  if (deployedDeployments.length === 0) {
    return (
      <box flexDirection="column" width="100%" padding={1}>
        <box flexDirection="row" marginBottom={2}>
          <text fg={t.accent}>/dashboard</text>
          <text fg={t.fg.secondary}> - Open OpenClaw dashboard</text>
        </box>

        <box
          flexDirection="column"
          borderStyle="single"
          borderColor={t.border.default}
          padding={1}
        >
          <text fg={t.status.warning}>No deployed instances found!</text>
          <text fg={t.fg.secondary} marginTop={1}>
            Deploy an instance first with /deploy
          </text>
        </box>

        <text fg={t.fg.muted} marginTop={2}>
          Press any key to return to home
        </text>
      </box>
    );
  }

  // ── Selecting ────────────────────────────────────────────────────────
  if (viewState === "selecting") {
    const tunnels = getActiveTunnels();

    return (
      <box flexDirection="column" width="100%" padding={1}>
        <box flexDirection="row" marginBottom={2}>
          <text fg={t.accent}>/dashboard</text>
          <text fg={t.fg.secondary}>
            {" "}
            - Select a deployment to open its dashboard
          </text>
        </box>

        {tunnels.length > 0 && (
          <box
            flexDirection="column"
            borderStyle="single"
            borderColor={t.status.success}
            padding={1}
            marginBottom={1}
          >
            <text fg={t.status.success}>
              {tunnels.length} active tunnel{tunnels.length > 1 ? "s" : ""}
            </text>
            {tunnels.map((tun) => (
              <text key={tun.deploymentName} fg={t.fg.secondary}>
                {tun.deploymentName}: 127.0.0.1:{tun.localPort} →{" "}
                {tun.serverIp}:{tun.remotePort}
              </text>
            ))}
          </box>
        )}

        <box
          flexDirection="column"
          borderStyle="single"
          borderColor={t.border.default}
          padding={1}
          marginBottom={1}
        >
          {deployedDeployments.map((deployment, index) => {
            const isSelected = index === selectedIndex;
            const hasTunnel =
              getTunnel(deployment.config.name) !== null;

            return (
              <box
                key={deployment.config.name}
                flexDirection="row"
                backgroundColor={isSelected ? t.selection.bg : undefined}
              >
                <text fg={isSelected ? t.selection.fg : t.fg.secondary}>
                  {isSelected ? "> " : "  "}
                </text>
                <text
                  fg={isSelected ? t.selection.fg : t.fg.primary}
                  width={25}
                >
                  {deployment.config.name}
                </text>
                <text fg={t.accent} width={18}>
                  {deployment.state.serverIp}
                </text>
                {hasTunnel && (
                  <text fg={t.status.success}>[tunnel active]</text>
                )}
              </box>
            );
          })}
        </box>

        <text fg={t.fg.muted}>
          Arrow keys to select | Enter to connect | Esc to go back
        </text>
      </box>
    );
  }

  // ── Connecting ───────────────────────────────────────────────────────
  if (viewState === "connecting") {
    return (
      <box flexDirection="column" width="100%" padding={1}>
        <box flexDirection="row" marginBottom={2}>
          <text fg={t.accent}>/dashboard</text>
          <text fg={t.fg.secondary}> - Connecting...</text>
        </box>

        <box
          flexDirection="column"
          borderStyle="single"
          borderColor={t.border.focus}
          padding={1}
        >
          <text fg={t.status.info}>{connectMessage}</text>
          <text fg={t.fg.muted} marginTop={1}>
            This may take a few seconds...
          </text>
        </box>
      </box>
    );
  }

  // ── Active ───────────────────────────────────────────────────────────
  if (viewState === "active" && activeTunnel && dashboardUrl) {
    return (
      <box flexDirection="column" width="100%" padding={1}>
        <box flexDirection="row" marginBottom={2}>
          <text fg={t.status.success}>/dashboard</text>
          <text fg={t.fg.secondary}>
            {" "}
            - {activeTunnel.deploymentName}
          </text>
        </box>

        <box
          flexDirection="column"
          borderStyle="double"
          borderColor={t.status.success}
          padding={1}
          marginBottom={1}
        >
          <text fg={t.status.success}>Dashboard Ready</text>
          <text fg={t.fg.primary} marginTop={1}>
            Tunnel: 127.0.0.1:{activeTunnel.localPort} →{" "}
            {activeTunnel.serverIp}:{activeTunnel.remotePort}
          </text>
        </box>

        <box
          flexDirection="column"
          borderStyle="single"
          borderColor={t.accent}
          padding={1}
          marginBottom={1}
        >
          <text fg={t.fg.secondary}>Dashboard URL:</text>
          <text fg={t.accent} marginTop={1}>
            {dashboardUrl}
          </text>
        </box>

        <box flexDirection="column" marginBottom={1}>
          <box flexDirection="row">
            <text fg={t.accent} width={4}>
              O
            </text>
            <text fg={t.fg.primary}>Open in browser</text>
          </box>
          <box flexDirection="row">
            <text fg={t.accent} width={4}>
              C
            </text>
            <text fg={t.fg.primary}>Copy URL to clipboard</text>
          </box>
          <box flexDirection="row">
            <text fg={t.accent} width={4}>
              D
            </text>
            <text fg={t.fg.primary}>Disconnect tunnel</text>
          </box>
          <box flexDirection="row">
            <text fg={t.accent} width={4}>
              Esc
            </text>
            <text fg={t.fg.primary}>
              Back to selection (tunnel stays active)
            </text>
          </box>
        </box>

        {copied && (
          <text fg={t.status.success}>URL copied to clipboard!</text>
        )}
      </box>
    );
  }

  // ── Error ────────────────────────────────────────────────────────────
  if (viewState === "error") {
    return (
      <box flexDirection="column" width="100%" padding={1}>
        <box flexDirection="row" marginBottom={2}>
          <text fg={t.status.error}>/dashboard</text>
          <text fg={t.fg.secondary}> - Connection failed</text>
        </box>

        <box
          flexDirection="column"
          borderStyle="single"
          borderColor={t.status.error}
          padding={1}
          marginBottom={1}
        >
          <text fg={t.status.error}>{error}</text>
        </box>

        <text fg={t.fg.muted}>Press Enter or Esc to go back</text>
      </box>
    );
  }

  return null;
}
