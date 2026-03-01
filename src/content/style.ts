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
}
.omh-shell {
  width: min(410px, calc(100vw - 24px));
  max-height: calc(100vh - 24px);
  max-height: calc(100dvh - 24px);
  border-radius: 16px;
  background: var(--omh-bg);
  box-shadow: 0 8px 30px rgba(0,0,0,0.18);
  border: 1px solid var(--omh-border);
  overflow: hidden;
  font-family: "Pretendard Variable", "Pretendard", -apple-system, BlinkMacSystemFont, "Noto Sans KR", sans-serif;
  color: var(--omh-text);
}
.omh-shell.blue { border-color: #6aa7f5; }
.omh-shell.amber { border-color: #f2aa26; }
.omh-shell.red { border-color: #e0584d; }
.omh-shell.timeout { border-color: #d0d5dd; }
.omh-progress { height: 5px; background: #2282f0; transition: width 0.3s linear; }
.omh-shell.amber .omh-progress { background: #f59e0b; }
.omh-shell.red .omh-progress { background: #ef4444; }
.omh-shell.timeout .omh-progress { background: #98a2b3; }
.omh-content { position: relative; padding: 18px 20px 20px 20px; overflow: auto; max-height: calc(100vh - 60px); max-height: calc(100dvh - 60px); background: #fffdf8; }
.omh-shell.blue .omh-content { background: linear-gradient(180deg, #f3f9ff 0%, #fffdf8 44%); }
.omh-shell.amber .omh-content { background: linear-gradient(180deg, #fff8eb 0%, #fffdf8 44%); }
.omh-shell.red .omh-content { background: linear-gradient(180deg, #fff3f2 0%, #fffdf8 44%); }
.omh-timeout { background: #f3f4f6; color: #344054; }
.omh-close {
  position: absolute;
  top: 12px;
  right: 12px;
  border: none;
  background: #f0f2f4;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  cursor: pointer;
  color: #475467;
  font-size: 15px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.omh-eyebrow { font-size: 13px; font-weight: 700; color: #415264; letter-spacing: 0.04em; text-transform: uppercase; }
.omh-title { margin-top: 6px; padding-right: 52px; font-weight: 700; font-size: 20px; line-height: 1.35; color: var(--omh-text); }
.omh-request { margin-top: 8px; font-size: 14px; color: var(--omh-text); }
.omh-desc { margin-top: 10px; font-size: 14px; line-height: 1.5; color: #344054; }
.omh-meta { margin-top: 8px; font-size: 14px; line-height: 1.45; color: #344054; }
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
  color: #2563eb;
  background: #eff6ff;
}
.omh-shell.amber .omh-timer-ring { color: #b45309; background: #fffbeb; }
.omh-shell.amber .omh-timer-ring { animation: omhAmberPulse 1.6s ease-in-out infinite; }
.omh-shell.red .omh-timer-ring { color: #b42318; background: #fef2f2; animation: omhRedPulse 0.9s ease-in-out infinite; }
.omh-copy { margin-top: 12px; font-size: 14px; line-height: 1.5; color: #344054; }
.omh-input { margin-top: 8px; width: 100%; box-sizing: border-box; border: 1px solid #d0d5dd; border-radius: 8px; height: 48px; padding: 0 10px; font-size: 14px; }
.omh-error { margin-top: 8px; color: var(--omh-danger); font-size: 14px; line-height: 1.45; display: grid; gap: 6px; }
.omh-summary { margin-top: 12px; padding: 10px 12px; border-radius: 10px; background: var(--omh-primary-soft); color: #065f46; font-size: 14px; line-height: 1.45; border: 1px solid #cce9de; }
.omh-link { margin-top: 10px; border: none; background: transparent; color: #344054; font-size: 14px; cursor: pointer; padding: 0; }
.omh-detail { margin-top: 10px; border: 1px solid #e3e6e9; border-radius: 10px; padding: 10px; display: grid; gap: 8px; background: #fcfcfb; }
.omh-checkbox-row { display: flex; align-items: center; gap: 8px; font-size: 14px; color: #344054; min-height: 48px; }
.omh-type-group { display: grid; gap: 4px; }
.omh-sub-checkbox-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-left: 20px;
  min-height: 44px;
  font-size: 14px;
  line-height: 1.45;
  color: #667085;
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
.omh-primary.urgent { background: #b42318; animation: omhUrgentPulse 1.2s ease-in-out infinite, omhUrgentShake 0.6s ease-in-out infinite; }
.omh-primary:disabled { opacity: 0.6; cursor: not-allowed; }
.omh-secondary { border: 1px solid #d0d5dd; background: #fff; color: #344054; border-radius: 10px; height: 52px; font-weight: 600; font-size: 14px; cursor: pointer; }
.omh-secondary:disabled { opacity: 0.6; cursor: not-allowed; }
.omh-queue { margin-top: 10px; font-size: 14px; color: #667085; }
.omh-confirm-inline { margin-top: 8px; padding: 10px; background: #fffbeb; border: 1px solid #f59e0b; border-radius: 8px; }
.omh-confirm-text { font-size: 14px; color: var(--omh-warning); margin-bottom: 8px; }
.omh-confirm-actions { display: flex; gap: 6px; }
.omh-confirm-yes { border: none; background: #f59e0b; color: #fff; border-radius: 6px; padding: 8px 16px; font-size: 13px; font-weight: 600; cursor: pointer; min-height: 48px; }
.omh-confirm-no { border: 1px solid #d0d5dd; background: #fff; color: #344054; border-radius: 6px; padding: 8px 16px; font-size: 13px; cursor: pointer; min-height: 48px; }
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
