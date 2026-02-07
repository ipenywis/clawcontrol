import type {
  HetznerServer,
  HetznerSSHKey,
  HetznerServerType,
  HetznerLocation,
} from "../../types/index.js";

const HETZNER_API_BASE = "https://api.hetzner.cloud/v1";

interface HetznerError {
  error: {
    code: string;
    message: string;
  };
}

interface HetznerAPIResponse<T> {
  data?: T;
  error?: HetznerError["error"];
}

export class HetznerAPIError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "HetznerAPIError";
    this.code = code;
  }
}

export class HetznerClient {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private async request<T>(
    method: string,
    endpoint: string,
    body?: unknown
  ): Promise<T> {
    const url = `${HETZNER_API_BASE}${endpoint}`;

    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const data = await response.json();

    if (!response.ok) {
      const error = data as HetznerError;
      throw new HetznerAPIError(
        error.error?.code || "unknown",
        error.error?.message || "Unknown Hetzner API error"
      );
    }

    return data as T;
  }

  // ============ SSH Keys ============

  /**
   * List all SSH keys in the project
   */
  async listSSHKeys(): Promise<HetznerSSHKey[]> {
    const response = await this.request<{ ssh_keys: HetznerSSHKey[] }>(
      "GET",
      "/ssh_keys"
    );
    return response.ssh_keys;
  }

  /**
   * Create a new SSH key
   */
  async createSSHKey(
    name: string,
    publicKey: string
  ): Promise<HetznerSSHKey> {
    const response = await this.request<{ ssh_key: HetznerSSHKey }>(
      "POST",
      "/ssh_keys",
      {
        name,
        public_key: publicKey,
      }
    );
    return response.ssh_key;
  }

  /**
   * Delete an SSH key
   */
  async deleteSSHKey(id: number): Promise<void> {
    await this.request("DELETE", `/ssh_keys/${id}`);
  }

  /**
   * Get SSH key by ID
   */
  async getSSHKey(id: number): Promise<HetznerSSHKey> {
    const response = await this.request<{ ssh_key: HetznerSSHKey }>(
      "GET",
      `/ssh_keys/${id}`
    );
    return response.ssh_key;
  }

  // ============ Servers ============

  /**
   * List all servers in the project
   */
  async listServers(): Promise<HetznerServer[]> {
    const response = await this.request<{ servers: HetznerServer[] }>(
      "GET",
      "/servers"
    );
    return response.servers;
  }

  /**
   * Get server by ID
   */
  async getServer(id: number): Promise<HetznerServer> {
    const response = await this.request<{ server: HetznerServer }>(
      "GET",
      `/servers/${id}`
    );
    return response.server;
  }

  /**
   * Create a new server
   */
  async createServer(params: {
    name: string;
    server_type: string;
    image: string;
    location: string;
    ssh_keys: number[];
    start_after_create?: boolean;
    user_data?: string;
  }): Promise<{
    server: HetznerServer;
    action: { id: number; status: string };
    root_password?: string;
  }> {
    return await this.request(
      "POST",
      "/servers",
      {
        ...params,
        start_after_create: params.start_after_create ?? true,
      }
    );
  }

  /**
   * Delete a server
   */
  async deleteServer(id: number): Promise<void> {
    await this.request("DELETE", `/servers/${id}`);
  }

  /**
   * Power on a server
   */
  async powerOnServer(id: number): Promise<void> {
    await this.request("POST", `/servers/${id}/actions/poweron`);
  }

  /**
   * Power off a server (hard shutdown)
   */
  async powerOffServer(id: number): Promise<void> {
    await this.request("POST", `/servers/${id}/actions/poweroff`);
  }

  /**
   * Reboot a server
   */
  async rebootServer(id: number): Promise<void> {
    await this.request("POST", `/servers/${id}/actions/reboot`);
  }

  /**
   * Shutdown a server gracefully
   */
  async shutdownServer(id: number): Promise<void> {
    await this.request("POST", `/servers/${id}/actions/shutdown`);
  }

  /**
   * Wait for server to be running
   */
  async waitForServerRunning(
    id: number,
    timeoutMs: number = 120000,
    pollIntervalMs: number = 3000
  ): Promise<HetznerServer> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const server = await this.getServer(id);

      if (server.status === "running") {
        return server;
      }

      if (server.status === "off" || server.status === "deleting") {
        throw new HetznerAPIError(
          "server_not_running",
          `Server entered unexpected state: ${server.status}`
        );
      }

      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    throw new HetznerAPIError(
      "timeout",
      `Server did not start within ${timeoutMs / 1000} seconds`
    );
  }

  // ============ Server Types ============

  /**
   * List available server types
   */
  async listServerTypes(): Promise<HetznerServerType[]> {
    const response = await this.request<{ server_types: HetznerServerType[] }>(
      "GET",
      "/server_types"
    );
    return response.server_types;
  }

  /**
   * Get server type by ID or name
   */
  async getServerType(idOrName: number | string): Promise<HetznerServerType> {
    const response = await this.request<{ server_type: HetznerServerType }>(
      "GET",
      `/server_types/${idOrName}`
    );
    return response.server_type;
  }

  // ============ Locations ============

  /**
   * List available locations
   */
  async listLocations(): Promise<HetznerLocation[]> {
    const response = await this.request<{ locations: HetznerLocation[] }>(
      "GET",
      "/locations"
    );
    return response.locations;
  }

  /**
   * Get location by ID or name
   */
  async getLocation(idOrName: number | string): Promise<HetznerLocation> {
    const response = await this.request<{ location: HetznerLocation }>(
      "GET",
      `/locations/${idOrName}`
    );
    return response.location;
  }

  // ============ Actions ============

  /**
   * Get action status
   */
  async getAction(id: number): Promise<{ id: number; status: string; progress: number }> {
    const response = await this.request<{
      action: { id: number; status: string; progress: number };
    }>("GET", `/actions/${id}`);
    return response.action;
  }

  /**
   * Wait for action to complete
   */
  async waitForAction(
    actionId: number,
    timeoutMs: number = 300000,
    pollIntervalMs: number = 2000
  ): Promise<void> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const action = await this.getAction(actionId);

      if (action.status === "success") {
        return;
      }

      if (action.status === "error") {
        throw new HetznerAPIError("action_failed", "Action failed");
      }

      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    throw new HetznerAPIError(
      "timeout",
      `Action did not complete within ${timeoutMs / 1000} seconds`
    );
  }

  // ============ Validation ============

  /**
   * Test API key validity
   */
  async validateAPIKey(): Promise<boolean> {
    try {
      await this.listServers();
      return true;
    } catch (error) {
      if (error instanceof HetznerAPIError && error.code === "unauthorized") {
        return false;
      }
      throw error;
    }
  }
}

/**
 * Create a new Hetzner API client
 */
export function createHetznerClient(apiKey: string): HetznerClient {
  return new HetznerClient(apiKey);
}
