import { useState, useEffect, useRef } from "react";
import { useKeyboard } from "@opentui/react";
import type { AppContext } from "../App.js";
import { connectToDeployment, type SSHConnection } from "../services/ssh.js";
import { getOpenClawLogs } from "../services/setup/index.js";
import { t, logLevelColor } from "../theme.js";

interface Props {
  context: AppContext;
}

type ViewState = "selecting" | "loading" | "viewing" | "error";

// Parse journalctl log line into structured format
function parseLogLine(line: string): { timestamp: string; level: string; message: string } | null {
  if (!line.trim()) return null;

  // Journalctl format: "Feb 07 12:34:56 hostname openclaw[pid]: message"
  const match = line.match(/^(\w+\s+\d+\s+[\d:]+)\s+\S+\s+\S+:\s*(.*)$/);
  if (match) {
    const message = match[2];
    let level = "info";
    if (/error|Error|ERROR|failed|Failed|FAILED/.test(message)) level = "error";
    else if (/warn|Warning|WARN/.test(message)) level = "warn";
    else if (/debug|DEBUG/.test(message)) level = "debug";
    return { timestamp: match[1], level, message };
  }

  // Fallback for non-standard lines
  return { timestamp: "", level: "info", message: line };
}

// Truncate line to fit terminal width
function truncateLine(line: string, maxWidth: number = 120): string {
  if (line.length <= maxWidth) return line;
  return line.substring(0, maxWidth - 3) + "...";
}

export function LogsView({ context }: Props) {
  const [viewState, setViewState] = useState<ViewState>("selecting");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [logs, setLogs] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);

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
      setLogs(logOutput.split("\n").filter((line) => line.trim()));
      setLastFetched(new Date());
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
      <box flexDirection="column" width="100%" padding={1}>
        <box flexDirection="row" marginBottom={2}>
          <text fg={t.accent}>/logs</text>
          <text fg={t.fg.secondary}> - View deployment logs</text>
        </box>

        <box
          flexDirection="column"
          borderStyle="single"
          borderColor={t.border.default}
          padding={1}
        >
          <text fg={t.status.warning}>No deployed instances found!</text>
          <text fg={t.fg.secondary} marginTop={1}>Deploy an instance first with /deploy</text>
        </box>

        <text fg={t.fg.muted} marginTop={2}>Press any key to return to home</text>
      </box>
    );
  }

  if (viewState === "selecting") {
    return (
      <box flexDirection="column" width="100%" padding={1}>
        <box flexDirection="row" marginBottom={2}>
          <text fg={t.accent}>/logs</text>
          <text fg={t.fg.secondary}> - Select a deployment</text>
        </box>

        <box
          flexDirection="column"
          borderStyle="single"
          borderColor={t.border.default}
          padding={1}
        >
          {deployedDeployments.map((deployment, index) => {
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
                <text fg={t.accent}>{deployment.state.serverIp}</text>
              </box>
            );
          })}
        </box>

        <text fg={t.fg.muted} marginTop={2}>Arrow keys to select | Enter to view logs | Esc to go back</text>
      </box>
    );
  }

  if (viewState === "loading") {
    return (
      <box flexDirection="column" width="100%" padding={1}>
        <text fg={t.accent}>Loading logs...</text>
        <text fg={t.fg.secondary} marginTop={1}>Fetching OpenClaw logs from server...</text>
      </box>
    );
  }

  if (viewState === "error") {
    return (
      <box flexDirection="column" width="100%" padding={1}>
        <box flexDirection="row" marginBottom={2}>
          <text fg={t.status.error}>Error Loading Logs</text>
        </box>

        <box
          flexDirection="column"
          borderStyle="single"
          borderColor={t.status.error}
          padding={1}
        >
          <text fg={t.status.error}>{error}</text>
        </box>

        <text fg={t.fg.muted} marginTop={2}>Press any key to go back</text>
      </box>
    );
  }

  // Viewing state - show all logs, scrollbox handles overflow
  const visibleLogs = logs;

  return (
    <box flexDirection="column" width="100%" padding={1}>
      {/* Header */}
      <box flexDirection="row" marginBottom={1}>
        <text fg={t.accent}>Logs: {selectedDeployment.config.name}</text>
        <text fg={t.fg.muted}> | </text>
        <text fg={autoRefresh ? t.status.success : t.fg.muted}>
          Auto: {autoRefresh ? "ON (5s)" : "OFF"}
        </text>
        {lastFetched && (
          <>
            <text fg={t.fg.muted}> | </text>
            <text fg={t.fg.muted}>Fetched: {lastFetched.toLocaleTimeString()}</text>
          </>
        )}
      </box>

      {/* Log output */}
      <box
        flexDirection="column"
        borderStyle="single"
        borderColor={t.border.default}
        padding={1}
      >
        <box flexDirection="column">
          {visibleLogs.map((line, i) => {
            const parsed = parseLogLine(line);
            if (!parsed) return null;

            const displayLine = parsed.timestamp
              ? `${parsed.timestamp} ${truncateLine(parsed.message, 100)}`
              : truncateLine(parsed.message, 120);

            return (
              <text key={i} fg={logLevelColor(parsed.level)}>{displayLine}</text>
            );
          })}
        </box>
      </box>

      <box flexDirection="row" marginTop={1}>
        <text fg={t.fg.muted}>R: Refresh | A: Toggle auto-refresh | Esc: Back</text>
        <text fg={t.fg.muted}> | </text>
        <text fg={t.accent}>Showing last {visibleLogs.length} lines</text>
      </box>
    </box>
  );
}
