import { useState, useEffect, useRef } from "react";
import { useKeyboard } from "@opentui/react";
import type { AppContext } from "../App.js";
import { connectToDeployment, type SSHConnection } from "../services/ssh.js";
import { getOpenClawLogs } from "../services/setup/index.js";

interface Props {
  context: AppContext;
}

type ViewState = "selecting" | "loading" | "viewing" | "error";

export function LogsView({ context }: Props) {
  const [viewState, setViewState] = useState<ViewState>("selecting");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [logs, setLogs] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);

  const sshRef = useRef<SSHConnection | null>(null);
  const refreshIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const deployedDeployments = context.deployments.filter(
    (d) => d.state.status === "deployed" && d.state.serverIp
  );

  useEffect(() => {
    return () => {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
      }
      if (sshRef.current?.isConnected()) {
        sshRef.current.disconnect();
      }
    };
  }, []);

  const fetchLogs = async (deploymentName: string, serverIp: string) => {
    try {
      if (!sshRef.current?.isConnected()) {
        sshRef.current = await connectToDeployment(deploymentName, serverIp);
      }

      const logOutput = await getOpenClawLogs(sshRef.current, 200);
      setLogs(logOutput.split("\n"));
      setViewState("viewing");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setViewState("error");
    }
  };

  const startAutoRefresh = (deploymentName: string, serverIp: string) => {
    setAutoRefresh(true);
    refreshIntervalRef.current = setInterval(() => {
      fetchLogs(deploymentName, serverIp);
    }, 5000);
  };

  const stopAutoRefresh = () => {
    setAutoRefresh(false);
    if (refreshIntervalRef.current) {
      clearInterval(refreshIntervalRef.current);
      refreshIntervalRef.current = null;
    }
  };

  const goBack = () => {
    stopAutoRefresh();
    if (sshRef.current?.isConnected()) {
      sshRef.current.disconnect();
      sshRef.current = null;
    }
    setViewState("selecting");
    setLogs([]);
  };

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
        setViewState("loading");
        fetchLogs(selectedDeployment.config.name, selectedDeployment.state.serverIp!);
      } else if (key.name === "escape") {
        context.navigateTo("home");
      }
    } else if (viewState === "viewing") {
      if (key.name === "r") {
        fetchLogs(selectedDeployment.config.name, selectedDeployment.state.serverIp!);
      } else if (key.name === "a") {
        if (autoRefresh) {
          stopAutoRefresh();
        } else {
          startAutoRefresh(selectedDeployment.config.name, selectedDeployment.state.serverIp!);
        }
      } else if (key.name === "escape") {
        goBack();
      }
    } else if (viewState === "error") {
      goBack();
    }
  });

  if (deployedDeployments.length === 0) {
    return (
      <box flexDirection="column" width="100%" height="100%" padding={1}>
        <box flexDirection="row" marginBottom={2}>
          <text fg="cyan">/logs</text>
          <text fg="gray"> - View deployment logs</text>
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
    return (
      <box flexDirection="column" width="100%" height="100%" padding={1}>
        <box flexDirection="row" marginBottom={2}>
          <text fg="cyan">/logs</text>
          <text fg="gray"> - Select a deployment</text>
        </box>

        <box
          flexDirection="column"
          borderStyle="single"
          borderColor="gray"
          padding={1}
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

        <text fg="gray" marginTop={2}>Arrow keys to select | Enter to view logs | Esc to go back</text>
      </box>
    );
  }

  if (viewState === "loading") {
    return (
      <box flexDirection="column" width="100%" height="100%" padding={1}>
        <text fg="cyan">Loading logs...</text>
        <text fg="yellow" marginTop={1}>Fetching OpenClaw logs from server...</text>
      </box>
    );
  }

  if (viewState === "error") {
    return (
      <box flexDirection="column" width="100%" height="100%" padding={1}>
        <box flexDirection="row" marginBottom={2}>
          <text fg="red">Error Loading Logs</text>
        </box>

        <box
          flexDirection="column"
          borderStyle="single"
          borderColor="red"
          padding={1}
        >
          <text fg="red">{error}</text>
        </box>

        <text fg="yellow" marginTop={2}>Press any key to go back</text>
      </box>
    );
  }

  // Viewing state
  return (
    <box flexDirection="column" width="100%" height="100%" padding={1}>
      <box flexDirection="row" marginBottom={1}>
        <text fg="cyan">Logs: {selectedDeployment.config.name}</text>
        <text fg="gray"> | </text>
        <text fg={autoRefresh ? "green" : "gray"}>
          Auto-refresh: {autoRefresh ? "ON" : "OFF"}
        </text>
      </box>

      {/* Log output */}
      <box
        flexDirection="column"
        borderStyle="single"
        borderColor="gray"
        padding={1}
        flexGrow={1}
        overflow="hidden"
      >
        <box flexDirection="column">
          {logs.slice(-30).map((line, i) => {
            const logColor = line.includes("error") || line.includes("Error")
              ? "red"
              : line.includes("warn") || line.includes("Warning")
              ? "yellow"
              : "white";

            return (
              <text key={i} fg={logColor}>{line}</text>
            );
          })}
        </box>
      </box>

      <text fg="gray" marginTop={1}>R: Refresh | A: Toggle auto-refresh | Esc: Go back</text>
    </box>
  );
}
