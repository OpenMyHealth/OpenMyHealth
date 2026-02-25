export const STORAGE_KEYS = {
  VAULT_ENVELOPE: "omh.vault.envelope",
  VAULT_META: "omh.vault.meta",
  SOURCE_STATE: "omh.vault.sources",
} as const;

export const VAULT_VERSION = 1;
export const EMBEDDING_DIM = 256;
export const APPROVAL_DEFAULT_LIMIT = 12;

export const SOURCE_IDS = {
  KR_HIRA: "kr-hira",
  MANUAL: "manual",
} as const;

export const CHAT_HOSTS = [
  "https://chatgpt.com/*",
  "https://chat.openai.com/*",
  "https://gemini.google.com/*",
  "https://claude.ai/*",
] as const;
