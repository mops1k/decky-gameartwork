<div align="center">
<img src="thumb.png">

[![License](https://img.shields.io/badge/license-GPL--3.0--or--later-informational)](LICENSE)
</div>

<h1 align="center">GameArtwork — Decky Loader plugin</h1>

Browse and apply game artwork from several sources without leaving Gaming Mode:
**SteamGridDB**, **Steam**, **Epic Games Store**, **GOG**, **IGDB** and **VNDB**.

<img src="docs/capsule.png" width="33.33%"><img src="docs/manage.png" width="33.33%"><img src="docs/filters.png" width="33.33%">

> **This is an extended fork of [SteamGridDB/decky-steamgriddb](https://github.com/SteamGridDB/decky-steamgriddb) (v1.8.1), not the upstream plugin.**
> The original project only searches SteamGridDB; this fork keeps its UI and adds
> cross-source search, store matching and a few quality-of-life fixes. All credit
> for the original plugin, its translations and its design goes to the upstream
> authors — see [Credits](#credits).

## What this fork adds

- **Cross-source search** — a single query looks up the game in Steam, Epic Games
  Store, GOG and VNDB, and shows each store's official art next to the SGDB grid.
  Each store publishes its tiles as soon as it answers, so a slow store never
  holds back the rest.
- **Full store artwork** — GOG is queried through its catalog API (portrait and
  wide capsules, logo, background), Steam logos come from the app logo PNG, and
  VNDB screenshots fill the wide/hero slots, so every tab has something to show.
- **Store matching** — the plugin matches the shortcut/library title against store
  search results and applies a confidence check, so "Hollow Knight: Voidheart"
  still resolves to the right game. A localized or renamed shortcut falls back to
  the SteamGridDB title.
- **Source filter** — chips above the grid keep only the artwork of one store.
- **Batch apply** — the details dialog of a store tile can apply every artwork
  that store has for the game (capsule, wide capsule, hero, logo, icon) at once.
- **Applied marker** — tiles that are currently set as the game artwork are
  marked, based on what the plugin applied and Steam's custom-artwork files.
- **Per-source switches** — each store can be turned off in the Quick Access
  settings, so requests and tiles only come from sources you care about.
- **Restart-proof cache** — source answers are kept on disk (and in the browser
  cache), so the grid opens instantly and still works when a source is offline.
- **Manual rematch** — a store tile offers "Wrong game? Pick another..." and sends
  you back to the game picker without digging through the filters.
- **Source status** — the Quick Access settings can ping every source and show
  which ones answer and how fast.
- **Settings backup** — per-game mappings and settings are exported to
  `~/gameartwork-backup` and can be restored from the same panel.
- **Bulk shortcut artwork** — fills the missing artwork of non-Steam shortcuts
  from Steam, skipping games with custom art or without a confident match.
- **IGDB support** (optional) — console and indie games that are missing from the
  stores can be pulled from IGDB with your own Twitch API credentials.
- **Manual Steam AppID** — if a store search finds nothing, paste a Steam AppID
  and its artwork is used directly.
- **Relaxed-filter fallback** — when the current style/dimension filter returns
  nothing, the plugin retries once with every variant enabled and tells you so.
- **Source labels** — every result is marked with its source (SteamGridDB, Steam,
  Epic, GOG, IGDB, VNDB).

## Features inherited from upstream

- Browse assets from SteamGridDB for the selected game.
- Support for non-Steam shortcuts and Source/GoldSrc mods.
- Ability to change icons for Steam or non-Steam shortcuts.
- Manually select images from the local file system.
- Utility to apply invisible assets.
- Logo anchor point positioner and resizer.
- Square capsules.
- Change capsule type of recently played game.

## Installation

1. Install [Decky Loader](https://wiki.deckbrew.xyz/en/user-guide/install).
2. Open the Quick Access menu.
3. Open the Plugins Browser <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/store-light.svg">
    <source media="(prefers-color-scheme: light)" srcset="docs/store-dark.svg">
    <img height="16px" alt="Store" src="docs/store-dark.svg">
    </picture>
4. Enable **Developer mode** (Settings → Developer) and install the plugin from
   its GitHub repository URL, or download the packaged zip from
   [Releases](../../releases) and install it from the same screen.

The plugin is not in the Decky store: it is a personal fork and is installed
manually.

## Updates

The plugin updates itself without leaving Game Mode:

1. Its backend checks the latest GitHub release of this repository (cached for a
   few hours, forced with the **Check for updates** button).
2. When a newer version exists, the **Plugin Update** section at the top of the
   Quick Access menu shows **Update to vX.Y.Z** together with the release notes.
3. The update is handed to Decky Loader itself (`utilities/install_plugin`), so
   the loader downloads the release zip, unpacks it into
   `/home/deck/homebrew/plugins` and reloads the plugin after its usual
   confirmation prompt. No root filesystem access is needed on the plugin side.

## Configuration

The plugin works without any keys for SteamGridDB, Steam, Epic, GOG and VNDB.

- **SteamGridDB API key** — add it in the plugin's Quick Access settings if SGDB
  requests are rate-limited or rejected.
- **Artwork sources** — the *Artwork Sources* section of the plugin settings turns
  the Steam / Epic / GOG / IGDB / VNDB lookups on and off individually.
- **IGDB (optional)** — register an application at
  [dev.twitch.tv](https://dev.twitch.tv/console/apps) and paste its *Client ID*
  and *Client Secret* into the **IGDB** section of the plugin settings.

## Usage

Select "Change Artwork..." from a game context menu.

You can open the menu by focusing on a game in your library and pressing <picture><source media="(prefers-color-scheme: dark)" srcset="docs/start-light.svg"><source media="(prefers-color-scheme: light)" srcset="docs/start-dark.svg"><img height="16px" alt="Start" src="docs/start-dark.svg"></picture>.
Or by using the <picture><source media="(prefers-color-scheme: dark)" srcset="docs/menucog-light.svg"><source media="(prefers-color-scheme: light)" srcset="docs/menucog-dark.svg"><img height="16px" alt="Cog" src="docs/menucog-dark.svg"></picture> button on a game page.

<img src="docs/gamecontextmenu.png" height="300px">

Shortcuts that SteamGridDB cannot match are matched by the stores instead; use
the source section of the game selection dialog to switch between stores or to
search a Steam AppID manually.

# Credits

This project is an extended fork of
[**SteamGridDB/decky-steamgriddb**](https://github.com/SteamGridDB/decky-steamgriddb)
(GPL-3.0-or-later). Original copyright and licensing are kept in [LICENSE](LICENSE).

**Upstream authors:** Jozen Blue Martinez and contributors.
**Early Testing:** Emenesu, Mr. Mendelli
**Development Help:** [SDH Discord](https://discord.gg/ZU74G2NJzk)
**Localisation:**
https://crowdin.com/project/decky-steamgriddb
| Language | Translators |
| - | - |
| **Čeština** | zenobit, theczechczech |
| **Dansk** | Jakob Frank Mogensen |
| **Deutsch** | Kurikuo, benutzer_artur7, Anja, FL0W, Remirax, LittleFreak, 'bignutty, Tom Taylor |
| **Español-España** | Andrea Laguillo, Kam, m0uch0 |
| **Español-Latinoamérica** | Kam, Knux03 |
| **Français** | Michael Jean, Xunkar |
| **Magyar** | minttuNB, BudaiChris |
| **Italiano** | SpagottoB37, RodoMa92, federico-ntr |
| **Nederlands** | Phanpy100 (Fanny), Jannes Verlinde |
| **Norsk** | minttuNB |
| **Polski** | DRS, Michał Kwiatkowski, MAX0R, Szymon Kucharski, minttuNB |
| **Português-Brasil** | Oregano, Thomas Eric |
| **Português** | Kokasgui, Ev1lbl0w |
| **Română** | Munt |
| **Suomi** | Jage |
| **Svenska** | Moneyman Dan, Super, Daniel Nylander |
| **Türkçe** | Bilgehan Ceviz, Sib &#124; Twig |
| **Ελληνικά** | Emenesu |
| **Русский** | fycher, LostHikking |
| **Українська** | Veydzher, Kefir |
| **한국어** | yor42, sua (sua_owo) |
| **日本語** | Nes, Hogman |
| **正體中文** | mingyc |
| **简体中文** | zhzy0077, XHXIAIEIN, simon3000 |

## License

GPL-3.0-or-later, same as upstream. See [LICENSE](LICENSE).
