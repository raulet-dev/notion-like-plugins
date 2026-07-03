# Master Orchestrator — Sub-Plugin Standard

## Why this changed

Sub-plugins used to live as their own subfolder inside `plugins-pool/`
(`plugins-pool/font-colors/manifest.json`, `plugins-pool/font-colors/main.js`, ...).
That put files three levels deep under `.obsidian/plugins/`, and any
subfolder nested inside a plugin's own folder was unreliable to sync — its
contents would get silently omitted.

Standalone-folder support has also been intentionally dropped. Sub-plugins
are no longer meant to be droppable into `.obsidian/plugins/` on their own —
they only ever run *inside* the orchestrator. That simplifies the format
since we no longer need each sub-plugin's `manifest.json` to be a fully
valid, standalone-loadable Obsidian manifest.

The fix: every sub-plugin now ships as a flat set of prefixed files sitting
directly in the **same folder as the orchestrator's own `main.js**` — no
`plugins-pool/` subfolder at all, no subfolder of any kind. Everything the
orchestrator manages lives at exactly one folder depth under
`.obsidian/plugins/`, the same depth as any normal Obsidian plugin.

## File layout

```
<vault>/.obsidian/plugins/notion-like-plugins/
├── manifest.json                        (orchestrator's own manifest)
├── main.js                              (orchestrator itself)
├── data.json                            (orchestrator's own settings: enabledModules map)
├── font-colors-manifest.json
├── font-colors-main.js
├── notion-like-icons-manifest.json
├── notion-like-icons-main.js
├── notion-like-icons-data.json
└── notion-like-icons-styles.css

```

Every sub-plugin file sits right alongside the orchestrator's own files —
nothing is nested in a subfolder. This is the depth Sync reliably keeps in
step, since it's identical to how any single, ordinary plugin folder looks.

## Naming convention

For a sub-plugin with id `<id>` (e.g. `font-colors`), files sitting
alongside the orchestrator's own `main.js` are:

| File | Required? | Purpose |
| --- | --- | --- |
| `<id>-manifest.json` | Yes | Metadata: `id`, `name`, `description` (shown in the orchestrator's settings tab) |
| `<id>-main.js` | Yes | The sub-plugin's code, exporting a `Plugin` subclass |
| `<id>-data.json` | No | Persisted settings/state for that sub-plugin |
| `<id>-styles.css` | No | CSS injected into the document head while the module is enabled |

The orchestrator discovers sub-plugins by scanning its own plugin folder for
any file ending in `-manifest.json` (its own plain `manifest.json` is
excluded, since that doesn't match the suffix). Everything else is derived
from the prefix before that suffix. If a matching `<id>-main.js` isn't found
next to a manifest, that module is skipped (with a console warning) rather
than breaking discovery for the others.

## `<id>-manifest.json` fields

Only these are read by the orchestrator:

```json
{
    "id": "font-colors",
    "name": "Font Colors",
    "description": "Adds customizable font colors to text.",
    "version": "1.0.0",
    "author": "Raul Paya"
}

```

* `id` — if present, used as the module's key (falls back to the filename
prefix if omitted).
* `name` / `description` — shown as the toggle's label/description in the
orchestrator's settings tab.
* `version` / `author` — not read programmatically, but worth keeping for
your own records.

Since sub-plugins no longer run standalone, `minAppVersion` and
`isDesktopOnly` are no longer meaningful and can be omitted from new
manifests going forward (existing ones with those fields are harmless —
they're just ignored).

## `<id>-main.js` requirements

Must `module.exports` a class extending Obsidian's `Plugin` (either as the
default export, or as `.default`):

```js
const { Plugin } = require('obsidian');

module.exports = class MyModulePlugin extends Plugin {
    async onload() {
        // register events, commands, etc.
    }
    onunload() {
        // cleanup — the orchestrator's own addChild/removeChild handles
        // calling this automatically, so you don't need to call it yourself.
    }
}

```

`require('obsidian')` works as normal inside these files — the orchestrator
intercepts that resolution so it works whether Obsidian's own plugin loader
would have resolved it or not.

### Data storage (`this.loadData()` / `this.saveData()`)

You can use these exactly as in a normal Obsidian plugin:

```js
async onload() {
    this.settings = Object.assign({}, DEFAULTS, await this.loadData()); // reads <id>-data.json
    ...
}

async someHandler() {
    await this.saveData({ ... }); // writes <id>-data.json
}

```

Under the hood, the orchestrator overrides these two methods per-instance
to read/write `<id>-data.json` instead of Obsidian's default `data.json`,
since every sub-plugin now shares the orchestrator's own folder and a
literal `data.json` would collide with the orchestrator's settings (and
across modules). You don't need to do anything special to get this — it's
transparent as long as you stick to `this.loadData()` / `this.saveData()`.

### Styles (`<id>-styles.css`)

Optional. If present, its contents get injected into a `<style>` tag in
`<head>` whenever the module is enabled, and removed when disabled. No
action needed in `main.js` — just ship the CSS file with the matching
prefix.

---

## The Dynamic Configuration Interface (`getSettingTab`)

To eliminate hardcoded menu sidebars or dynamic check exceptions inside the orchestrator engine, **every single sub-plugin must include the exact same configuration hook signature.**

Instead of registering configuration layouts globally with `this.addSettingTab()`, modules utilize JavaScript scope runtime checking to dynamically expose option elements to the master UI panel.

### 1. Copy-Paste Code Contract

Every single `<id>-main.js` file must include this exact function signature without modifications:

```js
    // THE EXACT SAME IDENTICAL FUNCTION IN EVERY PLUGIN:
    getSettingTab() {
        if (typeof SubPluginSettingTab !== 'undefined') {
            return new SubPluginSettingTab(this.app, this);
        }
        return null;
    }

```

### 2. Implementation Rules

* **If the Plugin Has Settings:** Declare a class explicitly named `SubPluginSettingTab` at the bottom of the file. The function automatically registers its presence via `typeof` and returns the setup panel interface.
* **If the Plugin Does NOT Have Settings:** Omit the `SubPluginSettingTab` class altogether. The `typeof` script safely evaluates to `"undefined"`, automatically returning `null` with no runtime errors.

### 3. Nested Header Visibility Rule

When implementing `SubPluginSettingTab` options, you must ensure headers do not disrupt the master list hierarchy. Wrap configuration titles using an orchestrator class check:

```js
class SubPluginSettingTab extends PluginSettingTab {
    display() {
        const { containerEl } = this;
        containerEl.empty();

        // Avoid adding giant headers when running nested inside the Orchestrator layout
        if (!containerEl.classList.contains('orchestrator-sub-settings')) {
            containerEl.createEl('h2', { text: 'Your Module Configuration' });
        }

        // Add standard Obsidian Setting layout rules here...
    }
}

```

---

## Enabling/disabling

The orchestrator's settings tab lists every discovered module by its `name`/`description` with a toggle, backed by `enabledModules[id]` in the orchestrator's own `data.json`. Toggling calls `startModule`/`stopModule` exactly as before, dynamically mounting or unmounting the respective configuration layouts.

## Adding a new sub-plugin — checklist

1. Pick an `id` (kebab-case, e.g. `table-formatter`).
2. Write `table-formatter-manifest.json` (in the orchestrator's own plugin folder) with at least `id`, `name`, `description`.
3. Write `table-formatter-main.js` exporting a `Plugin` subclass, in the same folder.
4. Paste the unified `getSettingTab()` method block directly into the plugin class body.
5. (Optional) If configurations are necessary, append `class SubPluginSettingTab extends PluginSettingTab` to the file footer.
6. (Optional) Add `table-formatter-data.json` if you need persisted state — can start as `{}`.
7. (Optional) Add `table-formatter-styles.css`.
8. Reload the orchestrator (or restart Obsidian) — it'll show up in the settings tab automatically with inline layout support.

No subfolders, ever — everything for a given module lives flat, right next to the orchestrator's own `main.js`, under its own prefix.

## Orchestrator internals — exact contract

These are the specific behaviors your `<id>-main.js` can rely on, without needing the orchestrator's source pasted:

* **Discovery.** On load, the orchestrator scans its own plugin folder (not a subfolder) for files ending in `-manifest.json`, excluding its own literal `manifest.json`. For each match it derives `id` from the filename prefix, then looks for `<id>-main.js` in the same folder. If that's missing, the module is skipped with a console warning — discovery of other modules is unaffected.
* **Loading.** Your `<id>-main.js` is read as raw text and wrapped in a `(function(exports, require, module, __filename, __dirname) {...})` closure, then `window.eval`'d and invoked — it is **not** loaded via Node's `require`. `require('obsidian')` still works inside it: the orchestrator patches `Module._load`/`Module._resolveFilename` globally so that request resolves correctly regardless.
* **Instantiation.** Your exported class (default export, or `.default`) is instantiated as `new YourClass(app, manifestContext)`, where `manifestContext` is your parsed `<id>-manifest.json` plus a `dir` field overridden to the orchestrator's own plugin folder path (shared by every module — do not assume it's unique to you).
* **Lifecycle.** The orchestrator calls `this.addChild(instance)` — it does **not** call `onload()` directly (addChild does that). Disabling calls `this.removeChild(instance)`, which triggers `onunload()` the same way. Don't call your own `onload`/`onunload` manually.
* **Dynamic Injector Setup.** When the Master panel renders settings, it maps the sub-plugin instance context directly. If `instance.getSettingTab()` yields a layout tab object, the orchestrator overrides `settingTabInstance.containerEl` onto a nested visual element (`div.orchestrator-sub-settings`) before calling `.display()`.
* **`loadData()` / `saveData()` override.** Immediately after instantiation, the orchestrator monkey-patches `instance.loadData` and `instance.saveData` to read/write `<id>-data.json` in its own folder (JSON, pretty-printed on save) instead of Obsidian's default per-folder `data.json`. This is because every sub-plugin shares one folder with the orchestrator, so a literal `data.json` would collide. `loadData()` returns `null` if the file doesn't exist yet (not `{}`) — handle that in your own default-merging logic, e.g. `Object.assign({}, DEFAULTS, await this.loadData())`.
* **Styles.** If `<id>-styles.css` exists, its raw contents are injected verbatim into a `<style id="master-toolkit-style-<id>">` tag in `<head>` when the module is enabled, and that tag is removed on disable. This happens independently of your `onload`/`onunload` — you don't need to manage it yourself.
* **Failure handling.** If instantiation throws (bad export shape, error in `onload`, etc.), the orchestrator catches it, force-disables that module in its settings, and logs the error — it won't crash the orchestrator or block other modules from loading.

If any of the above ever changes in `main.js`, this section needs to be updated to match — it's describing exact current behavior, not a stable public API.