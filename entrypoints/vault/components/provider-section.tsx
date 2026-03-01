import React from "react";
import type { AiProvider } from "../../../packages/contracts/src/index";
import { providerLabel } from "../../../src/core/utils";

type ProviderSectionProps = {
  aiConnectionRef: React.RefObject<HTMLElement | null>;
  hasFiles: boolean;
  connectedProvider: AiProvider | null;
  settingProvider: AiProvider | null;
  setProvider: (provider: AiProvider) => Promise<void>;
};

export function ProviderSection({
  aiConnectionRef,
  hasFiles,
  connectedProvider,
  settingProvider,
  setProvider,
}: ProviderSectionProps): React.ReactElement {
  const connectUrlByProvider: Record<Exclude<AiProvider, "gemini">, string> = {
    chatgpt: "https://chatgpt.com/",
    claude: "https://claude.ai/",
  };
  const providerMeta: Record<AiProvider, { icon: string; accentClass: string; requirement: string; badgeClass: string; subtitle: string }> = {
    chatgpt: {
      icon: "GPT",
      accentClass: "text-provider-chatgpt bg-provider-chatgpt-soft border-status-success-border",
      requirement: "Plus 이상 구독 필요",
      badgeClass: "bg-provider-chatgpt-soft text-provider-chatgpt border-status-success-border",
      subtitle: "건강기록 공유 지원",
    },
    claude: {
      icon: "CLD",
      accentClass: "text-provider-claude bg-provider-claude-soft border-status-warning-border",
      requirement: "Pro 구독 필요",
      badgeClass: "bg-provider-claude-soft text-provider-claude border-status-warning-border",
      subtitle: "건강기록 공유 지원",
    },
    gemini: {
      icon: "GEM",
      accentClass: "text-provider-disabled bg-provider-disabled-soft border-border",
      requirement: "준비 중 (선택 불가)",
      badgeClass: "bg-provider-disabled-soft text-provider-disabled border-border",
      subtitle: "추후 지원 예정",
    },
  };

  return (
    <section ref={aiConnectionRef} className="rounded-2xl border border-border bg-card p-5 shadow-card">
      <h2 className="text-xl font-semibold">AI 연결</h2>
      <p className="mt-1 text-sm text-muted-foreground">지금 사용할 AI를 선택해 주세요. 선택은 언제든 바꿀 수 있어요.</p>
      {!hasFiles && connectedProvider && (
        <p className="mt-3 rounded-lg border border-info/35 bg-info/10 px-3 py-2 text-sm text-info">
          AI 연결은 준비됐어요. 기록 올리면 더 좋아요.
        </p>
      )}

      <fieldset className="mt-4 grid gap-3 md:grid-cols-3">
        <legend className="sr-only">AI 연결 제공자 선택</legend>
        {(["chatgpt", "claude", "gemini"] as AiProvider[]).map((provider) => {
          const disabled = provider === "gemini";
          const active = connectedProvider === provider;
          const inputId = `provider-${provider}`;
          const pending = settingProvider === provider;

          return (
            <label
              key={provider}
              htmlFor={inputId}
              className={`relative rounded-xl border px-4 py-3 transition ${
                active ? "border-primary bg-accent shadow-card ring-2 ring-primary/20" : "border-border"
              } focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 ${
                disabled ? "opacity-50" : "cursor-pointer hover:bg-secondary"
              }`}
            >
              <input
                id={inputId}
                className="sr-only"
                type="radio"
                name="provider"
                value={provider}
                checked={active}
                disabled={disabled || pending || Boolean(settingProvider)}
                onChange={() => void setProvider(provider)}
              />

              <div className="absolute right-3 top-3">
                <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${providerMeta[provider].badgeClass}`}>
                  {providerMeta[provider].requirement}
                </span>
              </div>

              <div className="flex items-center gap-2 pr-24 font-medium">
                <span className={`inline-flex h-9 w-9 items-center justify-center rounded-full border text-base ${providerMeta[provider].accentClass}`}>
                  {providerMeta[provider].icon}
                </span>
                <div>
                  <div>{providerLabel(provider)}</div>
                  <div className="text-sm font-normal text-muted-foreground">{providerMeta[provider].subtitle}</div>
                </div>
                {active && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-sm text-primary">선택됨</span>}
              </div>

              {!disabled && pending && <p className="mt-2 text-sm text-muted-foreground">적용 중...</p>}
            </label>
          );
        })}
      </fieldset>

      {connectedProvider && connectedProvider !== "gemini" && (
        <div className="mt-4 rounded-xl border border-primary/30 bg-accent px-4 py-3">
          <div className="text-sm font-medium text-accent-foreground">
            연결 준비 완료 · {providerLabel(connectedProvider)} 선택됨
          </div>
          <div className="mt-1 text-sm text-muted-foreground">
            다음 단계: 아래 버튼으로 AI를 열고 OpenMyHealth 연결을 완료해 주세요.
          </div>
          <div className="mt-2 rounded-lg border border-border/70 bg-background px-3 py-2 text-sm text-foreground">
            연결 방법: 1) AI 사이트 열기 2) OpenMyHealth 연결 승인
          </div>
          <a
            href={connectUrlByProvider[connectedProvider]}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex min-h-[48px] items-center rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground"
          >
            {providerLabel(connectedProvider)}에서 연결 계속하기 →
          </a>
        </div>
      )}
    </section>
  );
}
