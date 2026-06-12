# Keystone Trust — Desktop Client

Open-source desktop companion for [Keystone Trust](https://www.wowkeystonetrust.com), the World of Warcraft Mythic+ group-finder and player-performance platform.

## What it does

- Watches your WoW combat log (`WoWCombatLog.txt`) and SavedVariables.
- Parses Mythic+ runs locally (DPS/HPS, interrupts, deaths, damage taken by spell).
- Uploads run summaries to the Keystone Trust API (authenticated with your personal API key).
- Downloads the community benchmark database and writes it for the in-game addon (`KeystoneTrustBenchmarks.lua`).

No account credentials are stored or transmitted — only the per-user API key you paste in the settings, which you can revoke at any time from the website.

## Build from source

```bash
npm ci
npx electron-vite build
npx electron-builder --win
```

Built with Electron + electron-vite + TypeScript. Installer: NSIS.

## Releases

Official builds are published at [keystone-trust-desktop-releases](https://github.com/BrainMadafoka/keystone-trust-desktop-releases) and auto-update from there.

## License

[MIT](LICENSE)
