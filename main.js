const { Plugin, PluginSettingTab, Setting } = require('obsidian');
const fs = require('fs');
const path = require('path');
const Module = require('module');

const DEFAULT_SETTINGS = { enabledModules: {} };
const MANIFEST_SUFFIX = '-manifest.json';

module.exports = class MasterOrchestratorPlugin extends Plugin {
    async onload() {
        await this.loadSettings();
        this.addSettingTab(new OrchestratorSettingTab(this.app, this));

        this.activeInstances = {};
        this.discoveredPlugins = {};

        this.setupModuleInterceptor();

        const adapter = this.app.vault.adapter;
        const vaultPath = adapter.getBasePath();
        this.poolDir = path.join(vaultPath, this.manifest.dir);

        this.discoverModules();
    }

    setupModuleInterceptor() {
        const originalResolveFilename = Module._resolveFilename;
        Module._resolveFilename = function (request, parent, isMain, options) {
            if (request === 'obsidian') {
                return __filename;
            }
            return originalResolveFilename.apply(this, arguments);
        };

        const originalLoad = Module._load;
        Module._load = function (request, parent, isMain) {
            if (request === 'obsidian' || request === __filename) {
                return require('obsidian');
            }
            return originalLoad.apply(this, arguments);
        };
    }

    discoverModules() {
        if (!fs.existsSync(this.poolDir)) {
            console.error(`[Master Orchestrator] Plugin folder not found: ${this.poolDir}`);
            return;
        }

        const files = fs.readdirSync(this.poolDir);
        const manifestFiles = files.filter(f => f.endsWith(MANIFEST_SUFFIX) && f !== 'manifest.json');

        manifestFiles.forEach(manifestFile => {
            const id = manifestFile.slice(0, -MANIFEST_SUFFIX.length);
            const manifestPath = path.join(this.poolDir, manifestFile);
            const scriptPath = path.join(this.poolDir, `${id}-main.js`);
            const dataPath = path.join(this.poolDir, `${id}-data.json`);
            const cssPath = path.join(this.poolDir, `${id}-styles.css`);

            if (!fs.existsSync(scriptPath)) {
                console.warn(`[Master Orchestrator] Skipping "${id}": no matching ${id}-main.js found.`);
                return;
            }

            try {
                const manifestRaw = fs.readFileSync(manifestPath, 'utf8');
                const subManifest = JSON.parse(manifestRaw);
                const moduleId = subManifest.id || id;

                this.discoveredPlugins[moduleId] = {
                    name: subManifest.name || moduleId,
                    desc: subManifest.description || "No description provided.",
                    scriptPath,
                    dataPath,
                    cssPath,
                    dirPath: this.poolDir,
                    manifest: subManifest
                };

                if (this.settings.enabledModules[moduleId]) {
                    this.loadSubPluginStyles(moduleId);
                    this.startModule(moduleId);
                }
            } catch (e) {
                console.error(`Orchestrator failed to index module [${id}]:`, e);
            }
        });
    }

    async startModule(id) {
        if (this.activeInstances[id]) return;
        try {
            const targetData = this.discoveredPlugins[id];
            if (!targetData) return;

            const rawCode = fs.readFileSync(targetData.scriptPath, 'utf8');
            const wrapperCode = `(function(exports, require, module, __filename, __dirname) { ${rawCode} \n});`;
            const compiledFunction = window.eval(wrapperCode);
            const customModule = { exports: {} };

            compiledFunction(customModule.exports, require, customModule, targetData.scriptPath, targetData.dirPath);

            let StandalonePluginClass = null;
            if (typeof customModule.exports === 'function') {
                StandalonePluginClass = customModule.exports;
            } else if (customModule.exports && typeof customModule.exports.default === 'function') {
                StandalonePluginClass = customModule.exports.default;
            }

            if (!StandalonePluginClass) {
                throw new Error("No valid executable Plugin class found in module exports.");
            }

            const subManifestContext = Object.assign({}, targetData.manifest, {
                dir: this.poolDir
            });

            const instance = new StandalonePluginClass(this.app, subManifestContext);
            instance.app = this.app;
            instance.manifest = subManifestContext;

            const dataPath = targetData.dataPath;
            instance.loadData = async () => {
                if (!fs.existsSync(dataPath)) return null;
                try {
                    return JSON.parse(fs.readFileSync(dataPath, 'utf8'));
                } catch (e) {
                    console.error(`[Master Orchestrator] Failed to read data for [${id}]:`, e);
                    return null;
                }
            };
            instance.saveData = async (data) => {
                try {
                    fs.writeFileSync(dataPath, JSON.stringify(data, null, 2));
                } catch (e) {
                    console.error(`[Master Orchestrator] Failed to save data for [${id}]:`, e);
                }
            };

            this.addChild(instance);
            this.activeInstances[id] = instance;
            console.log(`[Master Orchestrator] Successfully executed module: ${id}`);
        } catch (e) {
            console.error(`Runtime boot failure for sub-plugin [${id}]:`, e);
            this.settings.enabledModules[id] = false;
            this.saveSettings();
        }
    }

    stopModule(id) {
        const instance = this.activeInstances[id];
        if (instance) {
            try {
                this.removeChild(instance);
            } catch (e) {
                console.error(`Graceful unload failed for [${id}]:`, e);
            }
            delete this.activeInstances[id];
            console.log(`[Master Orchestrator] Successfully stopped module: ${id}`);
        }
    }

    loadSubPluginStyles(id) {
        const targetData = this.discoveredPlugins[id];
        if (!targetData) return;
        const cssPath = targetData.cssPath;

        if (fs.existsSync(cssPath)) {
            try {
                const cssContent = fs.readFileSync(cssPath, 'utf8');
                let styleEl = document.getElementById(`master-toolkit-style-${id}`);
                if (!styleEl) {
                    styleEl = document.createElement('style');
                    styleEl.id = `master-toolkit-style-${id}`;
                    document.head.appendChild(styleEl);
                }
                styleEl.textContent = cssContent;
            } catch (e) {
                console.error(`Failed to inject styles for [${id}]:`, e);
            }
        }
    }

    unloadSubPluginStyles(id) {
        const styleEl = document.getElementById(`master-toolkit-style-${id}`);
        if (styleEl) styleEl.remove();
    }

    async loadSettings() { this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData()); }
    async saveSettings() { await this.saveData(this.settings); }

    onunload() {
        Object.keys(this.activeInstances).forEach(id => this.stopModule(id));
        Object.keys(this.discoveredPlugins).forEach(id => this.unloadSubPluginStyles(id));
    }
}

class OrchestratorSettingTab extends PluginSettingTab {
    constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
    
    display() {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.createEl('h2', { text: 'Plugin Sandbox Orchestrator' });

        const discoveredKeys = Object.keys(this.plugin.discoveredPlugins);
        if (discoveredKeys.length === 0) {
            containerEl.createEl('i', { text: 'No standalone plugin folders discovered yet.' });
            return;
        }

        discoveredKeys.forEach(id => {
            const config = this.plugin.discoveredPlugins[id];
            
            // 1. Create a layout container block for each module section
            const moduleSectionEl = containerEl.createDiv({ cls: `orchestrator-module-${id}` });
            moduleSectionEl.style.borderBottom = "1px solid var(--background-modifier-border)";
            moduleSectionEl.style.paddingBottom = "12px";
            moduleSectionEl.style.marginBottom = "12px";

            // 2. Render the Enable/Disable master toggle switch
            new Setting(moduleSectionEl)
                .setName(config.name)
                .setDesc(config.desc)
                .addToggle(toggle => toggle
                    .setValue(this.plugin.settings.enabledModules[id] || false)
                    .onChange(async (value) => {
                        this.plugin.settings.enabledModules[id] = value;
                        await this.plugin.saveSettings();
                        if (value) {
                            this.plugin.loadSubPluginStyles(id);
                            await this.plugin.startModule(id);
                        } else {
                            this.plugin.stopModule(id);
                            this.plugin.unloadSubPluginStyles(id);
                            this.app.workspace.trigger('css-change');
                        }
                        this.display(); // Redraw view dynamically to mount/unmount sub-settings
                    }));

            // 3. THE UNIFIED HOOK PASTE LOCATION: Dynamic settings nested injection
            const activeInstance = this.plugin.activeInstances[id];
            if (this.plugin.settings.enabledModules[id] && activeInstance) {
                if (typeof activeInstance.getSettingTab === 'function') {
                    const settingTabInstance = activeInstance.getSettingTab();
                    
                    if (settingTabInstance) {
                        const subSettingsContainer = moduleSectionEl.createDiv({ cls: 'orchestrator-sub-settings' });
                        subSettingsContainer.style.marginLeft = "24px";
                        subSettingsContainer.style.paddingLeft = "12px";
                        subSettingsContainer.style.borderLeft = "2px solid var(--interactive-accent)";

                        settingTabInstance.containerEl = subSettingsContainer;
                        
                        try {
                            settingTabInstance.display();
                        } catch (err) {
                            console.error(`Failed to execute UI render for module [${id}]:`, err);
                        }
                    }
                }
            }
        });
    }
}