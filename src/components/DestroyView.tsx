import { useState } from "react";
import { useKeyboard } from "@opentui/react";
import type { AppContext } from "../App.js";
import { deleteDeployment } from "../services/config.js";
import { createHetznerClient } from "../providers/hetzner/api.js";

interface Props {
  context: AppContext;
}

type ViewState = "selecting" | "confirming" | "destroying" | "success" | "error";

export function DestroyView({ context }: Props) {
  const [viewState, setViewState] = useState<ViewState>("selecting");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState("");

  const deployments = context.deployments;

  const destroyDeployment = async (name: string) => {
    setViewState("destroying");

    try {
      const deployment = deployments.find((d) => d.config.name === name);
      if (!deployment) {
        throw new Error("Deployment not found");
      }

      // If server exists, delete it from Hetzner
      if (deployment.state.serverId && deployment.config.hetzner) {
        const client = createHetznerClient(deployment.config.hetzner.apiKey);

        try {
          await client.deleteServer(parseInt(deployment.state.serverId));
        } catch (err) {
          // Server might already be deleted, continue with local cleanup
          console.error("Failed to delete server:", err);
        }

        // Delete SSH key from Hetzner if exists
        if (deployment.state.sshKeyId) {
          try {
            await client.deleteSSHKey(parseInt(deployment.state.sshKeyId));
          } catch {
            // SSH key might already be deleted
          }
        }
      }

      // Delete local configuration
      deleteDeployment(name);
      context.refreshDeployments();

      setViewState("success");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setViewState("error");
    }
  };

  const selectedDeployment = deployments[selectedIndex];

  // Handle keyboard events
  useKeyboard((key) => {
    if (deployments.length === 0) {
      context.navigateTo("home");
      return;
    }

    if (viewState === "selecting") {
      if (key.name === "up" && selectedIndex > 0) {
        setSelectedIndex(selectedIndex - 1);
      } else if (key.name === "down" && selectedIndex < deployments.length - 1) {
        setSelectedIndex(selectedIndex + 1);
      } else if (key.name === "return") {
        setViewState("confirming");
      } else if (key.name === "escape") {
        context.navigateTo("home");
      }
    } else if (viewState === "success" || viewState === "error") {
      if (viewState === "success") {
        context.navigateTo("home");
      } else {
        setViewState("selecting");
        setError(null);
      }
    }
  });

  if (deployments.length === 0) {
    return (
      <box flexDirection="column" width="100%" height="100%" padding={1}>
        <box flexDirection="row" marginBottom={2}>
          <text fg="red">/destroy</text>
          <text fg="gray"> - Destroy deployment</text>
        </box>

        <box
          flexDirection="column"
          borderStyle="single"
          borderColor="yellow"
          padding={1}
        >
          <text fg="yellow">No deployments found!</text>
        </box>

        <text fg="yellow" marginTop={2}>Press any key to return to home</text>
      </box>
    );
  }

  if (viewState === "selecting") {
    return (
      <box flexDirection="column" width="100%" height="100%" padding={1}>
        <box flexDirection="row" marginBottom={2}>
          <text fg="red">/destroy</text>
          <text fg="gray"> - Select a deployment to destroy</text>
        </box>

        <box
          flexDirection="column"
          borderStyle="single"
          borderColor="red"
          padding={1}
        >
          <text fg="red" marginBottom={1}>WARNING: This action cannot be undone!</text>
          {deployments.map((deployment, index) => {
            const isSelected = index === selectedIndex;

            return (
              <box
                key={deployment.config.name}
                flexDirection="row"
                backgroundColor={isSelected ? "red" : undefined}
              >
                <text fg={isSelected ? "white" : "gray"}>
                  {isSelected ? "> " : "  "}
                </text>
                <text fg={isSelected ? "white" : "gray"} width={25}>
                  {deployment.config.name}
                </text>
                <text fg={isSelected ? "white" : "gray"}>
                  [{deployment.state.status}]
                </text>
              </box>
            );
          })}
        </box>

        <text fg="gray" marginTop={2}>Arrow keys to select | Enter to destroy | Esc to go back</text>
      </box>
    );
  }

  if (viewState === "confirming") {
    return (
      <box flexDirection="column" width="100%" height="100%" padding={1}>
        <box flexDirection="row" marginBottom={2}>
          <text fg="red">Confirm Destruction</text>
        </box>

        <box
          flexDirection="column"
          borderStyle="double"
          borderColor="red"
          padding={1}
        >
          <text fg="red">You are about to destroy:</text>
          <text fg="white" marginTop={1}>Deployment: {selectedDeployment.config.name}</text>
          {selectedDeployment.state.serverIp && (
            <text fg="white">Server IP: {selectedDeployment.state.serverIp}</text>
          )}
          <text fg="red" marginTop={1}>This will permanently delete:</text>
          <text fg="gray">• The VPS server (if deployed)</text>
          <text fg="gray">• All data on the server</text>
          <text fg="gray">• Local configuration files</text>
          <text fg="gray">• SSH keys</text>
        </box>

        <text fg="yellow" marginTop={2}>Type the deployment name to confirm:</text>
        <text fg="white" marginTop={1}>Confirm:</text>
        <input
          value={confirmText}
          placeholder={selectedDeployment.config.name}
          focused
          onInput={(value) => setConfirmText(value)}
          onSubmit={(value) => {
            if (value === selectedDeployment.config.name) {
              destroyDeployment(selectedDeployment.config.name);
            } else {
              setError("Name does not match. Please type the exact deployment name.");
            }
          }}
          onKeyDown={(e) => {
            if (e.name === "escape") {
              setViewState("selecting");
              setConfirmText("");
              setError(null);
            }
          }}
        />

        {error && <text fg="red" marginTop={1}>{error}</text>}

        <text fg="gray" marginTop={2}>Press Esc to cancel</text>
      </box>
    );
  }

  if (viewState === "destroying") {
    return (
      <box flexDirection="column" width="100%" height="100%" padding={1}>
        <text fg="red">Destroying deployment...</text>
        <text fg="yellow" marginTop={1}>Deleting server and cleaning up resources...</text>
      </box>
    );
  }

  if (viewState === "success") {
    return (
      <box flexDirection="column" width="100%" height="100%" padding={1}>
        <box
          flexDirection="column"
          borderStyle="single"
          borderColor="green"
          padding={1}
        >
          <text fg="green">Deployment Destroyed</text>
          <text fg="white" marginTop={1}>
            The deployment "{selectedDeployment.config.name}" has been permanently deleted.
          </text>
        </box>

        <text fg="yellow" marginTop={2}>Press any key to return to home</text>
      </box>
    );
  }

  if (viewState === "error") {
    return (
      <box flexDirection="column" width="100%" height="100%" padding={1}>
        <box
          flexDirection="column"
          borderStyle="single"
          borderColor="red"
          padding={1}
        >
          <text fg="red">Destruction Failed</text>
          <text fg="white" marginTop={1}>{error}</text>
        </box>

        <text fg="yellow" marginTop={2}>Press any key to go back</text>
      </box>
    );
  }

  return null;
}
