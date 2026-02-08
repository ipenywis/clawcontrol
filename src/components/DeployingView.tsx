import { useState, useEffect, useCallback, useRef } from "react";
import { useKeyboard } from "@opentui/react";
import open from "open";
import type { AppContext } from "../App.js";
import {
  startDeployment,
  type DeploymentProgress,
} from "../services/deployment.js";
import { readDeploymentState, getSSHKeyPath } from "../services/config.js";
import { openTerminalWithCommand, detectTerminal, getTerminalDisplayName } from "../utils/terminal.js";
import { t } from "../theme.js";

interface Props {
  context: AppContext;
}

type DeployState = "deploying" | "confirming" | "waiting_terminal" | "success" | "failed";

interface ConfirmPrompt {
  message: string;
  resolve: (value: boolean) => void;
}

export function DeployingView({ context }: Props) {
  const [deployState, setDeployState] = useState<DeployState>("deploying");
  const [progress, setProgress] = useState<DeploymentProgress | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [confirmPrompt, setConfirmPrompt] = useState<ConfirmPrompt | null>(null);
  const [terminalResolve, setTerminalResolve] = useState<(() => void) | null>(null);

  const deploymentName = context.selectedDeployment;

  const addLog = useCallback((message: string) => {
    setLogs((prev) => [...prev.slice(-20), `[${new Date().toLocaleTimeString()}] ${message}`]);
  }, []);

  const handleProgress = useCallback((p: DeploymentProgress) => {
    setProgress(p);
    addLog(p.message);
  }, [addLog]);

  const handleConfirm = useCallback((message: string): Promise<boolean> => {
    return new Promise((resolve) => {
      setConfirmPrompt({ message, resolve });
      setDeployState("confirming");
    });
  }, []);

  const handleOpenUrl = useCallback(async (url: string): Promise<void> => {
    await open(url);
    addLog(`Opened browser: ${url}`);
  }, [addLog]);

  const handleSpawnTerminal = useCallback(async (deploymentName: string, serverIp: string, command: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      try {
        const terminal = detectTerminal();
        const terminalName = getTerminalDisplayName(terminal.app);
        addLog(`Opening ${terminalName} for interactive setup...`);
        setDeployState("waiting_terminal");
        setTerminalResolve(() => resolve);

        const sshKeyPath = getSSHKeyPath(deploymentName);
        const sshCommand = `ssh -i "${sshKeyPath}" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null root@${serverIp} -t '${command}; echo ""; echo "=== Setup complete! You can close this terminal window. ==="; read -p "Press Enter to close..."'`;

        const result = openTerminalWithCommand(sshCommand);

        if (result.success) {
          addLog(`${terminalName} opened. Complete the setup there.`);
        } else {
          reject(new Error(result.error || "Failed to open terminal"));
        }
      } catch (err) {
        reject(err);
      }
    });
  }, [addLog]);

  const confirmTerminalComplete = useCallback(() => {
    if (terminalResolve) {
      terminalResolve();
      setTerminalResolve(null);
    }
    setDeployState("deploying");
    addLog("Terminal session confirmed complete, continuing deployment...");
  }, [terminalResolve, addLog]);

  // Ref for state to avoid stale closures
  const stateRef = useRef({ deployState, terminalResolve });
  stateRef.current = { deployState, terminalResolve };

  // Handle keyboard events
  useKeyboard((key) => {
    const currentState = stateRef.current;

    if (currentState.deployState === "waiting_terminal") {
      // User presses Enter to confirm terminal setup is complete
      if (key.name === "return") {
        confirmTerminalComplete();
      }
    } else if (currentState.deployState === "confirming" && confirmPrompt) {
      if (key.name === "y" || key.name === "return") {
        confirmPrompt.resolve(true);
        setConfirmPrompt(null);
        setDeployState("deploying");
      } else if (key.name === "n" || key.name === "escape") {
        confirmPrompt.resolve(false);
        setConfirmPrompt(null);
        setDeployState("deploying");
      }
    } else if (currentState.deployState === "success" || currentState.deployState === "failed") {
      context.navigateTo("home");
    }
  });

  useEffect(() => {
    if (!deploymentName) {
      context.navigateTo("home");
      return;
    }

    const runDeployment = async () => {
      try {
        addLog(`Starting deployment: ${deploymentName}`);

        await startDeployment(
          deploymentName,
          handleProgress,
          handleConfirm,
          handleOpenUrl,
          handleSpawnTerminal
        );

        setDeployState("success");
        addLog("Deployment completed successfully!");
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        setError(errorMessage);
        setDeployState("failed");
        addLog(`Deployment failed: ${errorMessage}`);

        // Also log the checkpoint if available from DeploymentError
        if (err && typeof err === "object" && "checkpoint" in err) {
          addLog(`Failed at checkpoint: ${(err as { checkpoint: string }).checkpoint}`);
        }
      }
    };

    runDeployment();
  }, [deploymentName, addLog, handleConfirm, handleOpenUrl, handleProgress, handleSpawnTerminal, context]);

  const renderProgressBar = () => {
    if (!progress) return null;

    const width = 40;
    const filled = Math.round((progress.progress / 100) * width);
    const empty = width - filled;

    return (
      <box flexDirection="column" marginBottom={1}>
        <box flexDirection="row">
          <text fg={t.fg.secondary}>[</text>
          <text fg={t.status.success}>{"█".repeat(filled)}</text>
          <text fg={t.fg.muted}>{"░".repeat(empty)}</text>
          <text fg={t.fg.secondary}>]</text>
          <text fg={t.fg.primary}> {Math.round(progress.progress)}%</text>
        </box>
        <text fg={t.accent} marginTop={1}>Current: {progress.message}</text>
      </box>
    );
  };

  const renderConfirmDialog = () => {
    if (!confirmPrompt) return null;

    // Split message into lines and render each separately to avoid overlap
    const lines = confirmPrompt.message.split("\n");

    return (
      <box
        flexDirection="column"
        borderStyle="double"
        borderColor={t.status.warning}
        padding={1}
        marginBottom={1}
      >
        <text fg={t.status.warning}>Confirmation Required</text>
        <box flexDirection="column" marginTop={1}>
          {lines.map((line, i) => (
            <text key={i} fg={t.fg.primary}>{line}</text>
          ))}
        </box>
        <text fg={t.status.warning} marginTop={1}>Press Y for Yes, N for No</text>
      </box>
    );
  };

  const renderWaitingTerminal = () => {
    return (
      <box flexDirection="column" flexGrow={1}>
        <box
          flexDirection="column"
          borderStyle="double"
          borderColor={t.accent}
          padding={1}
          marginBottom={1}
        >
          <text fg={t.accent}>Interactive Setup</text>
          <text fg={t.fg.primary} marginTop={1}>A terminal window has been opened.</text>
        </box>

        <box
          flexDirection="column"
          borderStyle="single"
          borderColor={t.border.default}
          padding={1}
          marginBottom={1}
        >
          <text fg={t.status.warning}>Instructions:</text>
          <box flexDirection="column" marginTop={1}>
            <text fg={t.fg.primary}>1. Complete the setup in the terminal window</text>
            <text fg={t.fg.primary}>2. Follow the prompts shown in the terminal</text>
            <text fg={t.fg.primary}>3. When done, close the terminal window</text>
            <text fg={t.fg.primary}>4. Press Enter here to continue</text>
          </box>
        </box>

        <box
          flexDirection="column"
          borderStyle="single"
          borderColor={t.status.success}
          padding={1}
        >
          <text fg={t.status.success}>Press Enter when you have completed the setup in the terminal</text>
        </box>
      </box>
    );
  };

  const renderSuccess = () => {
    const state = readDeploymentState(deploymentName!);

    return (
      <box flexDirection="column">
        <box
          flexDirection="column"
          borderStyle="double"
          borderColor={t.status.success}
          padding={1}
          marginBottom={1}
        >
          <text fg={t.status.success}>Deployment Successful!</text>
          <text fg={t.status.success} marginTop={1}>Your OpenClaw instance is now running.</text>
        </box>

        <box
          flexDirection="column"
          borderStyle="single"
          borderColor={t.border.default}
          padding={1}
          marginBottom={1}
        >
          <text fg={t.fg.primary}>Connection Details</text>
          <box flexDirection="row" marginTop={1}>
            <text fg={t.fg.secondary} width={15}>Server IP:</text>
            <text fg={t.accent}>{state.serverIp || "N/A"}</text>
          </box>
          <box flexDirection="row">
            <text fg={t.fg.secondary} width={15}>Tailscale IP:</text>
            <text fg={t.accent}>{state.tailscaleIp || "N/A"}</text>
          </box>
          <box flexDirection="row">
            <text fg={t.fg.secondary} width={15}>Gateway Port:</text>
            <text fg={t.accent}>18789</text>
          </box>
        </box>

        <text fg={t.status.success}>Next steps:</text>
        <text fg={t.fg.primary}>  /ssh  - Connect to your server</text>
        <text fg={t.fg.primary}>  /logs - View OpenClaw logs</text>
        <text fg={t.fg.primary}>  Gateway: http://{state.tailscaleIp || state.serverIp}:18789/</text>

        <text fg={t.fg.muted} marginTop={2}>Press any key to return to home</text>
      </box>
    );
  };

  const renderFailed = () => {
    return (
      <box flexDirection="column">
        <box
          flexDirection="column"
          borderStyle="double"
          borderColor={t.status.error}
          padding={1}
          marginBottom={1}
        >
          <text fg={t.status.error}>Deployment Failed</text>
          <text fg={t.fg.primary} marginTop={1}>Something went wrong during deployment.</text>
          <text fg={t.status.error} marginTop={1}>Error: {error}</text>
        </box>

        <box flexDirection="column" marginBottom={1}>
          <text fg={t.fg.primary}>What you can do:</text>
          <text fg={t.fg.secondary}>  1. Run /deploy again - it will resume from the last successful step</text>
          <text fg={t.fg.secondary}>  2. Run /status to check the current state of your deployment</text>
          <text fg={t.fg.secondary}>  3. Run /destroy and /new to start fresh if the issue persists</text>
        </box>

        <text fg={t.fg.muted} marginTop={1}>Press any key to return to home</text>
      </box>
    );
  };

  return (
    <box flexDirection="column" width="100%" padding={1}>
      {/* Header */}
      <box flexDirection="row" marginBottom={2}>
        <text fg={t.accent}>Deploying: {deploymentName}</text>
      </box>

      {/* Progress */}
      {deployState === "deploying" && renderProgressBar()}

      {/* Confirm Dialog */}
      {deployState === "confirming" && renderConfirmDialog()}

      {/* Waiting for Terminal */}
      {deployState === "waiting_terminal" && renderWaitingTerminal()}

      {/* Success */}
      {deployState === "success" && renderSuccess()}

      {/* Failed */}
      {deployState === "failed" && renderFailed()}

      {/* Logs */}
      <box
        flexDirection="column"
        borderStyle="single"
        borderColor={t.border.default}
        padding={1}
      >
        <text fg={t.fg.secondary}>Deployment Log</text>
        <box flexDirection="column" marginTop={1}>
          {logs.map((log, i) => (
            <text key={i} fg={t.fg.muted}>{log}</text>
          ))}
        </box>
      </box>
    </box>
  );
}
