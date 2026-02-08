/**
 * ClawControl Theme System
 *
 * A centralized, semantic color system inspired by Tailwind CSS design tokens.
 * All UI colors are defined here — components import `t` (theme) and helpers
 * instead of using hardcoded color strings.
 *
 * Structure:
 *   palette  → raw hex colors (like tailwind's color scales)
 *   t        → semantic tokens mapped to palette values
 *   helpers  → statusColor(), logLevelColor() for dynamic coloring
 */

// ---------------------------------------------------------------------------
// Raw palette — the only place hex values live
// ---------------------------------------------------------------------------
const palette = {
  gray: {
    950: "#09090b", // deepest bg
    900: "#0c0d10", // main bg
    850: "#121318", // elevated bg
    800: "#1a1c23", // card / panel bg
    750: "#22252e", // input bg
    700: "#2a2d38", // borders, dividers
    600: "#3a3d4a", // selected bg, subtle borders
    500: "#555869", // muted text
    400: "#7a7d8e", // secondary text
    300: "#9a9db0", // placeholder
    200: "#b8bbd0", // normal text
    100: "#d4d7e8", // bright text
    50: "#e8eaf5",  // headings, high contrast
  },
  blue: {
    600: "#3b6fc2",
    500: "#4a80d4",
    400: "#6b9fff",
    300: "#94baff",
  },
  green: {
    500: "#3d9960",
    400: "#4fc47a",
  },
  red: {
    500: "#b84040",
    400: "#e06060",
  },
  yellow: {
    500: "#b8a040",
    400: "#d4c45c",
  },
};

// ---------------------------------------------------------------------------
// Semantic theme tokens — what components actually use
// ---------------------------------------------------------------------------
export const t = {
  // Backgrounds
  bg: {
    base: palette.gray[900],
    surface: palette.gray[800],
    elevated: palette.gray[750],
    hover: palette.gray[700],
    selected: palette.gray[600],
    overlay: palette.gray[850],
  },

  // Foreground / Text
  fg: {
    primary: palette.gray[100],
    secondary: palette.gray[400],
    muted: palette.gray[500],
    heading: palette.gray[50],
  },

  // Borders
  border: {
    default: palette.gray[700],
    subtle: palette.gray[800],
    focus: palette.blue[500],
  },

  // Accent (primary brand color)
  accent: palette.blue[400],

  // Semantic / status colors
  status: {
    success: palette.green[400],
    error: palette.red[400],
    warning: palette.yellow[400],
    info: palette.blue[400],
  },

  // Selection highlighting
  selection: {
    bg: palette.gray[600],
    fg: palette.gray[50],
    indicator: palette.blue[400],
  },

  // Log level colors
  log: {
    error: palette.red[400],
    warn: palette.yellow[400],
    info: palette.gray[200],
    debug: palette.gray[500],
  },
} as const;

// ---------------------------------------------------------------------------
// Helper functions for dynamic coloring
// ---------------------------------------------------------------------------

/** Map a deployment status string to a theme color */
export function statusColor(status: string): string {
  switch (status) {
    case "deployed":
      return t.status.success;
    case "failed":
      return t.status.error;
    case "initialized":
      return t.status.warning;
    default:
      return t.status.info;
  }
}

/** Map a log level string to a theme color */
export function logLevelColor(level: string): string {
  switch (level) {
    case "error":
      return t.log.error;
    case "warn":
      return t.log.warn;
    case "debug":
      return t.log.debug;
    default:
      return t.log.info;
  }
}
