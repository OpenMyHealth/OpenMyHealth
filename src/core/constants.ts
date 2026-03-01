export const DB_NAME = "openmyhealth_vault";
export const DB_VERSION = 2;
export const SCHEMA_VERSION = 1;

export const PBKDF2_ITERATIONS = 600_000;
export const PBKDF2_HASH = "SHA-256";
export const SALT_BYTES = 16;
export const GCM_IV_BYTES = 12;
export const GCM_TAG_BITS = 128;

export const MCP_TIMEOUT_MS = 60_000;
export const MAX_QUEUE_LENGTH = 20;
export const MAX_UPLOAD_BYTES = 30 * 1024 * 1024;

export const VAULT_PAGE_PATH = "/vault.html";
export const SETUP_PAGE_PATH = "/setup.html";

export const PROVIDER_HOSTS: Record<import("../../packages/contracts/src/index").AiProvider, string[]> = {
  chatgpt: ["chatgpt.com"],
  claude: ["claude.ai"],
  // Gemini is intentionally disabled in v0.1 scope.
  gemini: [],
};
