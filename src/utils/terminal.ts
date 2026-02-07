import { spawn, spawnSync, execSync } from "child_process";
import { platform } from "os";

export type TerminalApp =
  | "terminal.app"      // macOS Terminal
  | "iterm2"            // iTerm2
  | "ghostty"           // Ghostty
  | "kitty"             // Kitty
  | "alacritty"         // Alacritty
  | "wezterm"           // WezTerm
  | "hyper"             // Hyper
  | "vscode"            // VS Code integrated terminal
  | "cursor"            // Cursor integrated terminal
  | "gnome-terminal"    // GNOME Terminal
  | "konsole"           // KDE Konsole
  | "xfce4-terminal"    // XFCE Terminal
  | "xterm"             // XTerm
  | "unknown";

interface TerminalInfo {
  app: TerminalApp;
  canOpenTab: boolean;
}

/**
 * Check if we're running inside a specific app by checking the process tree
 */
function isRunningUnderApp(appName: string): boolean {
  if (platform() !== "darwin") return false;

  try {
    // Get the process tree and check if any parent is the app
    const result = execSync(
      `ps -o ppid= -p $$ 2>/dev/null && pstree -p $$ 2>/dev/null | grep -i "${appName}" || ps -e -o pid,comm 2>/dev/null | grep -i "${appName}"`,
      { encoding: "utf-8", timeout: 1000 }
    );
    return result.toLowerCase().includes(appName.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * Check parent process for Cursor/VS Code on macOS
 */
function getParentAppBundle(): string | null {
  if (platform() !== "darwin") return null;

  try {
    // Walk up the process tree to find the app bundle
    let pid = process.ppid;
    for (let i = 0; i < 10 && pid > 1; i++) {
      const result = execSync(`ps -o comm= -p ${pid} 2>/dev/null`, { encoding: "utf-8", timeout: 500 }).trim();

      if (result.includes("Cursor")) return "cursor";
      if (result.includes("Code") || result.includes("code")) return "vscode";
      if (result.includes("Electron") && process.env.CURSOR_CHANNEL) return "cursor";

      // Get parent of current pid
      const ppidResult = execSync(`ps -o ppid= -p ${pid} 2>/dev/null`, { encoding: "utf-8", timeout: 500 }).trim();
      pid = parseInt(ppidResult, 10);
    }
  } catch {
    // Ignore errors
  }
  return null;
}

/**
 * Detect which terminal app is currently running
 */
export function detectTerminal(): TerminalInfo {
  const env = process.env;
  const os = platform();

  // First check for IDE terminals by process tree (most reliable for Cursor/VS Code)
  if (os === "darwin") {
    const parentApp = getParentAppBundle();
    if (parentApp === "cursor") {
      return { app: "cursor", canOpenTab: true };
    }
    if (parentApp === "vscode") {
      return { app: "vscode", canOpenTab: true };
    }
  }

  // Check for VS Code / Cursor via env vars (backup method)
  if (env.TERM_PROGRAM === "vscode" || env.VSCODE_INJECTION || env.VSCODE_GIT_IPC_HANDLE) {
    if (env.CURSOR_CHANNEL || env.VSCODE_GIT_IPC_HANDLE?.includes("Cursor")) {
      return { app: "cursor", canOpenTab: true };
    }
    return { app: "vscode", canOpenTab: true };
  }

  // Check for Ghostty (only if TERM_PROGRAM says ghostty, not just inherited vars)
  if (env.TERM_PROGRAM === "ghostty") {
    return { app: "ghostty", canOpenTab: true };
  }

  // Check for Kitty
  if (env.KITTY_WINDOW_ID || env.TERM_PROGRAM === "kitty") {
    return { app: "kitty", canOpenTab: true };
  }

  // Check for WezTerm
  if (env.WEZTERM_PANE || env.TERM_PROGRAM === "WezTerm") {
    return { app: "wezterm", canOpenTab: true };
  }

  // Check for Alacritty
  if (env.ALACRITTY_WINDOW_ID || env.ALACRITTY_LOG || env.TERM_PROGRAM === "Alacritty") {
    return { app: "alacritty", canOpenTab: false };
  }

  // Check for iTerm2
  if (env.TERM_PROGRAM === "iTerm.app" || env.ITERM_SESSION_ID) {
    return { app: "iterm2", canOpenTab: true };
  }

  // Check for Hyper
  if (env.TERM_PROGRAM === "Hyper") {
    return { app: "hyper", canOpenTab: true };
  }

  // Check for Apple Terminal
  if (env.TERM_PROGRAM === "Apple_Terminal") {
    return { app: "terminal.app", canOpenTab: true };
  }

  // Linux terminals
  if (os === "linux") {
    if (env.GNOME_TERMINAL_SCREEN || env.VTE_VERSION) {
      return { app: "gnome-terminal", canOpenTab: true };
    }
    if (env.KONSOLE_VERSION) {
      return { app: "konsole", canOpenTab: true };
    }
  }

  // Default fallback based on OS
  if (os === "darwin") {
    return { app: "terminal.app", canOpenTab: true };
  }

  return { app: "unknown", canOpenTab: false };
}

/**
 * Open a new terminal window/tab with the given command
 */
export function openTerminalWithCommand(command: string): { success: boolean; error?: string } {
  const terminal = detectTerminal();
  const os = platform();

  try {
    switch (terminal.app) {
      case "ghostty":
        return openGhostty(command);

      case "kitty":
        return openKitty(command);

      case "wezterm":
        return openWezterm(command);

      case "iterm2":
        return openITerm2(command);

      case "terminal.app":
        return openTerminalApp(command);

      case "hyper":
        return openHyper(command);

      case "cursor":
        return openCursorTerminal(command);

      case "vscode":
        return openVSCodeTerminal(command);

      case "alacritty":
        return openAlacritty(command);

      case "gnome-terminal":
        return openGnomeTerminal(command);

      case "konsole":
        return openKonsole(command);

      case "xfce4-terminal":
        return openXfce4Terminal(command);

      default:
        if (os === "darwin") {
          return openTerminalApp(command);
        } else if (os === "linux") {
          return openLinuxFallback(command);
        }
        return { success: false, error: `Unsupported terminal or OS: ${terminal.app}` };
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// Terminal-specific openers

function openGhostty(command: string): { success: boolean; error?: string } {
  if (platform() === "darwin") {
    // On macOS, use 'open' to launch Ghostty with the command
    // Ghostty on macOS requires using open -a
    const proc = spawn("open", ["-na", "Ghostty", "--args", "-e", command], {
      stdio: "ignore",
      detached: true,
    });
    proc.unref();
    return { success: true };
  } else {
    // On Linux, ghostty -e should work
    const proc = spawn("ghostty", ["-e", command], {
      stdio: "ignore",
      detached: true,
    });
    proc.unref();
    return { success: true };
  }
}

function openKitty(command: string): { success: boolean; error?: string } {
  // Kitty can open new tabs with kitten @
  const result = spawnSync("kitten", ["@", "launch", "--type=tab", "--", "sh", "-c", command], {
    stdio: "ignore",
  });

  if (result.error || result.status !== 0) {
    // Fall back to new window
    if (platform() === "darwin") {
      const proc = spawn("open", ["-na", "kitty", "--args", "sh", "-c", command], {
        stdio: "ignore",
        detached: true,
      });
      proc.unref();
    } else {
      const proc = spawn("kitty", ["sh", "-c", command], {
        stdio: "ignore",
        detached: true,
      });
      proc.unref();
    }
  }
  return { success: true };
}

function openWezterm(command: string): { success: boolean; error?: string } {
  // WezTerm can open new tabs with CLI
  const result = spawnSync("wezterm", ["cli", "spawn", "--", "sh", "-c", command], {
    stdio: "ignore",
  });

  if (result.error || result.status !== 0) {
    // Fall back to new window
    const proc = spawn("wezterm", ["start", "--", "sh", "-c", command], {
      stdio: "ignore",
      detached: true,
    });
    proc.unref();
  }
  return { success: true };
}

function openITerm2(command: string): { success: boolean; error?: string } {
  const escapedCommand = command.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const appleScript = `
    tell application "iTerm2"
      tell current window
        create tab with default profile
        tell current session
          write text "${escapedCommand}"
        end tell
      end tell
      activate
    end tell
  `;

  const proc = spawn("osascript", ["-e", appleScript], {
    stdio: "ignore",
    detached: true,
  });
  proc.unref();
  return { success: true };
}

function openTerminalApp(command: string): { success: boolean; error?: string } {
  const escapedCommand = command.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const appleScript = `
    tell application "Terminal"
      activate
      do script "${escapedCommand}"
    end tell
  `;

  const proc = spawn("osascript", ["-e", appleScript], {
    stdio: "ignore",
    detached: true,
  });
  proc.unref();
  return { success: true };
}

function openHyper(command: string): { success: boolean; error?: string } {
  if (platform() === "darwin") {
    const escapedCommand = command.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const appleScript = `
      tell application "Hyper"
        activate
        tell application "System Events"
          keystroke "t" using command down
          delay 0.5
          keystroke "${escapedCommand}"
          keystroke return
        end tell
      end tell
    `;

    const proc = spawn("osascript", ["-e", appleScript], {
      stdio: "ignore",
      detached: true,
    });
    proc.unref();
    return { success: true };
  }

  const proc = spawn("hyper", [command], {
    stdio: "ignore",
    detached: true,
  });
  proc.unref();
  return { success: true };
}

function openCursorTerminal(command: string): { success: boolean; error?: string } {
  if (platform() === "darwin") {
    // Use AppleScript to open a new terminal in Cursor and run the command
    // We use the clipboard to paste the command to avoid case sensitivity issues with keystroke
    const escapedCommand = command.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const appleScript = `
      -- Save the current clipboard
      set oldClipboard to the clipboard

      -- Set the command to clipboard
      set the clipboard to "${escapedCommand}"

      tell application "Cursor"
        activate
      end tell
      delay 0.3
      tell application "System Events"
        tell process "Cursor"
          -- Open new terminal with Ctrl+Shift+\`
          key code 50 using {control down, shift down}
          delay 0.5
          -- Paste the command with Cmd+V
          keystroke "v" using command down
          delay 0.1
          -- Press Enter
          key code 36
        end tell
      end tell

      -- Restore the original clipboard after a delay
      delay 0.5
      set the clipboard to oldClipboard
    `;

    const proc = spawn("osascript", ["-e", appleScript], {
      stdio: "ignore",
      detached: true,
    });
    proc.unref();
    return { success: true };
  }

  // Linux: Fall back to system terminal
  return openLinuxFallback(command);
}

function openVSCodeTerminal(command: string): { success: boolean; error?: string } {
  if (platform() === "darwin") {
    // Use AppleScript to open a new terminal in VS Code and run the command
    // We use the clipboard to paste the command to avoid case sensitivity issues with keystroke
    const escapedCommand = command.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const appleScript = `
      -- Save the current clipboard
      set oldClipboard to the clipboard

      -- Set the command to clipboard
      set the clipboard to "${escapedCommand}"

      tell application "Visual Studio Code"
        activate
      end tell
      delay 0.3
      tell application "System Events"
        tell process "Code"
          -- Open new terminal with Ctrl+Shift+\`
          key code 50 using {control down, shift down}
          delay 0.5
          -- Paste the command with Cmd+V
          keystroke "v" using command down
          delay 0.1
          -- Press Enter
          key code 36
        end tell
      end tell

      -- Restore the original clipboard after a delay
      delay 0.5
      set the clipboard to oldClipboard
    `;

    const proc = spawn("osascript", ["-e", appleScript], {
      stdio: "ignore",
      detached: true,
    });
    proc.unref();
    return { success: true };
  }

  // Linux: Fall back to system terminal
  return openLinuxFallback(command);
}

function openAlacritty(command: string): { success: boolean; error?: string } {
  if (platform() === "darwin") {
    const proc = spawn("open", ["-na", "Alacritty", "--args", "-e", "sh", "-c", command], {
      stdio: "ignore",
      detached: true,
    });
    proc.unref();
  } else {
    const proc = spawn("alacritty", ["-e", "sh", "-c", command], {
      stdio: "ignore",
      detached: true,
    });
    proc.unref();
  }
  return { success: true };
}

function openGnomeTerminal(command: string): { success: boolean; error?: string } {
  const result = spawnSync("gnome-terminal", ["--tab", "--", "sh", "-c", command], {
    stdio: "ignore",
  });

  if (result.error || result.status !== 0) {
    const proc = spawn("gnome-terminal", ["--", "sh", "-c", command], {
      stdio: "ignore",
      detached: true,
    });
    proc.unref();
  }
  return { success: true };
}

function openKonsole(command: string): { success: boolean; error?: string } {
  const proc = spawn("konsole", ["--new-tab", "-e", "sh", "-c", command], {
    stdio: "ignore",
    detached: true,
  });
  proc.unref();
  return { success: true };
}

function openXfce4Terminal(command: string): { success: boolean; error?: string } {
  const proc = spawn("xfce4-terminal", ["--tab", "-e", command], {
    stdio: "ignore",
    detached: true,
  });
  proc.unref();
  return { success: true };
}

function openLinuxFallback(command: string): { success: boolean; error?: string } {
  const terminals = [
    { cmd: "gnome-terminal", args: ["--", "sh", "-c", command] },
    { cmd: "konsole", args: ["-e", "sh", "-c", command] },
    { cmd: "xfce4-terminal", args: ["-e", command] },
    { cmd: "xterm", args: ["-e", command] },
  ];

  for (const terminal of terminals) {
    try {
      const proc = spawn(terminal.cmd, terminal.args, {
        stdio: "ignore",
        detached: true,
      });
      proc.unref();
      return { success: true };
    } catch {
      // Try next terminal
    }
  }

  return { success: false, error: "Could not find a supported terminal emulator" };
}

/**
 * Get a human-readable name for the detected terminal
 */
export function getTerminalDisplayName(app: TerminalApp): string {
  const names: Record<TerminalApp, string> = {
    "terminal.app": "Terminal.app",
    "iterm2": "iTerm2",
    "ghostty": "Ghostty",
    "kitty": "Kitty",
    "alacritty": "Alacritty",
    "wezterm": "WezTerm",
    "hyper": "Hyper",
    "vscode": "VS Code",
    "cursor": "Cursor",
    "gnome-terminal": "GNOME Terminal",
    "konsole": "Konsole",
    "xfce4-terminal": "XFCE Terminal",
    "xterm": "XTerm",
    "unknown": "System Terminal",
  };
  return names[app];
}
