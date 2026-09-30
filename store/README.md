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

## After the first upload

The store's extension ID is not upstream's, so the Neovim host (`src/nvim/server/NativeMessagingHosts/Surfingkeys.json`) must list it too: add `chrome-extension://<new id>/` to `allowed_origins`.

## Updating

Bump `version` in `package.json` (the store refuses a version it already has), rebuild, zip, and upload on the dashboard's Package tab.
