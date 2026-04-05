# Mollie Extension

Chrome Manifest V3 extension for Mollie's browser-based marketplace workflows.

First-pass scope:
- detect Mollie in the browser and store an authenticated workspace session
- receive handoff payloads from the Mollie web app
- import a single eBay listing from the active browser tab back into Mollie

Not yet in this slice:
- bulk marketplace import
- cross-marketplace form filling
- publish queue automation
- non-eBay marketplace content scripts

## Local development

1. Build the extension:

```bash
pnpm --filter @reselleros/extension build
```

2. Open `chrome://extensions`
3. Enable `Developer mode`
4. Click `Load unpacked`
5. Select `apps/extension/dist`

## Current flow

1. Sign in to Mollie in the browser
2. Open an inventory item in Mollie and hand off an extension task
3. Visit an eBay listing page
4. Open the extension popup
5. Click `Import active eBay listing`

The extension uses the Mollie-authenticated session explicitly handed off from the web app. Mollie remains the system of record for task state, imports, and listing linkage.
