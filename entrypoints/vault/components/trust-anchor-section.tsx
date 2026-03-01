import React from "react";

export function TrustAnchorSection(): React.ReactElement {
  const cards: Array<{
    title: string;
    body: string;
    icon: string;
    link?: string;
  }> = [
    {
      title: "클라우드 전송 없음",
      body: "건강기록 원문은 이 브라우저 안에만 저장됩니다.",
      icon: "🛡️",
    },
    {
      title: "AES-256 암호화",
      body: "PIN 없이는 누구도 기록을 열람할 수 없습니다.",
      icon: "🔐",
    },
    {
      title: "수집 정보 없음",
      body: "승인한 항목 외에는 어떤 데이터도 전달되지 않습니다.",
      icon: "🧭",
    },
    {
      title: "오픈소스 검증",
      body: "보안 동작을 코드로 직접 확인할 수 있습니다.",
      icon: "🧩",
      link: "https://github.com/openmyhealth/openmyhealth",
    },
  ] as const;

  return (
    <div className="mt-6 grid gap-3 md:grid-cols-2">
      {cards.map((card) => (
        <article key={card.title} className="rounded-xl border border-border bg-accent/70 p-4">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 text-lg" aria-hidden="true">{card.icon}</span>
            <div>
              <h3 className="text-sm font-semibold text-accent-foreground">{card.title}</h3>
              <p className="mt-1 text-sm text-accent-foreground/90">
                {card.body}
                {card.link && (
                  <>
                    {" "}
                    <a className="underline underline-offset-2" href={card.link} target="_blank" rel="noreferrer">
                      저장소 보기
                    </a>
                  </>
                )}
              </p>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}
