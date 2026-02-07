import { useState } from "react";
import type { AppContext } from "../App.js";
import type { ViewName } from "../types/index.js";

interface Props {
  context: AppContext;
}

const LOGO = `
   _____ _                  _____            _             _
  / ____| |                / ____|          | |           | |
 | |    | | __ ___      __| |     ___  _ __ | |_ _ __ ___ | |
 | |    | |/ _\` \\ \\ /\\ / /| |    / _ \\| '_ \\| __| '__/ _ \\| |
 | |____| | (_| |\\ V  V / | |___| (_) | | | | |_| | | (_) | |
  \\_____|_|\\__,_| \\_/\\_/   \\_____\\___/|_| |_|\\__|_|  \\___/|_|
`;

const COMMANDS = [
  { name: "/new", description: "Initialize a new deployment" },
  { name: "/deploy", description: "Deploy an initialized configuration" },
  { name: "/status", description: "View deployment status" },
  { name: "/ssh", description: "SSH into a deployment" },
  { name: "/logs", description: "View deployment logs" },
  { name: "/destroy", description: "Destroy a deployment" },
  { name: "/help", description: "Show help" },
];

export function Home({ context }: Props) {
  const [inputValue, setInputValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleCommand = (command: string) => {
    const cmd = command.trim().toLowerCase();
    setError(null);

    const viewMap: Record<string, ViewName> = {
      "/new": "new",
      "/deploy": "deploy",
      "/status": "status",
      "/ssh": "ssh",
      "/logs": "logs",
      "/destroy": "destroy",
      "/help": "help",
    };

    if (viewMap[cmd]) {
      context.navigateTo(viewMap[cmd]);
    } else if (cmd.startsWith("/")) {
      setError(`Unknown command: ${cmd}. Type /help for available commands.`);
    }
  };

  return (
    <box flexDirection="column" width="100%" height="100%" padding={1}>
      {/* Header */}
      <box flexDirection="column" marginBottom={1}>
        <text fg="cyan">{LOGO}</text>
        <text fg="gray">Deploy and manage OpenClaw instances with ease</text>
      </box>

      {/* Quick Start */}
      <box
        flexDirection="column"
        borderStyle="single"
        borderColor="blue"
        padding={1}
        marginBottom={1}
      >
        <text fg="blue">Quick Start</text>
        <text fg="white" marginTop={1}>1. Type /new to initialize a new deployment</text>
        <text fg="white">2. Type /deploy to deploy your configuration</text>
        <text fg="white">3. Type /status to monitor your deployments</text>
      </box>

      {/* Available Commands */}
      <box
        flexDirection="column"
        borderStyle="single"
        borderColor="gray"
        padding={1}
        marginBottom={1}
      >
        <text fg="white">Available Commands</text>
        <box flexDirection="column" marginTop={1}>
          {COMMANDS.map((cmd) => (
            <box key={cmd.name} flexDirection="row">
              <text fg="yellow" width={12}>{cmd.name}</text>
              <text fg="gray">{cmd.description}</text>
            </box>
          ))}
        </box>
      </box>

      {/* Deployments Summary */}
      {context.deployments.length > 0 && (
        <box
          flexDirection="column"
          borderStyle="single"
          borderColor="green"
          padding={1}
          marginBottom={1}
        >
          <text fg="green">Your Deployments ({context.deployments.length})</text>
          <box flexDirection="column" marginTop={1}>
            {context.deployments.slice(0, 5).map((deployment) => (
              <box key={deployment.config.name} flexDirection="row">
                <text fg="white" width={20}>{deployment.config.name}</text>
                <text
                  fg={
                    deployment.state.status === "deployed"
                      ? "green"
                      : deployment.state.status === "failed"
                      ? "red"
                      : "yellow"
                  }
                >
                  {deployment.state.status}
                </text>
              </box>
            ))}
            {context.deployments.length > 5 && (
              <text fg="gray">... and {context.deployments.length - 5} more</text>
            )}
          </box>
        </box>
      )}

      {/* Error Display */}
      {error && (
        <box marginBottom={1}>
          <text fg="red">{error}</text>
        </box>
      )}

      {/* Command Input */}
      <text fg="cyan" marginTop={1}>{"> Enter command:"}</text>
      <input
        value={inputValue}
        placeholder="Type a command (e.g., /new)..."
        focused
        onInput={(value) => setInputValue(value)}
        onSubmit={(value) => {
          if (value.trim()) {
            handleCommand(value);
            setInputValue("");
          }
        }}
      />
    </box>
  );
}
