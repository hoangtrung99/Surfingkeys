# Chrome Web Store package

Everything needed to publish Surfingkeys Palette on the Chrome Web Store.

- `LISTING.md`: listing text, permission justifications and privacy answers to paste into the dashboard.
- `PRIVACY.md`: the privacy policy the listing links to.
- `screenshots/`: five 1280x800 screenshots, in listing order.
- `promo-440x280.png`: the small promo tile. `icon-128.png`: the store icon.

## Build the package

```bash
npm ci
npm run build:store     # dist/store/chrome: name "Surfingkeys Palette", its own icons, no "key"
(cd dist/store/chrome && zip -qr ../../../surfingkeys-palette-store.zip . -x sk.zip)
```

The store build differs from `build:prod` only in the manifest (name, description, homepage, no `key`) and the icons (`src/icons-store`, rendered from `icon.svg` by the theme repo's `tools/store_icons.py`). Without the `key`, the store assigns the extension a new ID.

## The store's extension ID

The listing is https://chromewebstore.google.com/detail/surfingkeys-palette/jmblmhjmcjjkjddhjaddkbkpgeolmebm. That ID is not the unpacked build's, so the native host lists both in `allowed_origins` (`src/nvim/server/install.sh`, `src/nvim/server/NativeMessagingHosts/Surfingkeys.json`).

## Updating

Bump `version` in `package.json`: the store refuses a version it already has. Every push to master then publishes a release (`.github/workflows/release.yml`) whose `surfingkeys-palette-chrome-web-store-<tag>.zip` is this package: upload it on the dashboard's Package tab and submit it for review.
