import { useState } from "react";
import { useKeyboard } from "@opentui/react";
import type { AppContext } from "../App.js";

interface Props {
  context: AppContext;
}

export function DeployView({ context }: Props) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [confirmMode, setConfirmMode] = useState(false);

  const deployments = context.deployments;
  const notDeployed = deployments.filter((d) => d.state.status !== "deployed");
  const deployed = deployments.filter((d) => d.state.status === "deployed");
  const allDeployments = [...notDeployed, ...deployed];

  const selectedDeployment = allDeployments[selectedIndex];

  // Handle keyboard events
  useKeyboard((key) => {
    if (allDeployments.length === 0) {
      // Any key returns home when no deployments
      context.navigateTo("home");
      return;
    }

    if (confirmMode) {
      if (key.name === "y" || key.name === "return") {
        context.navigateTo("deploying", selectedDeployment.config.name);
      } else if (key.name === "n" || key.name === "escape") {
        setConfirmMode(false);
      }
    } else {
      if (key.name === "up" && selectedIndex > 0) {
        setSelectedIndex(selectedIndex - 1);
      } else if (key.name === "down" && selectedIndex < allDeployments.length - 1) {
        setSelectedIndex(selectedIndex + 1);
      } else if (key.name === "return") {
        setConfirmMode(true);
      } else if (key.name === "escape") {
        context.navigateTo("home");
      }
    }
  });

  if (allDeployments.length === 0) {
    return (
      <box flexDirection="column" width="100%" height="100%" padding={1}>
        <box flexDirection="row" marginBottom={2}>
          <text fg="cyan">/deploy</text>
          <text fg="gray"> - Deploy a configuration</text>
        </box>

        <box
          flexDirection="column"
          borderStyle="single"
          borderColor="yellow"
          padding={1}
        >
          <text fg="yellow">No deployments found!</text>
          <text fg="gray" marginTop={1}>Run /new first to create a deployment configuration.</text>
        </box>

        <text fg="yellow" marginTop={2}>Press any key to return to home</text>
      </box>
    );
  }

  if (confirmMode) {
    return (
      <box flexDirection="column" width="100%" height="100%" padding={1}>
        <box flexDirection="row" marginBottom={2}>
          <text fg="cyan">/deploy</text>
          <text fg="gray"> - Confirm deployment</text>
        </box>

        <box
          flexDirection="column"
          borderStyle="single"
          borderColor="yellow"
          padding={1}
        >
          <text fg="yellow">Deploy "{selectedDeployment.config.name}"?</text>
          <text fg="gray" marginTop={1}>This will:</text>
          <text fg="white">• Create a VPS on {selectedDeployment.config.provider}</text>
          <text fg="white">• Install and configure OpenClaw</text>
          <text fg="white">• Set up Tailscale for secure access</text>
          <text fg="gray" marginTop={1}>Estimated cost: ~$4.99/month (Hetzner CPX11)</text>
        </box>

        <text fg="yellow" marginTop={2}>Press Y to confirm, N to cancel</text>
      </box>
    );
  }

  return (
    <box flexDirection="column" width="100%" height="100%" padding={1}>
      <box flexDirection="row" marginBottom={2}>
        <text fg="cyan">/deploy</text>
        <text fg="gray"> - Select a deployment to deploy</text>
      </box>

      <text fg="gray" marginBottom={1}>Use arrow keys to select, Enter to deploy:</text>

      <box
        flexDirection="column"
        borderStyle="single"
        borderColor="gray"
        padding={1}
      >
        {allDeployments.map((deployment, index) => {
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
              <text fg={statusColor} width={15}>[{status}]</text>
              <text fg="gray">{deployment.config.provider}</text>
            </box>
          );
        })}
      </box>

      <text fg="gray" marginTop={2}>Press Esc to go back</text>
    </box>
  );
}
