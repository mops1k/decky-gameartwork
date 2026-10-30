import sys
import html
import json
import re
import time
from platform import system
from os.path import dirname
from os import W_OK, access, stat
from stat import FILE_ATTRIBUTE_HIDDEN
from urllib.request import Request, urlopen
from urllib.parse import urlparse, urlencode
from base64 import b64encode
from pathlib import Path
from shutil import copyfile
from settings import SettingsManager # type: ignore
from helpers import get_ssl_context # type: ignore
import decky # type: ignore

WINDOWS = system() == "Windows"

SGDB_CDN = "https://cdn2.steamgriddb.com/"
SGDB_CDN_PROXY = "https://deckyloader.ru/sgdb-cdn/"
STEAM_ASSET_BASE = "https://shared.steamstatic.com/store_item_assets/"
STEAM_ICON_BASE = "https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/"

def proxy_sgdb_url(url: str) -> str:
    """Rewrite SGDB CDN links through the mirror that is reachable in RU."""
    if url and url.startswith(SGDB_CDN):
        return SGDB_CDN_PROXY + url[len(SGDB_CDN):]
    return url

def get_json(url: str, params=None, timeout: int = 15):
    if params:
        url = "%s?%s" % (url, urlencode(params))
    req = Request(url, headers={
        "User-Agent": "gameartwork backend",
        "Accept": "application/json",
    })
    with urlopen(req, context=get_ssl_context(), timeout=timeout) as res:
        return json.loads(res.read().decode("utf-8"))

def get_html(url: str, timeout: int = 25):
    req = Request(url, headers={
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) gameartwork",
        "Accept-Language": "en-US,en;q=0.9",
    })
    with urlopen(req, context=get_ssl_context(), timeout=timeout) as res:
        return res.status, res.read().decode("utf-8", "replace")

GOG_GENERIC_TITLES = ("Лучшие видеоигры", "Best video games", "GOG.COM")

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

IGDB_TOKEN_URL = "https://id.twitch.tv/oauth2/token"
IGDB_GAMES_URL = "https://api.igdb.com/v4/games"


def igdb_image_url(url, size):
    if not url:
        return None
    if url.startswith("//"):
        url = "https:" + url
    return re.sub(r"/t_[a-z0-9_]+/", "/%s/" % size, url)


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

class Plugin:
    CACHE_TTL = 6 * 60 * 60

    async def _main(self):
        self.settings = SettingsManager(name="steamgriddb", settings_directory=decky.DECKY_PLUGIN_SETTINGS_DIR)
        self._cache = {}
        try:
            import asyncio
            asyncio.get_event_loop().create_task(self._selftest())
        except Exception as exc:
            decky.logger.warning("[gameartwork] cannot schedule selftest: %s" % exc)

    async def _selftest(self):
        """One-shot check that the keyless sources are reachable from Decky."""
        try:
            epic = await self.epic_search_games("End of Abyss")
            decky.logger.info("[gameartwork] selftest epic: %s" % [g["name"] for g in epic[:3]])
            vndb = await self.vndb_search_games("abyss")
            decky.logger.info("[gameartwork] selftest vndb: %d" % len(vndb))
            steam = await self.steam_search_apps("Hollow Knight")
            decky.logger.info("[gameartwork] selftest steam: %d" % len(steam))
        except Exception as exc:
            decky.logger.error("[gameartwork] selftest failed: %s" % exc)

    async def log_debug(self, message=''):
        decky.logger.info("[gameartwork] %s" % message)

    async def _unload(self):
        pass

    def _cache_get(self, key):
        entry = self._cache.get(key)
        if not entry:
            return None
        ts, value = entry
        if time.time() - ts > self.CACHE_TTL:
            self._cache.pop(key, None)
            return None
        return value

    def _cache_set(self, key, value):
        # keep the cache small: this runs inside the Decky loader process
        if len(self._cache) > 256:
            self._cache.clear()
        self._cache[key] = (time.time(), value)
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
            data = get_json("https://store.steampowered.com/api/storesearch/", {
                "term": term,
                "l": lang,
                "cc": "US",
            })
        except Exception as exc:
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
            data = get_json("https://api.steampowered.com/IStoreBrowseService/GetItems/v1/", {
                "input_json": input_json,
            })
        except Exception as exc:
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
            data = post_json("https://store.epicgames.com/graphql", {
                "query": query,
                "variables": {
                    "Keywords": term,
                    "Country": "US",
                    "Locale": "en-US",
                },
            })
        except Exception as exc:
            decky.logger.warning("epic search failed: %s" % exc)
            return []
        elements = (((data.get("data") or {}).get("Catalog") or {}).get("searchStore") or {}).get("elements") or []
        decky.logger.info("[gameartwork] epic elements %r -> %d" % (term, len(elements)))
        games = []
        for element in elements:
            images = {}
            for image in element.get("keyImages") or []:
                image_type = image.get("type")
                url = image.get("url") or ""
                if not url.startswith("https://"):
                    continue
                if image_type == "OfferImageTall":
                    images["grid_p"] = {"url": url, "width": 1200, "height": 1600}
                elif image_type == "OfferImageWide":
                    images["grid_l"] = {"url": url, "width": 1920, "height": 1080}
                elif image_type == "Thumbnail":
                    images["icon"] = {"url": url, "width": 480, "height": 480}
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
            data = post_json("https://api.vndb.org/kana/vn", {
                "filters": ["search", "=", term],
                "fields": "id,title,image.url",
                "results": 10,
            })
        except Exception as exc:
            decky.logger.warning("vndb search failed: %s" % exc)
            return []
        games = []
        for item in data.get("results") or []:
            image = item.get("image") or {}
            url = image.get("url")
            if not url:
                continue
            games.append({
                "id": item.get("id"),
                "name": item.get("title") or "",
                "images": {
                    "grid_p": {
                        "url": url,
                        "width": 0,
                        "height": 0,
                    },
                },
            })
        decky.logger.info("[gameartwork] vndb search %r -> %d" % (term, len(games)))
        return self._cache_set(key, games)

    def _igdb_credentials(self):
        client_id = (self.settings.getSetting("igdb_client_id", "") or "").strip()
        client_secret = (self.settings.getSetting("igdb_client_secret", "") or "").strip()
        return client_id, client_secret

    async def _igdb_access_token(self):
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
        """IGDB (needs a free Twitch Client ID/Secret in the plugin settings)."""
        term = (term or '').strip()
        if not term:
            return []
        key = "igdb:%s" % term.lower()
        cached = self._cache_get(key)
        if cached is not None:
            return cached
        token, client_id = await self._igdb_access_token()
        if not token:
            decky.logger.info("[gameartwork] igdb skipped: no client id/secret")
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
            with urlopen(req, context=get_ssl_context(), timeout=25) as res:
                items = json.loads(res.read().decode("utf-8"))
        except Exception as exc:
            decky.logger.warning("[gameartwork] igdb request failed: %s" % exc)
            return self._cache_set(key, [])

        games = []
        for item in items:
            images = {}
            cover = (item.get("cover") or {}).get("url")
            cover_url = igdb_image_url(cover, "t_cover_big_2x")
            if cover_url:
                images["grid_p"] = {"url": cover_url, "width": 528, "height": 748}
            artworks = item.get("artworks") or []
            if artworks:
                art_url = igdb_image_url((artworks[0] or {}).get("url"), "t_1080p")
                if art_url:
                    images["grid_l"] = {"url": art_url, "width": 1920, "height": 1080}
            screenshots = item.get("screenshots") or []
            if screenshots:
                shot_url = igdb_image_url((screenshots[0] or {}).get("url"), "t_1080p")
                if shot_url:
                    images["hero"] = {"url": shot_url, "width": 1920, "height": 1080}
            if not images:
                continue
            games.append({"id": str(item.get("id")), "name": item.get("name") or "", "images": images})
        decky.logger.info("[gameartwork] igdb search %r -> %d" % (term, len(games)))
        return self._cache_set(key, games)

    async def gog_search_games(self, term=''):
        """GOG has no public search API: match the title against the game page slug."""
        term = (term or '').strip()
        if not term:
            return []
        key = "gog:%s" % term.lower()
        cached = self._cache_get(key)
        if cached is not None:
            return cached

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

        decky.logger.info("[gameartwork] gog search %r -> %d" % (term, len(games)))
        return self._cache_set(key, games)

    async def download_as_base64(self, url=''):
        req = Request(proxy_sgdb_url(url), headers={'User-Agent': 'decky-steamgriddb backend'})
        content = urlopen(req, context=get_ssl_context()).read()
        return b64encode(content).decode('utf-8')

    async def read_file_as_base64(self, path=''):
        with open(path, 'rb') as image_file:
            return b64encode(image_file.read()).decode('utf-8')

    async def get_local_start(self):
        return decky.DECKY_USER_HOME

    async def download_file(self, url='', output_dir='', file_name=''):
        decky.logger.debug({url, output_dir, file_name})
        try:
            if access(dirname(output_dir), W_OK):
                req = Request(proxy_sgdb_url(url), headers={'User-Agent': 'decky-steamgriddb backend'})
                res = urlopen(req, context=get_ssl_context())
                if res.status == 200:
                    with open(Path(output_dir) / file_name, mode='wb') as f:
                        f.write(res.read())
                    return str(Path(output_dir) / file_name)
                return False
        except:
            return False

        return False

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

        d = binary_load(open(shortcuts_vdf, "rb"))
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
                binary_dump(d, open(shortcuts_vdf, 'wb'))
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

    async def _migration(self):
        decky.migrate_settings(str(Path(decky.DECKY_HOME) / "settings" / "steamgriddb.json"))
