import { useState } from "react";
import type { AppContext } from "../App.js";
import type { ViewName } from "../types/index.js";
import { t, statusColor } from "../theme.js";

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
  { name: "/list", description: "List, edit, or fork deployments" },
  { name: "/deploy", description: "Deploy an initialized configuration" },
  { name: "/status", description: "View deployment status" },
  { name: "/ssh", description: "SSH into a deployment" },
  { name: "/logs", description: "View deployment logs" },
  { name: "/destroy", description: "Destroy a deployment" },
  { name: "/templates", description: "Manage deployment templates" },
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
      "/list": "list",
      "/deploy": "deploy",
      "/status": "status",
      "/ssh": "ssh",
      "/logs": "logs",
      "/destroy": "destroy",
      "/templates": "templates",
      "/help": "help",
    };

    if (viewMap[cmd]) {
      context.navigateTo(viewMap[cmd]);
    } else if (cmd.startsWith("/")) {
      setError(`Unknown command: ${cmd}. Type /help for available commands.`);
    }
  };

  return (
    <box flexDirection="column" width="100%" height="100%">
      {/* Scrollable Content */}
      <scrollbox
        width="100%"
        height="100%"
        scrollY={true}
        scrollX={false}
        focused={false}
        style={{
          flexGrow: 1,
          flexShrink: 1,
          width: "100%",
          height: "100%",
          backgroundColor: t.bg.base
        }}
        verticalScrollbarOptions={{
          showArrows: false,
        }}
      >
        <box flexDirection="column" padding={1}>
          {/* Header */}
          <box flexDirection="column" marginBottom={1}>
            <text fg={t.accent}>{LOGO}</text>
            <text fg={t.fg.secondary}>Deploy and manage OpenClaw instances with ease</text>
          </box>

          {/* Quick Start */}
          <box
            flexDirection="column"
            borderStyle="single"
            borderColor={t.border.focus}
            padding={1}
            marginBottom={1}
          >
            <text fg={t.accent}>Quick Start</text>
            <text fg={t.fg.primary} marginTop={1}>1. Type /new to initialize a new deployment</text>
            <text fg={t.fg.primary}>2. Type /deploy to deploy your configuration</text>
            <text fg={t.fg.primary}>3. Type /status to monitor your deployments</text>
          </box>

          {/* Available Commands */}
          <box
            flexDirection="column"
            borderStyle="single"
            borderColor={t.border.default}
            padding={1}
            marginBottom={1}
          >
            <text fg={t.fg.primary}>Available Commands</text>
            <box flexDirection="column" marginTop={1}>
              {COMMANDS.map((cmd) => (
                <box key={cmd.name} flexDirection="row">
                  <text fg={t.accent} width={12}>{cmd.name}</text>
                  <text fg={t.fg.secondary}>{cmd.description}</text>
                </box>
              ))}
            </box>
          </box>

          {/* Deployments Summary */}
          {context.deployments.length > 0 && (
            <box
              flexDirection="column"
              borderStyle="single"
              borderColor={t.border.default}
              padding={1}
              marginBottom={1}
            >
              <text fg={t.fg.primary}>Your Deployments ({context.deployments.length})</text>
              <box flexDirection="column" marginTop={1}>
                {context.deployments.map((deployment) => (
                  <box key={deployment.config.name} flexDirection="row">
                    <text fg={t.fg.primary} width={20}>{deployment.config.name}</text>
                    <text fg={statusColor(deployment.state.status)}>
                      {deployment.state.status}
                    </text>
                  </box>
                ))}
              </box>
            </box>
          )}
        </box>
      </scrollbox>

      {/* Sticky Command Input */}
      <box flexDirection="column" paddingLeft={0} paddingRight={0} paddingTop={0}>
        {error && (
          <box marginBottom={0}>
            <text fg={t.status.error}>{error}</text>
          </box>
        )}
        <box
          backgroundColor={t.bg.elevated}
          paddingTop={1}
        >
          <box width="100%" paddingTop={0}
            paddingBottom={1.3} paddingLeft={1}>
            <input
              value={inputValue}
              placeholder="Type a command (e.g., /new)..."
              focused
              width="100%"
              onInput={(value) => setInputValue(value)}
              onSubmit={(value) => {
                if (typeof value === "string" && typeof value.trim === "function" && value.trim()) {
                  handleCommand(value as string);
                  setInputValue("");
                }
              }}
            />
          </box>
        </box>
      </box>
    </box>
  );
}
