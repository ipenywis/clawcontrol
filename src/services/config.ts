import { homedir } from "os";
import { join } from "path";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync } from "fs";
import {
  type DeploymentConfig,
  type DeploymentState,
  type Deployment,
  DeploymentConfigSchema,
  DeploymentStateSchema,
} from "../types/index.js";

const CLAWCONTROL_DIR = join(homedir(), ".clawcontrol");
const DEPLOYMENTS_DIR = join(CLAWCONTROL_DIR, "deployments");

/**
 * Ensures the .clawcontrol directory structure exists
 */
export function ensureConfigDir(): void {
  if (!existsSync(CLAWCONTROL_DIR)) {
    mkdirSync(CLAWCONTROL_DIR, { recursive: true });
  }
  if (!existsSync(DEPLOYMENTS_DIR)) {
    mkdirSync(DEPLOYMENTS_DIR, { recursive: true });
  }
}

/**
 * Gets the path to a deployment's directory
 */
export function getDeploymentDir(name: string): string {
  return join(DEPLOYMENTS_DIR, name);
}

/**
 * Gets the path to a deployment's config file
 */
export function getConfigPath(name: string): string {
  return join(getDeploymentDir(name), "config.json");
}

/**
 * Gets the path to a deployment's state file
 */
export function getStatePath(name: string): string {
  return join(getDeploymentDir(name), "state.json");
}

/**
 * Gets the path to a deployment's SSH directory
 */
export function getSSHDir(name: string): string {
  return join(getDeploymentDir(name), "ssh");
}

/**
 * Gets the path to a deployment's private SSH key
 */
export function getSSHKeyPath(name: string): string {
  return join(getSSHDir(name), "id_ed25519");
}

/**
 * Gets the path to a deployment's public SSH key
 */
export function getSSHPubKeyPath(name: string): string {
  return join(getSSHDir(name), "id_ed25519.pub");
}

/**
 * Checks if a deployment exists
 */
export function deploymentExists(name: string): boolean {
  return existsSync(getConfigPath(name));
}

/**
 * Lists all deployment names
 */
export function listDeployments(): string[] {
  ensureConfigDir();

  if (!existsSync(DEPLOYMENTS_DIR)) {
    return [];
  }

  return readdirSync(DEPLOYMENTS_DIR, { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory())
    .filter((dirent) => existsSync(getConfigPath(dirent.name)))
    .map((dirent) => dirent.name);
}

/**
 * Creates a new deployment configuration
 */
export function createDeployment(config: DeploymentConfig): void {
  ensureConfigDir();

  const deploymentDir = getDeploymentDir(config.name);
  const sshDir = getSSHDir(config.name);

  if (existsSync(deploymentDir)) {
    throw new Error(`Deployment "${config.name}" already exists`);
  }

  // Validate config BEFORE creating directories to avoid orphan directories on validation failure
  const validatedConfig = DeploymentConfigSchema.parse(config);

  // Create directories
  mkdirSync(deploymentDir, { recursive: true });
  mkdirSync(sshDir, { recursive: true, mode: 0o700 });

  // Save config
  writeFileSync(
    getConfigPath(config.name),
    JSON.stringify(validatedConfig, null, 2)
  );

  // Create initial state
  const initialState: DeploymentState = {
    status: "initialized",
    checkpoints: [],
    updatedAt: new Date().toISOString(),
  };

  writeFileSync(getStatePath(config.name), JSON.stringify(initialState, null, 2));
}

/**
 * Reads a deployment's configuration
 */
export function readDeploymentConfig(name: string): DeploymentConfig {
  const configPath = getConfigPath(name);

  if (!existsSync(configPath)) {
    throw new Error(`Deployment "${name}" not found`);
  }

  const raw = readFileSync(configPath, "utf-8");
  return DeploymentConfigSchema.parse(JSON.parse(raw));
}

/**
 * Reads a deployment's state
 */
export function readDeploymentState(name: string): DeploymentState {
  const statePath = getStatePath(name);

  if (!existsSync(statePath)) {
    // Return initial state if state file doesn't exist
    return {
      status: "initialized",
      checkpoints: [],
      updatedAt: new Date().toISOString(),
    };
  }

  const raw = readFileSync(statePath, "utf-8");
  return DeploymentStateSchema.parse(JSON.parse(raw));
}

/**
 * Updates a deployment's state
 */
export function updateDeploymentState(
  name: string,
  update: Partial<DeploymentState>
): DeploymentState {
  const currentState = readDeploymentState(name);
  const newState: DeploymentState = {
    ...currentState,
    ...update,
    updatedAt: new Date().toISOString(),
  };

  const validatedState = DeploymentStateSchema.parse(newState);
  writeFileSync(getStatePath(name), JSON.stringify(validatedState, null, 2));

  return validatedState;
}

/**
 * Reads a full deployment (config + state)
 */
export function readDeployment(name: string): Deployment {
  return {
    config: readDeploymentConfig(name),
    state: readDeploymentState(name),
    sshKeyPath: getSSHKeyPath(name),
  };
}

/**
 * Gets all deployments
 */
export function getAllDeployments(): Deployment[] {
  return listDeployments().map(readDeployment);
}

/**
 * Deletes a deployment
 */
export function deleteDeployment(name: string): void {
  const deploymentDir = getDeploymentDir(name);

  if (!existsSync(deploymentDir)) {
    throw new Error(`Deployment "${name}" not found`);
  }

  rmSync(deploymentDir, { recursive: true, force: true });
}

/**
 * Validates a deployment name
 */
export function validateDeploymentName(name: string): { valid: boolean; error?: string } {
  if (!name || name.trim() === "") {
    return { valid: false, error: "Deployment name cannot be empty" };
  }

  if (name.length > 63) {
    return { valid: false, error: "Deployment name must be 63 characters or less" };
  }

  // Must match RFC 1123 hostname format for Hetzner compatibility
  const validPattern = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;
  if (!validPattern.test(name)) {
    return {
      valid: false,
      error:
        "Deployment name must contain only lowercase letters, numbers, and hyphens, and must start and end with a letter or number",
    };
  }

  if (deploymentExists(name)) {
    return { valid: false, error: `Deployment "${name}" already exists` };
  }

  return { valid: true };
}

export const configPaths = {
  root: CLAWCONTROL_DIR,
  deployments: DEPLOYMENTS_DIR,
};
