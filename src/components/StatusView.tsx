import { useState } from "react";
import { useKeyboard } from "@opentui/react";
import type { AppContext } from "../App.js";
import type { Deployment } from "../types/index.js";
import { connectToDeployment } from "../services/ssh.js";
import { isOpenClawRunning } from "../services/setup/index.js";
import { t, statusColor } from "../theme.js";

interface Props {
  context: AppContext;
}

interface DeploymentHealth {
  sshConnectable: boolean;
  openclawRunning: boolean;
  lastChecked: Date;
}

export function StatusView({ context }: Props) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [healthStatus, setHealthStatus] = useState<Map<string, DeploymentHealth>>(new Map());
  const [checking, setChecking] = useState<string | null>(null);

  const deployments = context.deployments;

  const checkHealth = async (deployment: Deployment) => {
    const name = deployment.config.name;
    setChecking(name);

    const health: DeploymentHealth = {
      sshConnectable: false,
      openclawRunning: false,
      lastChecked: new Date(),
    };

    if (deployment.state.serverIp && deployment.state.status === "deployed") {
      try {
        const ssh = await connectToDeployment(name, deployment.state.serverIp);
        health.sshConnectable = true;

        try {
          health.openclawRunning = await isOpenClawRunning(ssh);
        } catch {
          // OpenClaw check failed
        }

        ssh.disconnect();
      } catch {
        // SSH connection failed
      }
    }

    setHealthStatus((prev) => new Map(prev).set(name, health));
    setChecking(null);
  };

  // Handle keyboard events
  useKeyboard((key) => {
    if (deployments.length === 0) {
      context.navigateTo("home");
      return;
    }

    if (key.name === "up" && selectedIndex > 0) {
      setSelectedIndex(selectedIndex - 1);
    } else if (key.name === "down" && selectedIndex < deployments.length - 1) {
      setSelectedIndex(selectedIndex + 1);
    } else if (key.name === "return") {
      checkHealth(deployments[selectedIndex]);
    } else if (key.name === "escape") {
      context.navigateTo("home");
    }
  });

  if (deployments.length === 0) {
    return (
      <box flexDirection="column" width="100%" padding={1}>
        <box flexDirection="row" marginBottom={2}>
          <text fg={t.accent}>/status</text>
          <text fg={t.fg.secondary}> - Deployment Status</text>
        </box>

        <box
          flexDirection="column"
          borderStyle="single"
          borderColor={t.border.default}
          padding={1}
        >
          <text fg={t.status.warning}>No deployments found!</text>
          <text fg={t.fg.secondary} marginTop={1}>Run /new to create a deployment.</text>
        </box>

        <text fg={t.fg.muted} marginTop={2}>Press any key to return to home</text>
      </box>
    );
  }

  const selectedDeployment = deployments[selectedIndex];
  const selectedHealth = healthStatus.get(selectedDeployment.config.name);

  return (
    <box flexDirection="column" width="100%" padding={1}>
      <box flexDirection="row" marginBottom={2}>
        <text fg={t.accent}>/status</text>
        <text fg={t.fg.secondary}> - Deployment Status</text>
      </box>

      {/* Deployment List */}
      <box
        flexDirection="column"
        borderStyle="single"
        borderColor={t.border.default}
        padding={1}
        marginBottom={1}
      >
        <text fg={t.fg.primary} marginBottom={1}>Deployments ({deployments.length})</text>
        {deployments.map((deployment, index) => {
          const isSelected = index === selectedIndex;

          return (
            <box
              key={deployment.config.name}
              flexDirection="row"
              backgroundColor={isSelected ? t.selection.bg : undefined}
            >
              <text fg={isSelected ? t.selection.fg : t.fg.secondary}>
                {isSelected ? "> " : "  "}
              </text>
              <text fg={isSelected ? t.selection.fg : t.fg.secondary} width={25}>
                {deployment.config.name}
              </text>
              <text fg={statusColor(deployment.state.status)}>[{deployment.state.status}]</text>
            </box>
          );
        })}
      </box>

      {/* Selected Deployment Details */}
      <box
        flexDirection="column"
        borderStyle="single"
        borderColor={t.border.focus}
        padding={1}
        marginBottom={1}
      >
        <text fg={t.accent}>Details: {selectedDeployment.config.name}</text>

        <box flexDirection="row" marginTop={1}>
          <text fg={t.fg.secondary} width={18}>Status:</text>
          <text fg={statusColor(selectedDeployment.state.status)}>
            {selectedDeployment.state.status}
          </text>
        </box>

        <box flexDirection="row">
          <text fg={t.fg.secondary} width={18}>Provider:</text>
          <text fg={t.fg.primary}>{selectedDeployment.config.provider}</text>
        </box>

        <box flexDirection="row">
          <text fg={t.fg.secondary} width={18}>Server IP:</text>
          <text fg={t.accent}>{selectedDeployment.state.serverIp || "Not deployed"}</text>
        </box>

        <box flexDirection="row">
          <text fg={t.fg.secondary} width={18}>Tailscale IP:</text>
          <text fg={t.accent}>{selectedDeployment.state.tailscaleIp || "Not configured"}</text>
        </box>

        <box flexDirection="row">
          <text fg={t.fg.secondary} width={18}>Created:</text>
          <text fg={t.fg.primary}>{new Date(selectedDeployment.config.createdAt).toLocaleString()}</text>
        </box>

        {selectedDeployment.state.deployedAt && (
          <box flexDirection="row">
            <text fg={t.fg.secondary} width={18}>Deployed:</text>
            <text fg={t.fg.primary}>{new Date(selectedDeployment.state.deployedAt).toLocaleString()}</text>
          </box>
        )}

        {selectedDeployment.state.lastError && (
          <box flexDirection="row">
            <text fg={t.fg.secondary} width={18}>Last Error:</text>
            <text fg={t.status.error}>{selectedDeployment.state.lastError}</text>
          </box>
        )}

        {/* Health Status */}
        {selectedHealth && (
          <box flexDirection="column" marginTop={1}>
            <text fg={t.fg.primary}>Health Check:</text>
            <box flexDirection="row">
              <text fg={t.fg.secondary} width={18}>SSH:</text>
              <text fg={selectedHealth.sshConnectable ? t.status.success : t.status.error}>
                {selectedHealth.sshConnectable ? "Connected" : "Unreachable"}
              </text>
            </box>
            <box flexDirection="row">
              <text fg={t.fg.secondary} width={18}>OpenClaw:</text>
              <text fg={selectedHealth.openclawRunning ? t.status.success : t.status.error}>
                {selectedHealth.openclawRunning ? "Running" : "Not running"}
              </text>
            </box>
            <text fg={t.fg.muted}>Last checked: {selectedHealth.lastChecked.toLocaleTimeString()}</text>
          </box>
        )}

        {checking === selectedDeployment.config.name && (
          <text fg={t.status.warning} marginTop={1}>Checking health...</text>
        )}
      </box>

      {/* Checkpoints - show summary instead of full list */}
      {selectedDeployment.state.checkpoints.length > 0 && (
        <box flexDirection="row" marginBottom={1}>
          <text fg={t.fg.secondary}>Checkpoints: </text>
          <text fg={t.status.success}>{selectedDeployment.state.checkpoints.length} completed</text>
        </box>
      )}

      <text fg={t.fg.muted}>Up/Down: Select | Enter: Health check | Esc: Back</text>
    </box>
  );
}
