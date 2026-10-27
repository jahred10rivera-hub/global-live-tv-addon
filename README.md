# Global Live TV — Stremio addon

A starter Stremio addon that indexes publicly listed worldwide live-TV streams from the community-maintained `iptv-org` playlist.

## Important limitations
- This does **not** provide literally every TV channel in the world.
- Listings can include dead links, geo-restrictions, buffering, or streams that later disappear.
- A public listing is not proof that a stream is authorized in every territory. Use only channels you are allowed to access.
- This addon does not bypass subscriptions, DRM, or geographic restrictions.
- The playlist is fetched and cached for 15 minutes.

## Run on Windows
1. Install Node.js 18 or newer from https://nodejs.org/
2. Extract this ZIP.
3. Open Command Prompt in this folder.
4. Run:
   ```bat
   npm install
   npm start
   ```
5. On the same computer, test `http://localhost:7000/manifest.json`.

## Install in Stremio on iPad
Stremio on the iPad must be able to reach the addon's server. `localhost` only works on the computer itself, so you must deploy this project to a public HTTPS Node.js host (or host it on a network address reachable by the iPad). Then open the deployed `https://YOUR-HOST/manifest.json` URL on the iPad and follow Stremio's install prompt.

## Searching
Open the addon's catalog in Stremio and search by channel name, country, language, or category. Results are limited to 100 per request for performance.

## Data source
`https://iptv-org.github.io/iptv/index.m3u`
