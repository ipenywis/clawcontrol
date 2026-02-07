import { useState } from "react";
import { useKeyboard } from "@opentui/react";
import type { AppContext } from "../App.js";
import type { Deployment } from "../types/index.js";
import { connectToDeployment } from "../services/ssh.js";
import { isOpenClawRunning } from "../services/setup/index.js";

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
      <box flexDirection="column" width="100%" height="100%" padding={1}>
        <box flexDirection="row" marginBottom={2}>
          <text fg="cyan">/status</text>
          <text fg="gray"> - Deployment Status</text>
        </box>

        <box
          flexDirection="column"
          borderStyle="single"
          borderColor="yellow"
          padding={1}
        >
          <text fg="yellow">No deployments found!</text>
          <text fg="gray" marginTop={1}>Run /new to create a deployment.</text>
        </box>

        <text fg="yellow" marginTop={2}>Press any key to return to home</text>
      </box>
    );
  }

  const selectedDeployment = deployments[selectedIndex];
  const selectedHealth = healthStatus.get(selectedDeployment.config.name);

  return (
    <box flexDirection="column" width="100%" height="100%" padding={1}>
      <box flexDirection="row" marginBottom={2}>
        <text fg="cyan">/status</text>
        <text fg="gray"> - Deployment Status</text>
      </box>

      {/* Deployment List */}
      <box
        flexDirection="column"
        borderStyle="single"
        borderColor="gray"
        padding={1}
        marginBottom={1}
      >
        <text fg="white" marginBottom={1}>Deployments</text>
        {deployments.map((deployment, index) => {
          const isSelected = index === selectedIndex;
          const status = deployment.state.status;
          const statusColor =
            status === "deployed"
              ? "green"
              : status === "failed"
              ? "red"
              : status === "initialized"
              ? "yellow"
              : "cyan";

          return (
            <box
              key={deployment.config.name}
              flexDirection="row"
              backgroundColor={isSelected ? "blue" : undefined}
            >
              <text fg={isSelected ? "white" : "gray"}>
                {isSelected ? "> " : "  "}
              </text>
              <text fg={isSelected ? "white" : "gray"} width={25}>
                {deployment.config.name}
              </text>
              <text fg={statusColor}>[{status}]</text>
            </box>
          );
        })}
      </box>

      {/* Selected Deployment Details */}
      <box
        flexDirection="column"
        borderStyle="single"
        borderColor="cyan"
        padding={1}
        marginBottom={1}
      >
        <text fg="cyan">Details: {selectedDeployment.config.name}</text>

        <box flexDirection="row" marginTop={1}>
          <text fg="gray" width={18}>Status:</text>
          <text
            fg={
              selectedDeployment.state.status === "deployed"
                ? "green"
                : selectedDeployment.state.status === "failed"
                ? "red"
                : "yellow"
            }
          >
            {selectedDeployment.state.status}
          </text>
        </box>

        <box flexDirection="row">
          <text fg="gray" width={18}>Provider:</text>
          <text fg="white">{selectedDeployment.config.provider}</text>
        </box>

        <box flexDirection="row">
          <text fg="gray" width={18}>Server IP:</text>
          <text fg="cyan">{selectedDeployment.state.serverIp || "Not deployed"}</text>
        </box>

        <box flexDirection="row">
          <text fg="gray" width={18}>Tailscale IP:</text>
          <text fg="cyan">{selectedDeployment.state.tailscaleIp || "Not configured"}</text>
        </box>

        <box flexDirection="row">
          <text fg="gray" width={18}>Created:</text>
          <text fg="white">{new Date(selectedDeployment.config.createdAt).toLocaleString()}</text>
        </box>

        {selectedDeployment.state.deployedAt && (
          <box flexDirection="row">
            <text fg="gray" width={18}>Deployed:</text>
            <text fg="white">{new Date(selectedDeployment.state.deployedAt).toLocaleString()}</text>
          </box>
        )}

        {selectedDeployment.state.lastError && (
          <box flexDirection="row">
            <text fg="gray" width={18}>Last Error:</text>
            <text fg="red">{selectedDeployment.state.lastError}</text>
          </box>
        )}

        {/* Health Status */}
        {selectedHealth && (
          <box flexDirection="column" marginTop={1}>
            <text fg="white">Health Check:</text>
            <box flexDirection="row">
              <text fg="gray" width={18}>SSH:</text>
              <text fg={selectedHealth.sshConnectable ? "green" : "red"}>
                {selectedHealth.sshConnectable ? "Connected" : "Unreachable"}
              </text>
            </box>
            <box flexDirection="row">
              <text fg="gray" width={18}>OpenClaw:</text>
              <text fg={selectedHealth.openclawRunning ? "green" : "red"}>
                {selectedHealth.openclawRunning ? "Running" : "Not running"}
              </text>
            </box>
            <text fg="gray">Last checked: {selectedHealth.lastChecked.toLocaleTimeString()}</text>
          </box>
        )}

        {checking === selectedDeployment.config.name && (
          <text fg="yellow" marginTop={1}>Checking health...</text>
        )}
      </box>

      {/* Checkpoints */}
      {selectedDeployment.state.checkpoints.length > 0 && (
        <box
          flexDirection="column"
          borderStyle="single"
          borderColor="gray"
          padding={1}
          marginBottom={1}
        >
          <text fg="white">Completed Checkpoints</text>
          {selectedDeployment.state.checkpoints.map((cp) => (
            <box key={cp.name} flexDirection="row">
              <text fg="green">✓ </text>
              <text fg="gray">{cp.name}</text>
            </box>
          ))}
        </box>
      )}

      <text fg="gray">Arrow keys to select | Enter to check health | Esc to go back</text>
    </box>
  );
}
