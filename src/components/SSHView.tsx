import { useState, useCallback } from "react";
import { useKeyboard } from "@opentui/react";
import type { AppContext } from "../App.js";
import { getSSHKeyPath } from "../services/config.js";
import { detectTerminal, openTerminalWithCommand, getTerminalDisplayName } from "../utils/terminal.js";

interface Props {
  context: AppContext;
}

type ViewState = "selecting" | "connected" | "error";

export function SSHView({ context }: Props) {
  const [viewState, setViewState] = useState<ViewState>("selecting");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [connectedDeployment, setConnectedDeployment] = useState<string | null>(null);
  const [terminalName, setTerminalName] = useState<string>("");

  const deployedDeployments = context.deployments.filter(
    (d) => d.state.status === "deployed" && d.state.serverIp
  );

  const launchNativeSSH = useCallback((deploymentName: string, serverIp: string) => {
    const sshKeyPath = getSSHKeyPath(deploymentName);
    const sshCommand = `ssh -i "${sshKeyPath}" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null root@${serverIp}`;

    const terminal = detectTerminal();
    setTerminalName(getTerminalDisplayName(terminal.app));

    const result = openTerminalWithCommand(sshCommand);

    if (result.success) {
      setConnectedDeployment(deploymentName);
      setViewState("connected");
    } else {
      setError(result.error || "Failed to open terminal");
      setViewState("error");
    }
  }, []);

  const selectedDeployment = deployedDeployments[selectedIndex];

  // Handle keyboard events
  useKeyboard((key) => {
    if (deployedDeployments.length === 0) {
      context.navigateTo("home");
      return;
    }

    if (viewState === "selecting") {
      if (key.name === "up" && selectedIndex > 0) {
        setSelectedIndex(selectedIndex - 1);
      } else if (key.name === "down" && selectedIndex < deployedDeployments.length - 1) {
        setSelectedIndex(selectedIndex + 1);
      } else if (key.name === "return") {
        launchNativeSSH(selectedDeployment.config.name, selectedDeployment.state.serverIp!);
      } else if (key.name === "escape") {
        context.navigateTo("home");
      }
    } else if (viewState === "connected") {
      if (key.name === "return" || key.name === "escape") {
        context.navigateTo("home");
      }
    } else if (viewState === "error") {
      context.navigateTo("home");
    }
  });

  if (deployedDeployments.length === 0) {
    return (
      <box flexDirection="column" width="100%" height="100%" padding={1}>
        <box flexDirection="row" marginBottom={2}>
          <text fg="cyan">/ssh</text>
          <text fg="gray"> - SSH into deployment</text>
        </box>

        <box
          flexDirection="column"
          borderStyle="single"
          borderColor="yellow"
          padding={1}
        >
          <text fg="yellow">No deployed instances found!</text>
          <text fg="gray" marginTop={1}>Deploy an instance first with /deploy</text>
        </box>

        <text fg="yellow" marginTop={2}>Press any key to return to home</text>
      </box>
    );
  }

  if (viewState === "selecting") {
    const terminal = detectTerminal();
    const terminalDisplayName = getTerminalDisplayName(terminal.app);

    return (
      <box flexDirection="column" width="100%" height="100%" padding={1}>
        <box flexDirection="row" marginBottom={2}>
          <text fg="cyan">/ssh</text>
          <text fg="gray"> - Select a deployment to connect</text>
        </box>

        <box
          flexDirection="column"
          borderStyle="single"
          borderColor="gray"
          padding={1}
          marginBottom={1}
        >
          {deployedDeployments.map((deployment, index) => {
            const isSelected = index === selectedIndex;

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
                <text fg="cyan">{deployment.state.serverIp}</text>
              </box>
            );
          })}
        </box>

        <box flexDirection="row" marginBottom={1}>
          <text fg="gray">Detected: </text>
          <text fg="green">{terminalDisplayName}</text>
          {terminal.canOpenTab ? (
            <text fg="gray"> (will open new tab)</text>
          ) : (
            <text fg="gray"> (will open Terminal.app)</text>
          )}
        </box>

        <text fg="gray">Arrow keys to select | Enter to connect | Esc to go back</text>
      </box>
    );
  }

  if (viewState === "connected") {
    return (
      <box flexDirection="column" width="100%" height="100%" padding={1}>
        <box flexDirection="row" marginBottom={2}>
          <text fg="green">/ssh</text>
          <text fg="gray"> - Connected to {connectedDeployment}</text>
        </box>

        <box
          flexDirection="column"
          borderStyle="double"
          borderColor="green"
          padding={1}
          marginBottom={1}
        >
          <text fg="green">SSH Session Opened</text>
          <text fg="white" marginTop={1}>A new {terminalName} window/tab has been opened.</text>
        </box>

        <box
          flexDirection="column"
          borderStyle="single"
          borderColor="gray"
          padding={1}
          marginBottom={1}
        >
          <text fg="white">Your SSH session is running in {terminalName}.</text>
          <text fg="white" marginTop={1}>When you're done, type 'exit' or close the tab.</text>
        </box>

        <text fg="yellow" marginTop={1}>Press Enter or Esc to return to ClawControl</text>
      </box>
    );
  }

  if (viewState === "error") {
    return (
      <box flexDirection="column" width="100%" height="100%" padding={1}>
        <box flexDirection="row" marginBottom={2}>
          <text fg="red">SSH Error</text>
        </box>

        <box
          flexDirection="column"
          borderStyle="single"
          borderColor="red"
          padding={1}
        >
          <text fg="red">{error}</text>
        </box>

        <text fg="yellow" marginTop={2}>Press any key to return to home</text>
      </box>
    );
  }

  return null;
}
