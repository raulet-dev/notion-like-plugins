# Notion-Style Plugins Sandbox Suite (Master Orchestrator)

A high-performance, cross-platform sandbox workspace wrapper suite built for Obsidian Desktop and Mobile (iOS / Android). This orchestrator enables a flat distribution format, running multiple modular micro-plugins out of a single root folder depth underneath `.obsidian/plugins/` to maintain seamless syncing performance.

---

## Shared Platform Architecture

Every active sub-plugin is built onto a **unified interface and storage ecosystem** managed natively by the master runtime loop:

* **Mobile Runtime Sandbox:** Completely stripped of desktop-bound Node.js dependencies (`fs`, `path`, `module`), instead using asynchronous, non-blocking calls directly hooked to Obsidian's native abstraction engine (`this.app.vault.adapter`).
* **Micro Options Scale:** All sub-plugin settings are wrapped in a 70% font scale footprint. The settings are dynamically injected right next to the enable/disable button via an inline "Options" checkbox to prevent vertical cluttering.
* **Isolated Data Isolation:** Sub-plugins use regular `this.loadData()` and `this.saveData()` functions. The master engine automatically intercepts these calls, routing configuration settings to separate `<plugin-id>-data.json` files to prevent profile collisions.

---

## Active Sandbox Modules

### 1. Font Colors Menu (`font-colors`)

Brings high-fidelity, inline text emphasis and background block highlight layouts into the core note canvas experience.

* **Context Selection Engine:** Injects interactive color customization menus into active right-click / selection popups.
* **Clean Syntax Processing:** Renders options via strict HTML inline code constraints (`<span style="color: ...">`), keeping text perfectly clean and fully readable across external, generic markdown environments.
* **Dynamic Palette Manager:** Customize both text hex colors and background block combo pairs with automated interactive color pickers directly inside the inline sub-settings drawer.

### 2. Notion-Style Icons (`notion-like-icons`)

Implements flexible workspace visuals across file items, foldered collections, and embedded document lines.

* **Multi-Format Asset Importer:** Import styling targets via local drag-and-drop actions, bulk `.zip` asset packages, or directly query online target links (`https://...`).
* **Automated Parser Snippets:** Dynamically reads shortcode definitions (`:doraemon:`) inside content pages, mapping image objects inline on the fly.
* **Title & Sidebar Mapping:** Embeds active artwork tags directly above page titles and inside the file navigation dashboard.

### 3. Cryptomator Keep-Alive (`cryptomator-keepalive`)

Prevents remote encrypted hard drives from automatically locking due to inactivity while the app window stays active.

* **Clock Pulse Touch:** Runs a mobile-safe background timer interval to touch a localized heartbeat reference block.
* **Validation Tuning:** Custom adjustments for checking frequency (seconds) or opting for explicit write-then-delete file cycle logic.

### 4. Vault Size & Sync Metric Bar (`vault-size-bar`)

Places detailed, compact disk storage allocations directly into the viewport layout at the base of the navigation panel.

* **Live Update Listeners:** Re-calculates active storage footages immediately upon note adjustments, new creations, or content deletions.
* **Obsidian Sync Bridge:** Evaluates structural data allowances by comparing active directory sizes against plan tiers (Basic, Plus, Pro) to track cloud storage limits.

### 5. Bases Kanban View Layout (`bases-kanban`)

Brings persistent Agile board columns natively into your structural `.base` layout files.

* **Metadata-Driven Board Columns:** Scans note frontmatter data properties dynamically to render clean, side-by-side database view lanes.
* **Interactive Drag-and-Drop Matrix:** Drag card nodes across lanes to rewrite or strip physical frontmatter properties in your markdown documents on the fly.
* **Persistent Header Settings Panel:** Right-click column headers to rename columns or select customized background colors locally. Use the built-in reset loop to revert a lane back to `"automatic"` inheritance.

### 6. Dynamic Query Graphs Engine (`bases-graph`)

Generates clean, responsive, theme-adaptive native SVG vector charts directly inside any standard note body using code blocks.

* **Relative Data Resolution Framework:** Completely eliminates strict folder prefix rules. Provide a relative path to any local `.base` template profile to scrape file data metrics from its directory scope.
* **Dynamic Schema Mapper:** Maps human-readable display aliases directly back to the physical metadata property keys tracked behind your files.
* **Two-Variable Relational Aggregations:** Switch between standard frequency counters or relational `x` and `y` pairings to sum or cross-evaluate data values.
* **Modular Code Block Configurations:** Injects visualizations using simple declarative syntax blocks:

```yaml
```graph
type: "donut"
path: "Finances/Rent.base"
x: "Person"
y: "Rent"
grouped: "xy"```
```

#### Supported Graph Typologies:
* `type: "donut"` — Renders circular metric charts complete with percentage tracking and a centered total counter.
* `type: "vertical-bar"` — Renders vertical column histograms coupled with numeric node layout badges.
* `type: "horizontal-bar"` — Renders sleek horizontal bar rows, ideal for long category labels.
* `type: "line"` — Renders point-to-point data trends tracked across continuous categories.

#### Grouping Logic Parameters:
* `grouped: "no"` — Disables aggregation, treating every matching document as a separate visual record item.
* `grouped: "x"` or `"y"` — Forces data structures to consolidate metrics purely along a single target property layer.
* `grouped: "xy"` — Default behavior; aggregates values along your $X$ and $Y$ properties independently without cross-combining data arrays.

---

## Installation & Deployment

To drop a new module into this ecosystem, simply place the flat, prefix-matched files (`<id>-main.js` and `<id>-manifest.json`) right alongside the orchestrator's files. The runtime framework will dynamically detect the module and inject its toggle card upon the next layout initialization.