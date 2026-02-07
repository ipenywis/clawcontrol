import { Client, type ConnectConfig, type ClientChannel } from "ssh2";
import { generateKeyPairSync, randomBytes } from "crypto";
import { readFileSync, writeFileSync, chmodSync, existsSync } from "fs";
import { getSSHKeyPath, getSSHPubKeyPath, getSSHDir } from "./config.js";
import { mkdirSync } from "fs";

export interface SSHKeyPair {
  privateKey: string;
  publicKey: string;
}

export interface SSHCommandResult {
  stdout: string;
  stderr: string;
  code: number;
}

/**
 * Generate an ED25519 SSH key pair in OpenSSH format
 */
export function generateSSHKeyPair(comment: string = "clawcontrol"): SSHKeyPair {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519", {
    publicKeyEncoding: {
      type: "spki",
      format: "pem",
    },
    privateKeyEncoding: {
      type: "pkcs8",
      format: "pem",
    },
  });

  // Extract raw key bytes from PEM formats
  const pubKeyDer = extractDERFromPEM(publicKey);
  const privKeyDer = extractDERFromPEM(privateKey);

  // ED25519 public key is the last 32 bytes of the SPKI DER structure
  const publicKeyBytes = pubKeyDer.slice(-32);

  // ED25519 private key seed is the last 32 bytes of the PKCS#8 DER structure
  const privateKeyBytes = privKeyDer.slice(-32);

  // Build OpenSSH format public key
  const publicKeyOpenSSH = buildOpenSSHPublicKey(publicKeyBytes, comment);

  // Build OpenSSH format private key
  const privateKeyOpenSSH = buildOpenSSHPrivateKey(privateKeyBytes, publicKeyBytes, comment);

  return {
    privateKey: privateKeyOpenSSH,
    publicKey: publicKeyOpenSSH,
  };
}

/**
 * Extract DER bytes from PEM format
 */
function extractDERFromPEM(pem: string): Buffer {
  const lines = pem.split("\n").filter((line) => !line.startsWith("-----") && line.trim() !== "");
  return Buffer.from(lines.join(""), "base64");
}

/**
 * Build OpenSSH format public key string
 */
function buildOpenSSHPublicKey(publicKeyBytes: Buffer, comment: string): string {
  const keyType = Buffer.from("ssh-ed25519");
  const keyTypeLen = Buffer.alloc(4);
  keyTypeLen.writeUInt32BE(keyType.length);

  const keyLen = Buffer.alloc(4);
  keyLen.writeUInt32BE(publicKeyBytes.length);

  const opensshKey = Buffer.concat([keyTypeLen, keyType, keyLen, publicKeyBytes]);
  return `ssh-ed25519 ${opensshKey.toString("base64")} ${comment}`;
}

/**
 * Build OpenSSH format private key
 * Format spec: https://github.com/openssh/openssh-portable/blob/master/PROTOCOL.key
 */
function buildOpenSSHPrivateKey(privateKeyBytes: Buffer, publicKeyBytes: Buffer, comment: string): string {
  const AUTH_MAGIC = Buffer.from("openssh-key-v1\0");
  const cipherName = Buffer.from("none");
  const kdfName = Buffer.from("none");
  const kdfOptions = Buffer.alloc(0);
  const numKeys = 1;

  // Build public key blob
  const keyType = Buffer.from("ssh-ed25519");
  const pubKeyBlob = Buffer.concat([
    uint32BE(keyType.length), keyType,
    uint32BE(publicKeyBytes.length), publicKeyBytes,
  ]);

  // Generate check integers (must match for decryption verification)
  const checkInt = randomBytes(4);

  // Build private section
  // ED25519 private key in OpenSSH format is: private_seed (32 bytes) + public_key (32 bytes) = 64 bytes
  const ed25519PrivKey = Buffer.concat([privateKeyBytes, publicKeyBytes]);
  const commentBuf = Buffer.from(comment);

  const privateSection = Buffer.concat([
    checkInt, checkInt, // Two identical check integers
    uint32BE(keyType.length), keyType,
    uint32BE(publicKeyBytes.length), publicKeyBytes,
    uint32BE(ed25519PrivKey.length), ed25519PrivKey,
    uint32BE(commentBuf.length), commentBuf,
  ]);

  // Add padding to make length multiple of cipher block size (8 for none)
  const blockSize = 8;
  const paddingLen = blockSize - (privateSection.length % blockSize);
  const padding = Buffer.alloc(paddingLen);
  for (let i = 0; i < paddingLen; i++) {
    padding[i] = i + 1;
  }
  const paddedPrivate = Buffer.concat([privateSection, padding]);

  // Assemble the full key
  const fullKey = Buffer.concat([
    AUTH_MAGIC,
    uint32BE(cipherName.length), cipherName,
    uint32BE(kdfName.length), kdfName,
    uint32BE(kdfOptions.length), kdfOptions,
    uint32BE(numKeys),
    uint32BE(pubKeyBlob.length), pubKeyBlob,
    uint32BE(paddedPrivate.length), paddedPrivate,
  ]);

  // Wrap in PEM format
  const b64 = fullKey.toString("base64");
  const lines = b64.match(/.{1,70}/g) || [];
  return `-----BEGIN OPENSSH PRIVATE KEY-----\n${lines.join("\n")}\n-----END OPENSSH PRIVATE KEY-----\n`;
}

/**
 * Helper to create a 4-byte big-endian buffer
 */
function uint32BE(value: number): Buffer {
  const buf = Buffer.alloc(4);
  buf.writeUInt32BE(value);
  return buf;
}

/**
 * Save SSH key pair for a deployment
 */
export function saveSSHKeyPair(deploymentName: string, keyPair: SSHKeyPair): void {
  const sshDir = getSSHDir(deploymentName);
  const privateKeyPath = getSSHKeyPath(deploymentName);
  const publicKeyPath = getSSHPubKeyPath(deploymentName);

  // Ensure SSH directory exists with proper permissions
  if (!existsSync(sshDir)) {
    mkdirSync(sshDir, { recursive: true, mode: 0o700 });
  }

  // Write private key with restricted permissions
  writeFileSync(privateKeyPath, keyPair.privateKey, { mode: 0o600 });
  chmodSync(privateKeyPath, 0o600);

  // Write public key
  writeFileSync(publicKeyPath, keyPair.publicKey, { mode: 0o644 });
}

/**
 * Load SSH key pair for a deployment
 */
export function loadSSHKeyPair(deploymentName: string): SSHKeyPair | null {
  const privateKeyPath = getSSHKeyPath(deploymentName);
  const publicKeyPath = getSSHPubKeyPath(deploymentName);

  if (!existsSync(privateKeyPath) || !existsSync(publicKeyPath)) {
    return null;
  }

  return {
    privateKey: readFileSync(privateKeyPath, "utf-8"),
    publicKey: readFileSync(publicKeyPath, "utf-8"),
  };
}

/**
 * SSH Connection manager for persistent connections
 */
export class SSHConnection {
  private client: Client;
  private connected: boolean = false;
  private config: ConnectConfig;

  constructor(config: ConnectConfig) {
    this.client = new Client();
    this.config = config;
  }

  /**
   * Connect to the SSH server
   */
  async connect(retries: number = 3, delayMs: number = 5000): Promise<void> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        await this.attemptConnect();
        this.connected = true;
        return;
      } catch (error) {
        lastError = error as Error;
        if (attempt < retries) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }
    }

    throw new Error(
      `Failed to connect after ${retries} attempts: ${lastError?.message}`
    );
  }

  private attemptConnect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.client.end();
        reject(new Error("Connection timeout"));
      }, 30000);

      this.client.on("ready", () => {
        clearTimeout(timeout);
        resolve();
      });

      this.client.on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });

      this.client.connect(this.config);
    });
  }

  /**
   * Execute a command on the remote server
   */
  async exec(command: string): Promise<SSHCommandResult> {
    if (!this.connected) {
      throw new Error("SSH not connected");
    }

    return new Promise((resolve, reject) => {
      this.client.exec(command, (err, stream) => {
        if (err) {
          reject(err);
          return;
        }

        let stdout = "";
        let stderr = "";

        stream.on("close", (code: number) => {
          resolve({ stdout, stderr, code: code ?? 0 });
        });

        stream.on("data", (data: Buffer) => {
          stdout += data.toString();
        });

        stream.stderr.on("data", (data: Buffer) => {
          stderr += data.toString();
        });
      });
    });
  }

  /**
   * Execute a command and stream output
   */
  execStream(
    command: string,
    onStdout: (data: string) => void,
    onStderr: (data: string) => void
  ): Promise<number> {
    if (!this.connected) {
      throw new Error("SSH not connected");
    }

    return new Promise((resolve, reject) => {
      this.client.exec(command, (err, stream) => {
        if (err) {
          reject(err);
          return;
        }

        stream.on("close", (code: number) => {
          resolve(code ?? 0);
        });

        stream.on("data", (data: Buffer) => {
          onStdout(data.toString());
        });

        stream.stderr.on("data", (data: Buffer) => {
          onStderr(data.toString());
        });
      });
    });
  }

  /**
   * Open an interactive shell session
   */
  shell(useDumbTerminal: boolean = false): Promise<ClientChannel> {
    if (!this.connected) {
      throw new Error("SSH not connected");
    }

    return new Promise((resolve, reject) => {
      const callback = (err: Error | undefined, stream: ClientChannel) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(stream);
      };

      if (useDumbTerminal) {
        this.client.shell({
          term: 'dumb',
          cols: 120,
          rows: 40,
          modes: {}
        }, callback);
      } else {
        this.client.shell(callback);
      }
    });
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Disconnect from the SSH server
   */
  disconnect(): void {
    this.client.end();
    this.connected = false;
  }

  /**
   * Get the underlying ssh2 client for advanced usage
   */
  getClient(): Client {
    return this.client;
  }
}

/**
 * Create an SSH connection to a server
 */
export function createSSHConnection(
  host: string,
  privateKey: string,
  username: string = "root",
  port: number = 22
): SSHConnection {
  return new SSHConnection({
    host,
    port,
    username,
    privateKey,
    readyTimeout: 30000,
    keepaliveInterval: 10000,
    keepaliveCountMax: 3,
  });
}

/**
 * Create an SSH connection for a deployment
 */
export async function connectToDeployment(
  deploymentName: string,
  serverIp: string
): Promise<SSHConnection> {
  const keyPair = loadSSHKeyPair(deploymentName);

  if (!keyPair) {
    throw new Error(`No SSH keys found for deployment "${deploymentName}"`);
  }

  const connection = createSSHConnection(serverIp, keyPair.privateKey);
  await connection.connect();

  return connection;
}

/**
 * Test SSH connectivity to a server
 */
export async function testSSHConnection(
  host: string,
  privateKey: string,
  timeoutMs: number = 30000
): Promise<boolean> {
  const connection = createSSHConnection(host, privateKey);

  try {
    await connection.connect(1, 0);
    const result = await connection.exec("echo 'ok'");
    connection.disconnect();
    return result.code === 0 && result.stdout.trim() === "ok";
  } catch {
    return false;
  }
}

/**
 * Wait for SSH to become available on a server
 */
export async function waitForSSH(
  host: string,
  privateKey: string,
  timeoutMs: number = 180000,
  pollIntervalMs: number = 5000
): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    if (await testSSHConnection(host, privateKey, 10000)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error(`SSH not available after ${timeoutMs / 1000} seconds`);
}
