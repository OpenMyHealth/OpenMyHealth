# Architecture Spec

## Runtime
- Chrome Extension MV3 only.
- Service worker orchestrates context build + tab message delivery.
- Side panel handles user inputs and UX.
- Content scripts perform provider-specific insertion.

## Data Flow
1. HIRA payload acquired on-device.
2. Normalize into `OpenChartRecord[]`.
3. Build `ContextPacketV1`.
4. Generate provider draft string.
5. Insert into active provider input box.
