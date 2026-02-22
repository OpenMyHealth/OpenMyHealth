# Product Spec

## Goal
Enable users to ask ChatGPT/Gemini/Claude questions with their HIRA medical records as structured context.

## Non-goals
- Server-side storage of raw medical data
- Automatic chatbot message submission
- Clinical diagnosis automation

## Success Criteria
- User can generate context draft from HIRA payload in under 30 seconds.
- Draft insertion succeeds on supported providers with high reliability.
- Evidence section references source records deterministically.
