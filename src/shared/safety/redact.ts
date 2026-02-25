export interface RedactionResult {
  text: string;
  count: number;
}

const RULES: Array<{ re: RegExp; replacement: string }> = [
  {
    // Korean resident registration number
    re: /\b\d{6}-?[1-4]\d{6}\b/g,
    replacement: "[RRN_REDACTED]",
  },
  {
    // Korean mobile + landline numbers
    re: /\b(?:01[0-9]|0[2-9]\d?)-?\d{3,4}-?\d{4}\b/g,
    replacement: "[PHONE_REDACTED]",
  },
  {
    re: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    replacement: "[EMAIL_REDACTED]",
  },
  {
    // Labeled birth dates only (avoid masking clinical timeline dates)
    re: /(?:생년월일|출생일|DOB|Birth\s*Date)\s*[:=]?\s*(?:19|20)\d{2}[-/.]?(?:0[1-9]|1[0-2])[-/.]?(?:0[1-9]|[12]\d|3[01])/gi,
    replacement: "[BIRTHDATE_REDACTED]",
  },
];

export function redactSensitiveText(input: string): RedactionResult {
  let text = input;
  let count = 0;

  for (const rule of RULES) {
    text = text.replace(rule.re, (match) => {
      if (match === rule.replacement) {
        return match;
      }
      count += 1;
      return rule.replacement;
    });
  }

  return {
    text,
    count,
  };
}
