# Claude Web Usage Bar (Unofficial)

<p align="center">
	<img src="https://readme-typing-svg.demolab.com?font=Avenir&weight=600&size=24&duration=2400&pause=700&color=D58658&center=true&vCenter=true&repeat=true&width=900&lines=Official+signals+first;Smart+fallback+estimation;Built+for+Claude+power+users" alt="Typing animation" />
</p>

<p align="center">
	<img src="https://img.shields.io/badge/Chrome-MV3-BB6F44?style=for-the-badge" alt="Chrome MV3" />
	<img src="https://img.shields.io/badge/Status-Active%20Development-6CA58E?style=for-the-badge" alt="Status" />
	<img src="https://img.shields.io/badge/Open%20Source-Yes-D9A46D?style=for-the-badge" alt="Open Source" />
</p>

Track Claude chat usage with a blended in-chat bar that prefers official counters when available, then falls back to robust token and context estimation.

## Why this exists

Claude web usage is not always exposed in a single stable public endpoint for extensions.
This project combines:

- Official parsing path: network and in-page usage signals.
- Estimated path: prompt, response, and context math when official counters are missing.

Result: practical and highly usable tracking, with transparent source labels.

## What users get

- In-chat usage bar that blends with Claude UI.
- Source label: OFFICIAL, ESTIMATED, or WAITING.
- Window tracking (example: 45 units per 5 hours).
- Per-turn breakdown: prompt tokens, reply tokens, context usage.
- Configurable profiles and safety threshold.

## Accuracy model

- OFFICIAL mode is as accurate as the counters Claude exposes.
- ESTIMATED mode is approximation-focused, not billing-exact.
- Estimation improves with stream parsing, context pressure, and turn weighting.

References:

- Token counting: https://platform.claude.com/docs/en/docs/build-with-claude/token-counting
- Model overview: https://platform.claude.com/docs/en/docs/about-claude/models/overview

## Install (Users)

1. Download or clone this repository.
2. Open Chrome and go to chrome://extensions.
3. Enable Developer mode.
4. Click Load unpacked.
5. Select the project folder.
6. Open https://claude.ai and start chatting.

## How to use

1. Open any Claude chat.
2. The usage card appears on chat screens only.
3. Check the source badge:
	 - OFFICIAL means counters were detected from Claude signals.
	 - ESTIMATED means fallback math is active.
4. Open extension popup or Options page to tune:
	 - Message units
	 - Window hours
	 - Token unit per message
	 - Model profile and context window

## Default settings

- Message units per window: 45
- Window size: 5 hours
- Token unit per message: 2800
- Model profile: Sonnet
- Context window: 200000
- Warning threshold: 85
- Estimator fallback: enabled

## Open-source workflow

### Clone and run

```bash
git clone https://github.com/nikeshsundar/claudecheck.git
cd claudecheck
```

Load unpacked in Chrome using the steps above.

### Update extension after code changes

1. Save files.
2. Open chrome://extensions.
3. Click Reload on this extension.
4. Refresh Claude tabs.

## Project structure

- manifest.json: extension manifest and permissions
- content.js: UI rendering + estimation logic
- page-hook.js: fetch/xhr interception and SSE parsing
- content.css: in-chat usage bar theme
- popup.html / popup.js / popup.css: quick controls
- options.html / options.js / options.css: advanced settings
- background.js: storage initialization and normalization

## Privacy

- Data is stored locally via chrome.storage.local.
- No backend service is required by this project.
- Host permissions are limited to Claude domains.

## Known limitations

- Claude internal accounting is not fully public.
- Model/token math is best-effort in fallback mode.
- If Claude changes payload shape, parsers may require updates.

## Contributing

PRs are welcome.

Suggested areas:

- Stream parser hardening
- Better tokenizer approximation
- Performance tuning for long chats
- UI polish and accessibility

## Disclaimer

This is an unofficial community project and is not affiliated with Anthropic.
