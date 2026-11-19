# Repository Guidelines

## Project Structure

Konfoly is a static Russian-language series catalog and video player. The root contains ES modules. `app.js` controls navigation, `series-library.js` renders the catalog, and `series-metadata.js` loads localized metadata. Playback logic lives in `providers.js`, `player-ui.js`, and the `video-*.js` modules. Use `series-config.js` and `series-data.js` for show-specific mappings and editorial metadata. Artwork and fonts live in `assets/`, vendor files and their licenses in `vendor/`, and automated checks in `tests/`.

## Build and Development

- Run `npm ci` with Node.js 22 or later to install the pinned build dependency.
- Run `npm run build` to bundle the site into `dist/` with content-hashed assets and a generated Content Security Policy.
- Run `python3 -m http.server 8427 --bind 127.0.0.1 --directory dist` to serve the built site locally.

## Coding Style

Use two-space indentation and follow the surrounding module’s formatting. Use camelCase for JavaScript identifiers and kebab-case for module filenames and CSS classes. Import shared helpers explicitly. Keep series exceptions and provider configuration in their existing data modules. Add new network origins to the appropriate CSP directive in `scripts/build.js`. Keep credentials out of source and generated assets.

## Testing

Run `npm test` with Node’s built-in test runner. Existing checks cover app flow, playback, storage, configuration, and Telegram sync. Follow the `*.cjs` and `config.js` patterns under `tests/`. Register new test files in the npm test command. For UI changes, also serve `dist/` and verify the affected route in a browser.

## Commits and Pull Requests

Follow the Git history with short, action-oriented subjects, usually in Russian. Use the `beta` branch for preview work. In a pull request, describe the user-visible change, list the checks you ran, and link the related issue if one exists. Include screenshots for visible layout changes. The beta Pages site publishes the contents of `dist/` separately from the release.
