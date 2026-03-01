export const STYLE_TEXT = `
:host { all: initial; }
:host {
  --omh-bg: #fffdf8;
  --omh-border: #d8d9d1;
  --omh-primary: #0f6b55;
  --omh-primary-soft: #e8f5ef;
  --omh-text: #1e2a36;
  --omh-muted: #536273;
  --omh-danger: #b42318;
  --omh-warning: #b45309;
  --omh-bg-alt: #fcfcfb;
  --omh-border-subtle: #e3e6e9;
  --omh-primary-soft-border: #cce9de;
  --omh-text-secondary: #344054;
  --omh-muted-light: #667085;
  --omh-danger-bg: #fef2f2;
  --omh-warning-bg: #fffbeb;
  --omh-warning-border: #f59e0b;
  --omh-info: #2563eb;
  --omh-info-bg: #eff6ff;
  --omh-info-border: #6aa7f5;
  --omh-neutral-bg: #f0f2f4;
  --omh-neutral-border: #d0d5dd;
  --omh-neutral-text: #475467;
  --omh-neutral-muted: #98a2b3;
  --omh-timeout-bg: #f3f4f6;
  --omh-blue-gradient-start: #f3f9ff;
  --omh-amber-gradient-start: #fff8eb;
  --omh-red-gradient-start: #fff3f2;
}
.omh-shell {
  width: min(410px, calc(100vw - 24px));
  max-height: calc(100vh - 24px);
  max-height: calc(100dvh - 24px);
  border-radius: 16px;
  background: var(--omh-bg);
  box-shadow: 0 4px 12px rgba(0,0,0,0.08), 0 8px 30px rgba(0,0,0,0.14);
  border: 1px solid var(--omh-border);
  overflow: hidden;
  font-family: "Pretendard Variable", "Pretendard", -apple-system, BlinkMacSystemFont, "Noto Sans KR", sans-serif;
  color: var(--omh-text);
}
.omh-shell.blue { border-color: var(--omh-info-border); }
.omh-shell.amber { border-color: var(--omh-warning-border); }
.omh-shell.red { border-color: var(--omh-danger); }
.omh-shell.timeout { border-color: var(--omh-neutral-border); }
.omh-progress { height: 5px; background: var(--omh-info); transition: width 0.3s linear; }
.omh-shell.amber .omh-progress { background: var(--omh-warning-border); }
.omh-shell.red .omh-progress { background: var(--omh-danger); }
.omh-shell.timeout .omh-progress { background: var(--omh-neutral-muted); }
.omh-content { position: relative; padding: 18px 20px 20px 20px; overflow: auto; max-height: calc(100vh - 60px); max-height: calc(100dvh - 60px); background: var(--omh-bg); }
.omh-shell.blue .omh-content { background: linear-gradient(180deg, var(--omh-blue-gradient-start) 0%, var(--omh-bg) 44%); }
.omh-shell.amber .omh-content { background: linear-gradient(180deg, var(--omh-amber-gradient-start) 0%, var(--omh-bg) 44%); }
.omh-shell.red .omh-content { background: linear-gradient(180deg, var(--omh-red-gradient-start) 0%, var(--omh-bg) 44%); }
.omh-timeout { background: var(--omh-timeout-bg); color: var(--omh-text-secondary); }
.omh-close {
  position: absolute;
  top: 12px;
  right: 12px;
  border: none;
  background: var(--omh-neutral-bg);
  width: 48px;
  height: 48px;
  border-radius: 50%;
  cursor: pointer;
  color: var(--omh-neutral-text);
  font-size: 15px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.omh-eyebrow { font-size: 13px; font-weight: 700; color: var(--omh-muted); letter-spacing: 0.04em; text-transform: uppercase; }
.omh-title { margin-top: 6px; padding-right: 52px; font-weight: 700; font-size: 20px; line-height: 1.35; color: var(--omh-text); }
.omh-request { margin-top: 8px; font-size: 14px; color: var(--omh-text); }
.omh-desc { margin-top: 10px; font-size: 14px; line-height: 1.5; color: var(--omh-text-secondary); }
.omh-meta { margin-top: 8px; font-size: 14px; line-height: 1.45; color: var(--omh-text-secondary); }
.omh-time-row { margin-top: 10px; display: flex; align-items: center; gap: 8px; }
.omh-timer-ring {
  min-width: 44px;
  height: 44px;
  border-radius: 999px;
  border: 2px solid currentColor;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 15px;
  font-weight: 700;
  color: var(--omh-info);
  background: var(--omh-info-bg);
}
.omh-shell.amber .omh-timer-ring { color: var(--omh-warning); background: var(--omh-warning-bg); }
.omh-shell.amber .omh-timer-ring { animation: omhAmberPulse 1.6s ease-in-out infinite; }
.omh-shell.red .omh-timer-ring { color: var(--omh-danger); background: var(--omh-danger-bg); animation: omhRedPulse 0.9s ease-in-out infinite; }
.omh-copy { margin-top: 12px; font-size: 14px; line-height: 1.5; color: var(--omh-text-secondary); }
.omh-input { margin-top: 8px; width: 100%; box-sizing: border-box; border: 1px solid var(--omh-neutral-border); border-radius: 8px; height: 48px; padding: 0 10px; font-size: 14px; }
.omh-error { margin-top: 8px; color: var(--omh-danger); font-size: 14px; line-height: 1.45; display: grid; gap: 6px; }
.omh-summary { margin-top: 12px; padding: 10px 12px; border-radius: 10px; background: var(--omh-primary-soft); color: var(--omh-primary); font-size: 14px; line-height: 1.45; border: 1px solid var(--omh-primary-soft-border); }
.omh-link { margin-top: 10px; border: none; background: transparent; color: var(--omh-text-secondary); font-size: 14px; cursor: pointer; padding: 0; }
.omh-detail { margin-top: 10px; border: 1px solid var(--omh-border-subtle); border-radius: 10px; padding: 10px; display: grid; gap: 8px; background: var(--omh-bg-alt); }
.omh-checkbox-row { display: flex; align-items: center; gap: 8px; font-size: 14px; color: var(--omh-text-secondary); min-height: 48px; }
.omh-type-group { display: grid; gap: 4px; }
.omh-sub-checkbox-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-left: 20px;
  min-height: 44px;
  font-size: 14px;
  line-height: 1.45;
  color: var(--omh-muted-light);
}
.omh-checkbox-row input[type="checkbox"],
.omh-sub-checkbox-row input[type="checkbox"] {
  width: 18px;
  height: 18px;
  margin: 0;
  accent-color: var(--omh-primary);
}
.omh-actions {
  margin-top: 14px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  position: sticky;
  bottom: 0;
  z-index: 1;
  padding-top: 12px;
  background: linear-gradient(to top, var(--omh-bg) 75%, rgba(255,255,255,0));
}
.omh-primary { border: none; background: var(--omh-primary); color: #fff; border-radius: 10px; height: 52px; font-weight: 700; font-size: 14px; cursor: pointer; }
.omh-primary.urgent { background: var(--omh-danger); animation: omhUrgentPulse 1.2s ease-in-out infinite, omhUrgentShake 0.6s ease-in-out infinite; }
.omh-primary:disabled { opacity: 0.6; cursor: not-allowed; }
.omh-secondary { border: 1px solid var(--omh-neutral-border); background: #fff; color: var(--omh-text-secondary); border-radius: 10px; height: 52px; font-weight: 600; font-size: 14px; cursor: pointer; }
.omh-secondary:disabled { opacity: 0.6; cursor: not-allowed; }
.omh-queue { margin-top: 10px; font-size: 14px; color: var(--omh-muted-light); }
.omh-confirm-inline { margin-top: 8px; padding: 10px; background: var(--omh-warning-bg); border: 1px solid var(--omh-warning-border); border-radius: 8px; }
.omh-confirm-text { font-size: 14px; color: var(--omh-warning); margin-bottom: 8px; }
.omh-confirm-actions { display: flex; gap: 6px; }
.omh-confirm-yes { border: none; background: var(--omh-warning-border); color: #fff; border-radius: 6px; padding: 8px 16px; font-size: 13px; font-weight: 600; cursor: pointer; min-height: 48px; }
.omh-confirm-no { border: 1px solid var(--omh-neutral-border); background: #fff; color: var(--omh-text-secondary); border-radius: 6px; padding: 8px 16px; font-size: 13px; cursor: pointer; min-height: 48px; }
.omh-sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  border: 0;
}
.omh-primary:focus-visible, .omh-secondary:focus-visible,
.omh-close:focus-visible, .omh-link:focus-visible,
.omh-confirm-yes:focus-visible, .omh-confirm-no:focus-visible {
  outline: 3px solid var(--omh-primary);
  outline-offset: 2px;
}
.omh-input:focus-visible {
  outline: 3px solid var(--omh-primary);
  outline-offset: 0;
  border-color: var(--omh-primary);
}
@keyframes omhUrgentPulse {
  0% { box-shadow: 0 0 0 0 rgba(180,35,24,0.3); }
  70% { box-shadow: 0 0 0 8px rgba(180,35,24,0); }
  100% { box-shadow: 0 0 0 0 rgba(180,35,24,0); }
}
@keyframes omhUrgentShake {
  0%, 100% { transform: translateX(0); }
  25% { transform: translateX(-1.5px); }
  75% { transform: translateX(1.5px); }
}
@keyframes omhAmberPulse {
  0% { transform: scale(1); }
  50% { transform: scale(1.04); }
  100% { transform: scale(1); }
}
@keyframes omhRedPulse {
  0% { transform: scale(1); }
  25% { transform: scale(1.06); }
  50% { transform: scale(1); }
  75% { transform: scale(1.05); }
  100% { transform: scale(1); }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation: none !important;
    transition: none !important;
  }
}
@media (max-width: 560px) {
  .omh-actions {
    grid-template-columns: 1fr;
  }
  .omh-content {
    padding: 14px 14px 16px 14px;
  }
  .omh-confirm-actions {
    flex-direction: column;
  }
  .omh-confirm-yes,
  .omh-confirm-no {
    width: 100%;
  }
}
`;
