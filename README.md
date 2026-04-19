# ClaudeCheck

<p align="center">
	<img src="https://capsule-render.vercel.app/api?type=waving&height=180&color=0:bb6f44,45:d58658,100:6ca58e&text=ClaudeCheck&fontColor=ffffff&fontSize=48&fontAlignY=34&desc=Unofficial%20Claude%20Usage%20Tracker&descAlignY=58" alt="ClaudeCheck hero" />
</p>

<p align="center">
	<img src="https://readme-typing-svg.demolab.com?font=Avenir&weight=600&size=23&duration=2200&pause=700&color=D58658&center=true&vCenter=true&repeat=true&width=980&lines=Official+counter+signals+first;Stream-aware+token+estimation+fallback;Built+for+free+users+and+power+users" alt="Animated typing headline" />
</p>

<p align="center">
	<img src="https://img.shields.io/badge/Chrome-MV3-bb6f44?style=for-the-badge" alt="Chrome MV3" />
	<img src="https://img.shields.io/badge/Open%20Source-Yes-6ca58e?style=for-the-badge" alt="Open source" />
	<img src="https://img.shields.io/badge/Status-Actively%20Improving-d9a46d?style=for-the-badge" alt="Status" />
</p>

ClaudeCheck shows usage directly inside Claude chat. It prioritizes official usage signals when available, then falls back to stream-aware token and context estimation.

## Accuracy snapshot

<p align="center">
	<img src="https://img.shields.io/badge/Completion%20Tokens-99%25-22c55e?style=for-the-badge" alt="Completion token accuracy" />
	<img src="https://img.shields.io/badge/Prompt%20Tokens-97%25-16a34a?style=for-the-badge" alt="Prompt token accuracy" />
	<img src="https://img.shields.io/badge/Context%20Total-94%25-65a30d?style=for-the-badge" alt="Context total accuracy" />
	<img src="https://img.shields.io/badge/Units-94%25-65a30d?style=for-the-badge" alt="Units accuracy" />
</p>

Latest benchmark sample:

| Metric | Predicted | Actual | Accuracy |
|---|---:|---:|---:|
| Completion tokens | 560-620 | 557 | 99% |
| Prompt tokens | 8000-8500 | 7752 | 97% |
| Context total | 8900-9400 | 8309 | 94% |
| Units | 12.0-13.0 | 13.8 | 94% |

Notes:

- OFFICIAL mode: as accurate as Claude-exposed counters.
- ESTIMATED mode: high-quality approximation, not billing exact.

## Why this project exists

Claude web usage is not always exposed in one stable public endpoint for browser extensions.

ClaudeCheck combines two data paths:

- Official path: network and in-page usage counters.
- Estimated path: prompt, response, and context math when counters are unavailable.

That gives practical day-to-day tracking without waiting for a perfect public API.

## Feature highlights

- In-chat usage card styled to blend with Claude UI.
- Source badge: OFFICIAL, ESTIMATED, WAITING.
- Turn-level breakdown: prompt tokens, reply tokens, context pressure.
- Window-based tracking (example: 45 units every 5 hours).
- Model profile support and configurable thresholds.

## Install in 60 seconds

1. Download or clone this repository.
2. Open chrome://extensions.
3. Enable Developer mode.
4. Click Load unpacked.
5. Select the project folder.
6. Open https://claude.ai and start chatting.

## Use flow

1. Open any Claude chat page.
2. Watch the usage card appear on chat interfaces.
3. Check source badge:
	 - OFFICIAL: counters detected from Claude signals.
	 - ESTIMATED: fallback estimator is active.
4. Tune behavior in popup or options:
	 - Message units
	 - Window hours
	 - Token unit per message
	 - Model profile and context window

## Defaults

- Message units: 45
- Window: 5 hours
- Token unit per message: 2800
- Model profile: Sonnet
- Context window: 200000
- Warning threshold: 85%
- Estimator fallback: enabled

## Open-source quick start

```bash
git clone https://github.com/nikeshsundar/claudecheck.git
cd claudecheck
```

After code changes:

1. Save files.
2. Open chrome://extensions.
3. Click Reload on this extension.
4. Refresh Claude tabs.

## Architecture

- manifest.json: extension permissions and wiring
- content.js: in-chat UI + estimator engine
- page-hook.js: fetch/xhr interception + SSE parsing
- content.css: in-chat visual design
- popup.*: quick controls
- options.*: advanced settings
- background.js: storage initialization and normalization

## Privacy

- Stores data locally in chrome.storage.local.
- No backend service required.
- Host permissions limited to Claude domains.

## Limitations

- Claude internal accounting is not fully public.
- Fallback math is best-effort approximation.
- Parser updates may be needed if Claude payload format changes.

## References

- Token counting docs: https://platform.claude.com/docs/en/docs/build-with-claude/token-counting
- Model overview docs: https://platform.claude.com/docs/en/docs/about-claude/models/overview

## Contributing

Pull requests are welcome.

High-impact areas:

- Stream parser hardening
- Tokenization approximation improvements
- Performance on long chats
- UI and accessibility polish

## Disclaimer

This is an unofficial community project and is not affiliated with Anthropic.

<p align="center">
	<img src="https://capsule-render.vercel.app/api?type=waving&height=110&section=footer&color=0:6ca58e,40:d9a46d,100:bb6f44" alt="Footer wave" />
</p>
