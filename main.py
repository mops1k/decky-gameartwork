import sys
import asyncio
import html
import json
import re
import time
from platform import system

from os import W_OK, access, stat
from stat import FILE_ATTRIBUTE_HIDDEN
from http.cookiejar import CookieJar
from urllib.request import Request, urlopen, build_opener, HTTPCookieProcessor, HTTPSHandler
from urllib.parse import urlparse, urlencode, quote
from base64 import b64encode
from pathlib import Path
from shutil import copyfile
from settings import SettingsManager # type: ignore
from helpers import get_ssl_context # type: ignore
import decky # type: ignore

WINDOWS = system() == "Windows"

STEAM_ASSET_BASE = "https://shared.steamstatic.com/store_item_assets/"
STEAM_ICON_BASE = "https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/"
# Same key the frontend uses when the user has not set a personal one.
SGDB_PLUGIN_KEY = '6465636b796c6f616465723432303639'
# Cloudflare in front of steamgriddb.com rejects unknown clients with a 401
# ("Invalid API key" in the body), while the loader proxy answers fine: the
# WAF rule accepts a UA shaped like the Decky one, so the health check uses it.
SGDB_USER_AGENT = "Decky/3 (https://decky.xyz)"
BACKEND_USER_AGENT = "gameartwork backend"

def get_json(url: str, params=None, timeout: int = 15, retries: int = 1, headers=None):
    if params:
        url = "%s?%s" % (url, urlencode(params))
    request_headers = {
        "User-Agent": BACKEND_USER_AGENT,
        "Accept": "application/json",
    }
    if headers:
        request_headers.update(headers)
    req = Request(url, headers=request_headers)
    attempt = 0
    while True:
        try:
            with urlopen(req, context=get_ssl_context(), timeout=timeout) as res:
                return json.loads(res.read().decode("utf-8"))
        except Exception:
            # Catalog APIs (GOG especially) answer 503 now and then: one retry
            # is enough to hide the blip without delaying real failures.
            if attempt >= retries:
                raise
            attempt += 1
            time.sleep(1.5)

def get_html(url: str, timeout: int = 25, retries: int = 0):
    req = Request(url, headers={
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) gameartwork",
        "Accept-Language": "en-US,en;q=0.9",
    })
    attempt = 0
    while True:
        try:
            with urlopen(req, context=get_ssl_context(), timeout=timeout) as res:
                return res.status, res.read().decode("utf-8", "replace")
        except Exception:
            if attempt >= retries:
                raise
            attempt += 1
            time.sleep(1.5)

def http_status(url: str, timeout: int = 8):
    """Status code of a HEAD request, or None when the URL is unreachable."""
    try:
        req = Request(url, method="HEAD", headers={"User-Agent": "gameartwork backend"})
        with urlopen(req, context=get_ssl_context(), timeout=timeout) as res:
            return res.status
    except Exception:
        return None

def _read_json_body(req, timeout=25):
    """One blocking JSON POST/GET, meant to run inside a worker thread."""
    with urlopen(req, context=get_ssl_context(), timeout=timeout) as res:
        return json.loads(res.read().decode("utf-8"))

GOG_GENERIC_TITLES = ("Лучшие видеоигры", "Best video games", "GOG.COM")
GOG_CATALOG_URL = "https://catalog.gog.com/v1/catalog"
GOG_SCREENSHOT_FORMATTER = "product_card_v2_mobile_slider_639"

def gog_slug_candidates(name: str):
    def slugify(value):
        value = value.lower().replace("&", " and ")
        value = re.sub(r"[™®©]", "", value)
        return re.sub(r"[^a-z0-9]+", "_", value).strip("_")

    candidates = [slugify(name)]
    head = name.split(":")[0]
    head_slug = slugify(head)
    if head_slug and head_slug not in candidates:
        candidates.append(head_slug)
    return [c for c in candidates if c]

def clean_gog_title(title: str):
    title = re.sub(r"\s*\|.*$", "", title)
    title = re.sub(r"\s+\d+% off.*$", "", title, flags=re.I)
    title = re.sub(r"\s+на GOG\.com$", "", title, flags=re.I)
    return title.strip()

def gog_product_images(product):
    """Map one GOG catalog product to the asset types the plugin knows."""
    images = {}
    vertical = product.get("coverVertical") or ""
    if vertical:
        images["grid_p"] = {"url": vertical, "width": 342, "height": 482}

    screenshots = [
        url.replace("{formatter}", GOG_SCREENSHOT_FORMATTER)
        for url in (product.get("screenshots") or [])
        if url
    ]

    horizontal = product.get("coverHorizontal") or ""
    if horizontal:
        images["grid_l"] = {"url": horizontal, "width": 1600, "height": 740}
    elif screenshots:
        images["grid_l"] = {"url": screenshots[0], "width": 639, "height": 361}

    background = product.get("galaxyBackgroundImage") or ""
    if background:
        images["hero"] = {"url": background, "width": 2560, "height": 670}
    elif len(screenshots) > 1:
        images["hero"] = {"url": screenshots[1], "width": 639, "height": 361}

    logo = product.get("logo") or ""
    if logo:
        images["logo"] = {"url": logo, "width": 1600, "height": 740}
    return images

def gog_catalog_games(term: str, limit: int = 8):
    """Search GOG through its public catalog API (no key, real title search)."""
    data = get_json(GOG_CATALOG_URL, {
        "limit": limit,
        "page": 1,
        "countryCode": "US",
        "locale": "en-US",
        "query": "like:%s" % term,
    }, timeout=25, retries=1)
    games = []
    for product in (data.get("products") or []):
        # Soundtracks and cosmetics are noise: only games and packs carry artwork.
        if product.get("productType") not in (None, "game", "pack"):
            continue
        name = (product.get("title") or "").strip()
        images = gog_product_images(product)
        if not name or not images:
            continue
        games.append({
            "id": str(product.get("id") or product.get("slug") or name),
            "name": name,
            "slug": product.get("slug"),
            "images": images,
        })
    return games

def gog_slug_games(term: str):
    """Legacy fallback: guess the game page slug and read its og:image."""
    games = []
    seen = set()
    for slug in gog_slug_candidates(term):
        if slug in seen:
            continue
        seen.add(slug)
        for prefix in ("en", "ru"):
            try:
                status, body = get_html("https://www.gog.com/%s/game/%s" % (prefix, slug))
            except Exception as exc:
                decky.logger.info("[gameartwork] gog %s/%s failed: %s" % (prefix, slug, exc))
                continue
            title_match = re.search(r'<meta[^>]+property="og:title"[^>]+content="([^"]*)"', body)
            image_match = re.search(r'<meta[^>]+property="og:image"[^>]+content="([^"]*)"', body)
            if not title_match or not image_match:
                continue
            name = clean_gog_title(html.unescape(title_match.group(1)))
            if not name or any(generic in name for generic in GOG_GENERIC_TITLES):
                continue  # redirected to the catalog page: no such game
            games.append({
                "id": slug,
                "name": name,
                "images": {
                    "grid_l": {"url": image_match.group(1), "width": 1600, "height": 740},
                },
            })
            break
    return games

IGDB_TOKEN_URL = "https://id.twitch.tv/oauth2/token"
IGDB_GAMES_URL = "https://api.igdb.com/v4/games"


def igdb_image_url(url, size):
    if not url:
        return None
    if url.startswith("//"):
        url = "https:" + url
    return re.sub(r"/t_[a-z0-9_]+/", "/%s/" % size, url)

# IGDB without a Twitch key: the website renders the same data server-side.
# Search answers with a JSON blob, a game page carries a schema.org VideoGame
# block; key art (artworks) is only available through the official API.
IGDB_WEB_BASE = "https://www.igdb.com"
IGDB_WEB_HEADERS = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}
IGDB_WEB_DETAIL_LIMIT = 5
IGDB_WEB_SCREENSHOT_LIMIT = 6
_IGDB_WEB_OPENER = None


def igdb_cloudinary_id(url):
    match = re.search(r"/([a-z0-9]{4,})\.(?:webp|jpg|jpeg|png)$", url or "")
    return match.group(1) if match else ""


def _igdb_web_opener():
    """igdb.com is behind Cloudflare: keep its cookies between requests."""
    global _IGDB_WEB_OPENER
    if _IGDB_WEB_OPENER is None:
        _IGDB_WEB_OPENER = build_opener(
            HTTPCookieProcessor(CookieJar()),
            HTTPSHandler(context=get_ssl_context()),
        )
    return _IGDB_WEB_OPENER


def igdb_web_get(path, timeout=25, retries=1):
    url = path if path.startswith("http") else IGDB_WEB_BASE + path
    attempt = 0
    while True:
        try:
            request = Request(url, headers=IGDB_WEB_HEADERS)
            with _igdb_web_opener().open(request, timeout=timeout) as res:
                return res.status, res.read().decode("utf-8", "replace")
        except Exception:
            # Cloudflare answers with a stray 404 now and then: one retry with
            # the session cookies is enough to get the real page.
            if attempt >= retries:
                raise
            attempt += 1
            time.sleep(1.2)


def igdb_web_search(term, limit=10):
    """Search igdb.com without a key: React on Rails embeds the JSON."""
    status, body = igdb_web_get("/search?q=%s" % quote(term))
    found = []
    for raw in re.findall(r'<script type="application/json" class="js-react-on-rails-component"[^>]*>(.*?)</script>', body, re.S):
        try:
            data = json.loads(raw)
        except Exception:
            continue
        games = data.get("games") if isinstance(data, dict) else None
        if isinstance(games, list) and games:
            found = games
            break
    results = []
    for item in found[:limit]:
        slug = (item.get("slug") or "").strip()
        if not slug:
            continue
        results.append({
            "id": str(item.get("id") or slug),
            "name": item.get("name") or "",
            "slug": slug,
            "cover": item.get("cloudinary_cover") or "",
        })
    return results


def igdb_web_game_details(slug):
    """schema.org VideoGame block of a game page: cover and screenshots."""
    status, body = igdb_web_get("/games/%s" % (slug or ""))
    for raw in re.findall(r'<script[^>]*type="application/ld\+json"[^>]*>(.*?)</script>', body, re.S):
        try:
            data = json.loads(raw)
        except Exception:
            continue
        if isinstance(data, dict) and data.get("@type") == "VideoGame":
            return data
    return None


def igdb_web_images(cover_id, details):
    """Map the website block to the asset types the plugin knows."""
    images = {}
    extras = []
    details = details or {}
    if not cover_id:
        cover_id = igdb_cloudinary_id((details.get("image") or {}).get("contentUrl"))
    if cover_id:
        images["grid_p"] = {
            "url": "https://images.igdb.com/igdb/image/upload/t_cover_big_2x/%s.jpg" % cover_id,
            "width": 528,
            "height": 748,
        }

    shots = []
    for shot in details.get("screenshot") or []:
        url = (shot or {}).get("contentUrl") or ""
        if not url:
            continue
        # The 1080p transform is what the official API uses for IGDB artwork.
        shots.append({
            "url": url.replace("/t_original/", "/t_1080p/"),
            "width": shot.get("width") or 1920,
            "height": shot.get("height") or 1080,
        })
    if shots:
        images["hero"] = shots[0]
        extras.extend(dict(shot, kind="hero") for shot in shots[1:IGDB_WEB_SCREENSHOT_LIMIT])
    if len(shots) > 1:
        # No key art on the website: a wide screenshot is the closest match.
        images["grid_l"] = shots[1]
    return images, extras


def igdb_web_games(term, limit=10):
    """Keyless IGDB lookup: covers for every hit, screenshots for the first few."""
    games = []
    for index, item in enumerate(igdb_web_search(term, limit=limit)):
        details = None
        if index < IGDB_WEB_DETAIL_LIMIT:
            try:
                details = igdb_web_game_details(item["slug"])
            except Exception as exc:
                decky.logger.info("[gameartwork] igdb web page %r failed: %s" % (item["slug"], exc))
        images, extras = igdb_web_images(item.get("cover"), details)
        if not images:
            continue
        game = {"id": item["id"], "name": item["name"], "images": images}
        if extras:
            game["extras"] = extras
        games.append(game)
    return games


def post_json(url: str, payload, headers=None, timeout: int = 20):
    body = json.dumps(payload).encode("utf-8")
    req_headers = {
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) gameartwork",
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    if headers:
        req_headers.update(headers)
    req = Request(url, data=body, headers=req_headers, method="POST")
    with urlopen(req, context=get_ssl_context(), timeout=timeout) as res:
        return json.loads(res.read().decode("utf-8"))

if WINDOWS:
    from winreg import QueryValueEx, OpenKey, HKEY_CURRENT_USER

    # workaound for py_modules not being added to path on windoge
    sys.path.append(decky.DECKY_PLUGIN_DIR)
    from py_modules.vdf import binary_dump, binary_load
else:
    from vdf import binary_dump, binary_load

def get_steam_path():
    if WINDOWS:
        return Path(QueryValueEx(OpenKey(HKEY_CURRENT_USER, r"Software\Valve\Steam"), "SteamPath")[0])
    else:
        return Path(decky.DECKY_USER_HOME) / '.local' / 'share' / 'Steam'

def get_steam_userdata():
    return get_steam_path() / 'userdata'

def get_steam_libcache():
    return get_steam_path() / 'appcache' / 'librarycache'

def get_steam_icon_dir(appid):
    return get_steam_libcache() / str(appid)

def get_steam_icon_name(icon_hash):
    return "%s.jpg" % icon_hash

def get_userdata_config(steam32):
    return get_steam_userdata() / steam32 / 'config'

PLUGIN_REPO = 'mops1k/decky-gameartwork'
PLUGIN_UPDATE_URL = 'https://api.github.com/repos/%s/releases/latest' % PLUGIN_REPO
PLUGIN_UPDATE_TTL = 6 * 60 * 60
PLUGIN_UPDATE_SETTING = 'plugin_update'

def read_plugin_version():
    try:
        with open(Path(__file__).resolve().parent / 'plugin.json', encoding='utf-8') as plugin_json:
            return str(json.load(plugin_json).get('version') or '').strip()
    except Exception as exc:
        decky.logger.warning('[gameartwork] cannot read plugin.json: %s' % exc)
        return ''

def version_tuple(value):
    return tuple(int(part) for part in re.findall(r'\d+', value or '')[:3]) or (0,)

def release_asset_url(version):
    return 'https://github.com/%s/releases/download/v%s/GameArtwork-%s.zip' % (PLUGIN_REPO, version, version)

def detect_latest_version():
    """Resolve the latest release tag without the GitHub API.

    Unauthenticated api.github.com allows 60 requests per hour per IP, and the
    whole device shares one, so the API is not a reliable update source. The
    web endpoint answers with a redirect to /releases/tag/<tag> and has no such
    limit.
    """
    req = Request(
        'https://github.com/%s/releases/latest' % PLUGIN_REPO,
        method='HEAD',
        headers={'User-Agent': 'gameartwork backend'},
    )
    with urlopen(req, context=get_ssl_context(), timeout=20) as res:
        final_url = res.geturl() or ''
    match = re.search(r'/releases/tag/([^/?#]+)', final_url)
    return match.group(1).lstrip('vV') if match else ''

def _fetch_base64(url, timeout=30):
    req = Request(url, headers={'User-Agent': BACKEND_USER_AGENT})
    with urlopen(req, context=get_ssl_context(), timeout=timeout) as res:
        return b64encode(res.read()).decode('utf-8')


def _read_file_base64(path):
    with open(path, 'rb') as image_file:
        return b64encode(image_file.read()).decode('utf-8')


def _download_to_file(url, output_dir, file_name, timeout=30):
    """Blocking download + write, run from a worker thread."""
    req = Request(url, headers={'User-Agent': BACKEND_USER_AGENT})
    with urlopen(req, context=get_ssl_context(), timeout=timeout) as res:
        content = res.read()
    target = Path(output_dir) / file_name
    with open(target, mode='wb') as f:
        f.write(content)
    return str(target)

class Plugin:
    CACHE_TTL = 6 * 60 * 60
    # An empty answer is usually a blip (Cloudflare 404, a store hiccup), so it
    # must not hide the source for hours: keep it only for a few minutes.
    CACHE_EMPTY_TTL = 5 * 60
    CACHE_LIMIT = 500
    CACHE_FILE = 'source-cache.json'
    # Credentials never leave the device inside a settings backup.
    BACKUP_PREFIXES = ('nonsteam_', 'external_name_', 'applied_art_', 'steam_appid_', 'sources_enabled', 'igdb_client_id', 'filters_')
    BACKUP_SECRETS = ('sgdb_api_key', 'igdb_client_secret')

    async def _main(self):
        self.settings = SettingsManager(name="steamgriddb", settings_directory=decky.DECKY_PLUGIN_SETTINGS_DIR)
        self._cache = self._load_cache()
        self._cache_saved_at = 0

    async def _selftest(self):
        """One-shot check of the keyless sources, run on demand from the log."""
        try:
            epic = await self.epic_search_games("End of Abyss")
            decky.logger.info("[gameartwork] selftest epic: %s" % [g["name"] for g in epic[:3]])
            vndb = await self.vndb_search_games("abyss")
            decky.logger.info("[gameartwork] selftest vndb: %d" % len(vndb))
            steam = await self.steam_search_apps("Hollow Knight")
            decky.logger.info("[gameartwork] selftest steam: %d" % len(steam))
            igdb = await self.igdb_search_games("Hades")
            decky.logger.info("[gameartwork] selftest igdb: %d" % len(igdb))
        except Exception as exc:
            decky.logger.error("[gameartwork] selftest failed: %s" % exc)

    async def log_debug(self, message=''):
        decky.logger.info("[gameartwork] %s" % message)

    async def _unload(self):
        pass

    async def source_health(self):
        """Ping every source (cache bypassed) for the Quick Access health panel.

        Every check is blocking network I/O, so it runs in a worker thread:
        otherwise the gather below would still hit the sources one by one and
        freeze the plugin loop for the sum of all timeouts.
        """
        def check_steam():
            data = get_json("https://store.steampowered.com/api/storesearch/", {
                "term": "Hollow Knight", "l": "english", "cc": "US",
            }, timeout=12)
            return bool(data.get("items"))

        def check_epic():
            query = (
                "query s($Keywords:String!){Catalog{searchStore(keywords:$Keywords,"
                "country:\"US\",locale:\"en-US\",count:1){elements{title}}}}"
            )
            data = post_json("https://store.epicgames.com/graphql", {
                "query": query,
                "variables": {"Keywords": "Fortnite"},
            }, timeout=15)
            return bool(((data.get("data") or {}).get("Catalog") or {}).get("searchStore"))

        def check_gog():
            data = get_json(GOG_CATALOG_URL, {
                "limit": 1, "page": 1, "countryCode": "US", "locale": "en-US",
                "query": "like:cyberpunk",
            }, timeout=20, retries=1)
            return data.get("products") is not None

        def check_vndb():
            data = post_json("https://api.vndb.org/kana/vn", {
                "filters": ["search", "=", "steins gate"],
                "fields": "id",
                "results": 1,
            }, timeout=15)
            return isinstance(data.get("results"), list)

        def check_igdb():
            client_id, client_secret = self._igdb_credentials()
            if not client_id or not client_secret:
                # Keyless mode: the public site is the source, so ping it.
                return bool(igdb_web_search("portal", limit=1))
            token, igdb_client = self._igdb_access_token()
            if not token:
                raise RuntimeError('IGDB token request failed')
            req = Request(IGDB_GAMES_URL, data=b'fields id; limit 1;', method='POST', headers={
                "Client-ID": igdb_client,
                "Authorization": "Bearer %s" % token,
                "Accept": "application/json",
                "Content-Type": "text/plain",
                "User-Agent": BACKEND_USER_AGENT,
            })
            with urlopen(req, context=get_ssl_context(), timeout=15) as res:
                return isinstance(json.loads(res.read().decode("utf-8")), list)

        def check_sgdb():
            key = (self.settings.getSetting('sgdb_api_key', '') or '').strip() or SGDB_PLUGIN_KEY
            # The API itself sits behind Cloudflare, which answers 401 to the
            # plain backend UA even for a valid key: use the Decky-like one.
            req = Request(
                "https://www.steamgriddb.com/api/v2/search/autocomplete/portal",
                headers={
                    "Authorization": "Bearer %s" % key,
                    "Accept": "application/json",
                    "User-Agent": SGDB_USER_AGENT,
                },
            )
            with urlopen(req, context=get_ssl_context(), timeout=15) as res:
                payload = json.loads(res.read().decode("utf-8"))
            if not payload.get("success"):
                raise RuntimeError(', '.join(payload.get('errors') or ['API error']))
            return True

        checks = {
            'sgdb': check_sgdb,
            'steam': check_steam,
            'epic': check_epic,
            'gog': check_gog,
            'vndb': check_vndb,
            'igdb': check_igdb,
        }
        results = {}

        async def run(name, check):
            started = time.time()
            try:
                ok = await asyncio.to_thread(check)
                results[name] = {
                    'ok': bool(ok),
                    'ms': int((time.time() - started) * 1000),
                    'error': '' if ok else 'empty answer',
                }
            except Exception as exc:
                results[name] = {
                    'ok': False,
                    'ms': int((time.time() - started) * 1000),
                    'error': str(exc)[:200],
                }

        await asyncio.gather(*(run(name, check) for name, check in checks.items()))
        return results

    def _settings_snapshot(self):
        data = getattr(self.settings, 'settings', {}) or {}
        return {
            key: value
            for key, value in data.items()
            if isinstance(key, str) and key.startswith(self.BACKUP_PREFIXES)
            and key not in self.BACKUP_SECRETS
        }

    def _backup_dir(self):
        return Path(decky.DECKY_USER_HOME) / 'gameartwork-backup'

    async def export_settings(self):
        """Write the per-game mappings and settings to the user's home."""
        try:
            directory = self._backup_dir()
            directory.mkdir(parents=True, exist_ok=True)
            path = directory / ('gameartwork-settings-%s.json' % time.strftime('%Y%m%d-%H%M%S'))
            payload = {
                'version': 1,
                'exported_at': time.strftime('%Y-%m-%dT%H:%M:%S'),
                'settings': self._settings_snapshot(),
            }
            with open(path, 'w', encoding='utf-8') as backup:
                json.dump(payload, backup, ensure_ascii=False, indent=2)
            decky.logger.info('[gameartwork] settings exported to %s' % path)
            return {'ok': True, 'path': str(path), 'count': len(payload['settings'])}
        except Exception as exc:
            decky.logger.warning('[gameartwork] export failed: %s' % exc)
            return {'ok': False, 'error': str(exc)}

    async def list_backups(self):
        try:
            directory = self._backup_dir()
            backups = []
            for path in sorted(directory.glob('gameartwork-settings-*.json'), reverse=True)[:20]:
                stat_result = path.stat()
                backups.append({
                    'name': path.name,
                    'path': str(path),
                    'size': stat_result.st_size,
                    'modified': int(stat_result.st_mtime),
                })
            return backups
        except Exception:
            return []

    async def import_settings(self, path=''):
        """Restore mappings from a backup written by export_settings."""
        try:
            directory = self._backup_dir()
            if path:
                target = Path(path)
            else:
                candidates = sorted(directory.glob('gameartwork-settings-*.json'), reverse=True)
                if not candidates:
                    return {'ok': False, 'error': 'no backup found in %s' % directory}
                target = candidates[0]
            # Never read an arbitrary path: only the backup directory is allowed.
            if directory.resolve() not in target.resolve().parents:
                return {'ok': False, 'error': 'backup must live in %s' % directory}
            with open(target, encoding='utf-8') as backup:
                payload = json.load(backup)
            settings = payload.get('settings') if isinstance(payload, dict) else None
            if not isinstance(settings, dict):
                return {'ok': False, 'error': 'invalid backup file'}
            pending = {}
            for key, value in settings.items():
                if not isinstance(key, str) or not key.startswith(self.BACKUP_PREFIXES):
                    continue
                # Older backups may still carry credentials: never restore them.
                if key in self.BACKUP_SECRETS:
                    continue
                pending[key] = value
            if not pending:
                return {'ok': False, 'error': 'backup has no settings to restore'}
            # SettingsManager.setSetting() rewrites the whole settings file on
            # every call, so a backup with hundreds of games would mean hundreds
            # of writes: update the in-memory map and commit once.
            self.settings.settings.update(pending)
            self.settings.commit()
            decky.logger.info('[gameartwork] imported %d settings from %s' % (len(pending), target))
            return {'ok': True, 'count': len(pending), 'source': str(target)}
        except Exception as exc:
            decky.logger.warning('[gameartwork] import failed: %s' % exc)
            return {'ok': False, 'error': str(exc)}

    def _cache_path(self):
        return Path(decky.DECKY_PLUGIN_SETTINGS_DIR) / 'cache' / self.CACHE_FILE

    def _load_cache(self):
        """Source cache lives on disk: Decky restarts wipe process memory."""
        try:
            with open(self._cache_path(), encoding='utf-8') as cache_file:
                raw = json.load(cache_file)
        except FileNotFoundError:
            return {}
        except Exception as exc:
            decky.logger.warning('[gameartwork] cannot read cache: %s' % exc)
            return {}
        entries = raw.get('entries') if isinstance(raw, dict) else None
        if not isinstance(entries, dict):
            return {}
        cache = {}
        for key, value in entries.items():
            if isinstance(value, list) and len(value) == 2:
                cache[key] = (float(value[0]), value[1])
        return cache

    def _save_cache(self, force=False):
        now = time.time()
        # Sources answer in bursts: write at most every couple of seconds.
        if not force and now - self._cache_saved_at < 2:
            return
        self._cache_saved_at = now
        try:
            if len(self._cache) > self.CACHE_LIMIT:
                newest = sorted(self._cache.items(), key=lambda item: item[1][0], reverse=True)[:self.CACHE_LIMIT]
                self._cache = dict(newest)
            path = self._cache_path()
            path.parent.mkdir(parents=True, exist_ok=True)
            payload = {
                'version': 1,
                'entries': {key: [ts, value] for key, (ts, value) in self._cache.items()},
            }
            temporary = path.with_suffix('.tmp')
            with open(temporary, 'w', encoding='utf-8') as cache_file:
                json.dump(payload, cache_file, ensure_ascii=False)
            temporary.replace(path)
        except Exception as exc:
            decky.logger.warning('[gameartwork] cannot write cache: %s' % exc)

    def _cache_get(self, key, allow_stale=False):
        entry = self._cache.get(key)
        if not entry:
            return None
        ts, value = entry
        if allow_stale:
            return value
        ttl = self.CACHE_TTL if value else self.CACHE_EMPTY_TTL
        if time.time() - ts <= ttl:
            return value
        # Keep the expired entry: when the network is down it is the only
        # answer we can still give.
        return None

    def _stale_or_none(self, key):
        """Last known answer regardless of age: offline mode."""
        value = self._cache_get(key, allow_stale=True)
        # An empty answer is not worth showing offline: it only means the
        # source failed once.
        return value if value else None

    def _cache_set(self, key, value):
        # This runs inside the Decky loader process: keep the map small, but
        # drop the oldest entries instead of the whole cache (stale answers are
        # what keeps the grid usable offline).
        if key not in self._cache and len(self._cache) >= self.CACHE_LIMIT:
            oldest = sorted(self._cache.items(), key=lambda item: item[1][0])[:len(self._cache) - self.CACHE_LIMIT + 1]
            for old_key, _ in oldest:
                self._cache.pop(old_key, None)
        self._cache[key] = (time.time(), value)
        self._save_cache()
        return value

    async def steam_search_apps(self, term='', lang='russian'):
        """Search the public Steam store, no API key required."""
        term = (term or '').strip()
        if not term:
            return []
        key = "search:%s:%s" % (lang, term.lower())
        cached = self._cache_get(key)
        if cached is not None:
            return cached
        try:
            data = await asyncio.to_thread(get_json, "https://store.steampowered.com/api/storesearch/", {
                "term": term,
                "l": lang,
                "cc": "US",
            })
        except Exception as exc:
            # Offline: a cached answer is better than an empty store.
            stale = self._stale_or_none(key)
            if stale is not None:
                decky.logger.info("[gameartwork] steam storesearch offline, cached %r" % term)
                return stale
            decky.logger.warning("steam storesearch failed: %s" % exc)
            return []
        items = []
        for item in data.get("items") or []:
            if item.get("type") != "app" or not item.get("id"):
                continue
            items.append({
                "appid": int(item["id"]),
                "name": item.get("name") or "",
                "tiny_image": item.get("tiny_image"),
            })
        if not items and lang != "english":
            return await self.steam_search_apps(term, "english")
        decky.logger.info("[gameartwork] steam search %r -> %d" % (term, len(items)))
        return self._cache_set(key, items)

    async def steam_app_assets(self, appid, lang='english', country='US'):
        """Official Steam artwork for one appid via IStoreBrowseService."""
        try:
            appid = int(appid)
        except (TypeError, ValueError):
            return None
        if appid <= 0:
            return None
        key = "assets:%s:%s:%s" % (appid, lang, country)
        cached = self._cache_get(key)
        if cached is not None:
            return cached
        input_json = json.dumps({
            "ids": [{"appid": appid}],
            "context": {"language": lang, "country_code": country},
            "data_request": {"include_assets": True},
        }, separators=(",", ":"))
        try:
            data = await asyncio.to_thread(get_json, "https://api.steampowered.com/IStoreBrowseService/GetItems/v1/", {
                "input_json": input_json,
            })
        except Exception as exc:
            stale = self._stale_or_none(key)
            if stale is not None:
                decky.logger.info("[gameartwork] steam storebrowse offline, cached %s" % appid)
                return stale
            decky.logger.warning("steam storebrowse failed: %s" % exc)
            return None
        items = (data.get("response") or {}).get("store_items") or []
        if not items:
            return None
        item = items[0]
        assets = item.get("assets") or {}
        url_format = assets.get("asset_url_format") or ""

        def asset_url(*names):
            if not url_format:
                return None
            for name in names:
                file_name = assets.get(name)
                if file_name:
                    return STEAM_ASSET_BASE + url_format.replace("${FILENAME}", file_name)
            return None

        community_icon = assets.get("community_icon")
        # The store API has no logo field, but Steam ships a transparent logo
        # PNG next to the app assets. Not every game has one, hence the HEAD.
        logo_url = "https://cdn.cloudflare.steamstatic.com/steam/apps/%s/logo.png" % appid
        result = {
            "appid": appid,
            "name": item.get("name") or "",
            "assets": {
                "grid_p": {
                    "url": asset_url("library_capsule_2x", "library_capsule"),
                    "width": 600,
                    "height": 900,
                },
                "grid_l": {
                    "url": asset_url("header_2x", "header", "main_capsule_2x", "main_capsule"),
                    "width": 920,
                    "height": 430,
                },
                "hero": {
                    "url": asset_url("library_hero_2x", "library_hero", "hero_capsule_2x", "hero_capsule"),
                    "width": 1920,
                    "height": 620,
                },
                "logo": {
                    "url": logo_url if await asyncio.to_thread(http_status, logo_url, 6) == 200 else None,
                    "width": 640,
                    "height": 160,
                },
                "icon": {
                    "url": ("%s%s/%s.jpg" % (STEAM_ICON_BASE, appid, community_icon)) if community_icon else None,
                    "width": 32,
                    "height": 32,
                },
            },
        }
        return self._cache_set(key, result)

    async def epic_search_games(self, term=''):
        """Search the public Epic Games Store catalog (no API key)."""
        term = (term or '').strip()
        if not term:
            return []
        key = "epic:%s" % term.lower()
        cached = self._cache_get(key)
        if cached is not None:
            return cached
        query = (
            "query s($Keywords:String!,$Country:String!,$Locale:String!){"
            "Catalog{searchStore(keywords:$Keywords,country:$Country,locale:$Locale,count:12){"
            "elements{title id productSlug keyImages{type url}}}}}"
        )
        try:
            data = await asyncio.to_thread(post_json, "https://store.epicgames.com/graphql", {
                "query": query,
                "variables": {
                    "Keywords": term,
                    "Country": "US",
                    "Locale": "en-US",
                },
            })
        except Exception as exc:
            stale = self._stale_or_none(key)
            if stale is not None:
                decky.logger.info("[gameartwork] epic offline, cached %r" % term)
                return stale
            decky.logger.warning("epic search failed: %s" % exc)
            return []
        elements = (((data.get("data") or {}).get("Catalog") or {}).get("searchStore") or {}).get("elements") or []
        decky.logger.info("[gameartwork] epic elements %r -> %d" % (term, len(elements)))
        games = []
        for element in elements:
            by_type = {}
            for image in element.get("keyImages") or []:
                url = image.get("url") or ""
                # Video entries (heroCarouselVideo) are qs:// links, not images.
                if not url.startswith("https://"):
                    continue
                by_type.setdefault(image.get("type"), []).append(url)

            def first(*image_types):
                for image_type in image_types:
                    urls = by_type.get(image_type) or []
                    if urls:
                        return urls[0]
                return None

            images = {}
            tall = first("OfferImageTall", "DieselStoreFrontTall", "DieselGameBoxTall", "CodeRedemption_340x440")
            if tall:
                images["grid_p"] = {"url": tall, "width": 1200, "height": 1600}
            wide = first("OfferImageWide", "DieselStoreFrontWide", "ESGalleryLandscape")
            if wide:
                images["grid_l"] = {"url": wide, "width": 1920, "height": 1080}
            logo = first("ProductLogo")
            if logo:
                images["logo"] = {"url": logo, "width": 350, "height": 100}
            # featuredMedia carries the carousel key art and gameplay shots.
            hero = first("featuredMedia", "ESGalleryLandscape") or wide
            if hero:
                images["hero"] = {"url": hero, "width": 1920, "height": 1080}
            icon = first("Thumbnail", "OfferImageTall")
            if icon:
                images["icon"] = {"url": icon, "width": 480, "height": 480}
            if not images:
                continue
            games.append({
                "id": element.get("id"),
                "name": element.get("title") or "",
                "slug": element.get("productSlug"),
                "images": images,
            })
        decky.logger.info("[gameartwork] epic search %r -> %d" % (term, len(games)))
        return self._cache_set(key, games)

    async def vndb_search_games(self, term=''):
        """Search VNDB (Kana API, no API key); useful for visual novels."""
        term = (term or '').strip()
        if not term:
            return []
        key = "vndb:%s" % term.lower()
        cached = self._cache_get(key)
        if cached is not None:
            return cached
        try:
            data = await asyncio.to_thread(post_json, "https://api.vndb.org/kana/vn", {
                "filters": ["search", "=", term],
                "fields": "id,title,image.url,screenshots.url",
                "results": 10,
            })
        except Exception as exc:
            stale = self._stale_or_none(key)
            if stale is not None:
                decky.logger.info("[gameartwork] vndb offline, cached %r" % term)
                return stale
            decky.logger.warning("vndb search failed: %s" % exc)
            return []
        games = []
        for item in data.get("results") or []:
            image = item.get("image") or {}
            url = image.get("url")
            if not url:
                continue
            images = {
                "grid_p": {
                    "url": url,
                    "width": 600,
                    "height": 900,
                },
            }
            # VN screenshots are 16:9: the first one makes a usable hero, the
            # second one a wide capsule, so the store grid is not empty.
            shots = [shot.get("url") for shot in (item.get("screenshots") or []) if shot.get("url")]
            if shots:
                images["hero"] = {"url": shots[0], "width": 1280, "height": 720}
            if len(shots) > 1:
                images["grid_l"] = {"url": shots[1], "width": 1280, "height": 720}
            games.append({
                "id": item.get("id"),
                "name": item.get("title") or "",
                "images": images,
            })
        decky.logger.info("[gameartwork] vndb search %r -> %d" % (term, len(games)))
        return self._cache_set(key, games)

    def _igdb_credentials(self):
        client_id = (self.settings.getSetting("igdb_client_id", "") or "").strip()
        client_secret = (self.settings.getSetting("igdb_client_secret", "") or "").strip()
        return client_id, client_secret

    def _igdb_access_token(self):
        client_id, client_secret = self._igdb_credentials()
        if not client_id or not client_secret:
            return None, None
        cached = getattr(self, "_igdb_token", None)
        if cached and cached[0] > time.time() + 120 and cached[2] == client_id:
            return cached[1], client_id
        token_url = "%s?%s" % (IGDB_TOKEN_URL, urlencode({
            "client_id": client_id,
            "client_secret": client_secret,
            "grant_type": "client_credentials",
        }))
        req = Request(token_url, data=b"", method="POST")
        try:
            with urlopen(req, context=get_ssl_context(), timeout=20) as res:
                payload = json.loads(res.read().decode("utf-8"))
        except Exception as exc:
            decky.logger.warning("[gameartwork] igdb token failed: %s" % exc)
            return None, None
        token = payload.get("access_token")
        expires_in = int(payload.get("expires_in") or 3600)
        if not token:
            return None, None
        self._igdb_token = (time.time() + expires_in, token, client_id)
        return token, client_id

    async def igdb_search_games(self, term=''):
        """IGDB: the official API with a Twitch key, the public website without."""
        term = (term or '').strip()
        if not term:
            return []
        key = "igdb:%s" % term.lower()
        cached = self._cache_get(key)
        if cached is not None:
            return cached
        token, client_id = await asyncio.to_thread(self._igdb_access_token)
        if not token:
            # No Twitch key: scrape the public site (cover + screenshots only).
            decky.logger.info("[gameartwork] igdb keyless, reading igdb.com")
            try:
                return self._cache_set(key, await asyncio.to_thread(igdb_web_games, term))
            except Exception as exc:
                decky.logger.warning("[gameartwork] igdb web search failed: %s" % exc)
                return self._cache_set(key, [])

        body = 'search "%s"; fields id,name,cover.url,artworks.url,screenshots.url; limit 10;' % term.replace('"', ' ')
        req = Request(IGDB_GAMES_URL, data=body.encode("utf-8"), method="POST", headers={
            "Client-ID": client_id,
            "Authorization": "Bearer %s" % token,
            "Accept": "application/json",
            "Content-Type": "text/plain",
            "User-Agent": "gameartwork backend",
        })
        try:
            items = await asyncio.to_thread(_read_json_body, req, 25)
        except Exception as exc:
            stale = self._stale_or_none(key)
            if stale is not None:
                decky.logger.info("[gameartwork] igdb offline, cached %r" % term)
                return stale
            decky.logger.warning("[gameartwork] igdb request failed: %s" % exc)
            try:
                return self._cache_set(key, await asyncio.to_thread(igdb_web_games, term))
            except Exception as web_exc:
                decky.logger.warning("[gameartwork] igdb web search failed: %s" % web_exc)
                return self._cache_set(key, [])

        games = []
        for item in items:
            images = {}
            extras = []
            cover = (item.get("cover") or {}).get("url")
            cover_url = igdb_image_url(cover, "t_cover_big_2x")
            if cover_url:
                images["grid_p"] = {"url": cover_url, "width": 528, "height": 748}

            artworks = [
                igdb_image_url((artwork or {}).get("url"), "t_1080p")
                for artwork in (item.get("artworks") or [])
            ]
            artworks = [url for url in artworks if url]
            if artworks:
                images["grid_l"] = {"url": artworks[0], "width": 1920, "height": 1080}
                # Extra key art is still artwork, not a duplicate: show it in the
                # wide tab next to the first one.
                extras.extend(
                    {"kind": "grid_l", "url": url, "width": 1920, "height": 1080}
                    for url in artworks[1:4]
                )

            screenshots = [
                igdb_image_url((shot or {}).get("url"), "t_1080p")
                for shot in (item.get("screenshots") or [])
            ]
            screenshots = [url for url in screenshots if url]
            if screenshots:
                images["hero"] = {"url": screenshots[0], "width": 1920, "height": 1080}
                extras.extend(
                    {"kind": "hero", "url": url, "width": 1920, "height": 1080}
                    for url in screenshots[1:6]
                )

            if not images:
                continue
            game = {"id": str(item.get("id")), "name": item.get("name") or "", "images": images}
            if extras:
                game["extras"] = extras
            games.append(game)
        decky.logger.info("[gameartwork] igdb search %r -> %d" % (term, len(games)))
        return self._cache_set(key, games)

    async def gog_search_games(self, term=''):
        """Search GOG through the catalog API; fall back to page slug parsing."""
        term = (term or '').strip()
        if not term:
            return []
        key = "gog:%s" % term.lower()
        cached = self._cache_get(key)
        if cached is not None:
            return cached

        games = []
        try:
            games = await asyncio.to_thread(gog_catalog_games, term)
        except Exception as exc:
            stale = self._stale_or_none(key)
            if stale is not None:
                decky.logger.info("[gameartwork] gog offline, cached %r" % term)
                return stale
            decky.logger.warning("[gameartwork] gog catalog failed: %s" % exc)
        if not games:
            games = await asyncio.to_thread(gog_slug_games, term)

        decky.logger.info("[gameartwork] gog search %r -> %d" % (term, len(games)))
        return self._cache_set(key, games)

    async def download_as_base64(self, url=''):
        # A stuck CDN must not block applying artwork forever; the download
        # itself runs in a thread so the plugin loop keeps answering.
        return await asyncio.to_thread(_fetch_base64, url, 30)

    async def read_file_as_base64(self, path=''):
        return await asyncio.to_thread(_read_file_base64, path)

    async def get_local_start(self):
        return decky.DECKY_USER_HOME

    async def download_file(self, url='', output_dir='', file_name=''):
        decky.logger.debug((url, output_dir, file_name))
        try:
            if not access(output_dir, W_OK):
                return False
            return await asyncio.to_thread(_download_to_file, url, output_dir, file_name, 30)
        except Exception as exc:
            decky.logger.warning('[gameartwork] download failed for %s: %s' % (url, exc))
        return False

    async def custom_artwork_state(self, appid, owner_id):
        """Which artwork types already have a custom file in Steam's grid dir.

        Steam has no API to read custom artwork, so the presence of the files
        it writes next to shortcuts is the only reliable signal: <appid>.png
        is the wide capsule, <appid>p.png the portrait one, and the rest use
        type suffixes.
        """
        try:
            appid = int(appid)
        except (TypeError, ValueError):
            return {}
        grid_dir = get_userdata_config(str(owner_id)) / 'grid'
        try:
            names = {entry.name for entry in grid_dir.iterdir()}
        except Exception:
            return {}
        suffixes = {
            'grid_p': ('p.png', 'p.jpg', 'p.jpeg', 'p.webp'),
            'grid_l': ('.png', '.jpg', '.jpeg', '.webp'),
            'hero': ('_hero.png', '_hero.jpg', '_hero.jpeg', '_hero.webp'),
            'logo': ('_logo.png', '_logo.jpg', '_logo.jpeg', '_logo.webp'),
            'icon': ('_icon.png', '_icon.jpg', '_icon.ico', '_icon.jpeg'),
        }
        return {
            asset_type: any(('%s%s' % (appid, suffix)) in names for suffix in type_suffixes)
            for asset_type, type_suffixes in suffixes.items()
        }

    async def set_shortcut_icon_from_path(self, appid, owner_id, path):
        ext = Path(path).suffix
        iconname = "%s_icon%s" % (appid, ext)
        output_file = get_userdata_config(owner_id) / 'grid' / iconname
        saved_path = str(copyfile(path, output_file))
        return await self.set_shortcut_icon(appid, owner_id, path=saved_path)

    async def set_shortcut_icon_from_url(self, appid, owner_id, url):
        output_dir = get_userdata_config(owner_id) / 'grid'
        ext = Path(urlparse(url).path).suffix
        iconname = "%s_icon%s" % (appid, ext)
        saved_path = await self.download_file(url, output_dir, file_name=iconname)
        if saved_path:
            return await self.set_shortcut_icon(appid, owner_id, path=saved_path)
        else:
            raise Exception("Failed to download icon from %s" % url)

    async def set_shortcut_icon(self, appid, owner_id, path=None):
        shortcuts_vdf = get_userdata_config(owner_id) / 'shortcuts.vdf'

        with open(shortcuts_vdf, "rb") as shortcuts_file:
            d = binary_load(shortcuts_file)
        for shortcut in d['shortcuts'].values():
            shortcut_appid = (shortcut['appid'] & 0xffffffff) | 0x80000000
            if shortcut_appid == appid:
                if shortcut['icon'] == path:
                    return 'icon_is_same_path'

                # Clear icon
                if path is None:
                    shortcut['icon'] = ''
                else:
                    shortcut['icon'] = path
                # shortcuts.vdf holds every shortcut of the user: keep a copy
                # and write atomically, a half-written file loses them all.
                backup = shortcuts_vdf.with_name('shortcuts.vdf.bak')
                try:
                    copyfile(shortcuts_vdf, backup)
                except Exception as exc:
                    decky.logger.warning('[gameartwork] cannot back up shortcuts.vdf: %s' % exc)
                temporary = shortcuts_vdf.with_name('shortcuts.vdf.tmp')
                with open(temporary, 'wb') as output_file:
                    binary_dump(d, output_file)
                temporary.replace(shortcuts_vdf)
                return True
        raise Exception('Could not find shortcut to edit')

    async def set_steam_icon_from_url(self, appid, url, icon_hash):
        # Poison the cache through a temp file, Steam restores the original icon
        # if it catches its cache file being written to directly
        output_dir = get_steam_icon_dir(appid)
        output_dir.mkdir(parents=True, exist_ok=True)
        icon_name = get_steam_icon_name(icon_hash)
        temp_path = output_dir / ("%s_temp" % icon_name)
        if not await self.download_file(url, str(output_dir), file_name=temp_path.name):
            temp_path.unlink(missing_ok=True)
            raise Exception("Failed to download icon from %s" % url)
        output_file = output_dir / icon_name
        temp_path.replace(output_file)
        return str(output_file)

    async def set_steam_icon_from_path(self, appid, path, icon_hash):
        # Poison the cache through a temp file, Steam restores the original icon
        # if it catches its cache file being written to directly
        output_dir = get_steam_icon_dir(appid)
        output_dir.mkdir(parents=True, exist_ok=True)
        icon_name = get_steam_icon_name(icon_hash)
        temp_path = output_dir / ("%s_temp" % icon_name)
        copyfile(path, temp_path)
        output_file = output_dir / icon_name
        temp_path.replace(output_file)
        return str(output_file)

    async def set_setting(self, key, value):
        self.settings.setSetting(key, value)

    async def get_setting(self, key, fallback):
        return self.settings.getSetting(key, fallback)

    async def check_update(self, force=False):
        """Look up the newest GitHub release of the fork.

        Returns the release asset URL so the frontend can hand it to the
        Decky Loader (utilities/install_plugin), which downloads and unpacks
        the update with its usual confirmation prompt.
        """
        current = read_plugin_version()
        cached = self.settings.getSetting(PLUGIN_UPDATE_SETTING, None)
        now = time.time()
        if (
            not force
            and isinstance(cached, dict) and not cached.get('error')
            and now - float(cached.get('checked') or 0) < PLUGIN_UPDATE_TTL
        ):
            cached['current'] = current
            cached['available'] = version_tuple(cached.get('latest')) > version_tuple(current)
            if not cached['available']:
                cached['url'] = ''
            return cached

        info = {
            'current': current,
            'latest': current,
            'available': False,
            'url': '',
            'size': 0,
            'notes': '',
            'published_at': '',
            'checked': now,
        }
        api_error = ''
        release = None
        try:
            release = await asyncio.to_thread(get_json, PLUGIN_UPDATE_URL, timeout=20)
        except Exception as exc:
            decky.logger.warning('[gameartwork] GitHub API update check failed: %s' % exc)
            api_error = str(exc)

        checked_ok = False
        if release:
            latest = str(release.get('tag_name') or '').strip().lstrip('vV') or current
            asset = next((
                item for item in (release.get('assets') or [])
                if str(item.get('name') or '').startswith('GameArtwork-')
                and str(item.get('name') or '').endswith('.zip')
            ), None)
            info.update({
                'latest': latest,
                'url': str((asset or {}).get('browser_download_url') or '') or release_asset_url(latest),
                'size': int((asset or {}).get('size') or 0),
                'notes': str(release.get('body') or ''),
                'published_at': str(release.get('published_at') or ''),
            })
            checked_ok = True
        else:
            # The API is rate limited or unreachable: fall back to the web redirect,
            # which still gives us the version and therefore the release asset URL.
            try:
                latest = await asyncio.to_thread(detect_latest_version) or current
                info.update({'latest': latest, 'url': release_asset_url(latest)})
                checked_ok = True
            except Exception as exc:
                decky.logger.warning('[gameartwork] release redirect update check failed: %s' % exc)
                api_error = api_error or str(exc)

        info['available'] = checked_ok and version_tuple(info['latest']) > version_tuple(current)
        if not info['available']:
            # Nothing to install: never offer a stale or irrelevant asset URL.
            info['url'] = ''
        if not checked_ok:
            info['error'] = api_error or 'update check failed'
            # Keep the last good answer instead of replacing it with a failure.
            if isinstance(cached, dict) and cached.get('url'):
                cached['current'] = current
                cached['available'] = version_tuple(cached.get('latest')) > version_tuple(current)
                return cached
        self.settings.setSetting(PLUGIN_UPDATE_SETTING, info)
        return info

    async def _migration(self):
        decky.migrate_settings(str(Path(decky.DECKY_HOME) / "settings" / "steamgriddb.json"))
