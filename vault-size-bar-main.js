const { Plugin, PluginSettingTab, Setting, TFolder, TFile } = require('obsidian');

const DEFAULTS = {
    fontSize: 9.5
};

module.exports = class VaultSizeBarPlugin extends Plugin {
    async onload() {
        this.statusBarEl = null;
        this.lastClickedPath = null;
        
        this.settings = Object.assign({}, DEFAULTS, await this.loadData());
        
        this.app.workspace.onLayoutReady(() => {
            this.createSizeBar();
            this.registerSizeEvents();
        });

        // REMOVE OR BYPASS NATIVE MOUNT RULE TO COMPLY WITH STRATEGY CONTRACT
    }

    // THE EXACT SAME IDENTICAL FUNCTION IN EVERY PLUGIN:
    getSettingTab() {
        if (typeof SubPluginSettingTab !== 'undefined') {
            return new SubPluginSettingTab(this.app, this);
        }
        return null;
    }

    onunload() {
        if (this.statusBarEl) {
            this.statusBarEl.remove();
        }
        const explorerLeaf = this.app.workspace.getLeavesOfType("file-explorer")[0];
        if (explorerLeaf?.view?.containerEl) {
            const filesContainer = explorerLeaf.view.containerEl.querySelector('.nav-files-container');
            if (filesContainer) filesContainer.style.paddingBottom = '';
        }
    }

    createSizeBar() {
        const fileExplorerView = this.app.workspace.getLeavesOfType("file-explorer")[0]?.view;
        if (!fileExplorerView) return;

        const container = fileExplorerView.containerEl;
        if (!container) return;

        if (container.querySelector('.obsidian-vault-size-bar')) return;

        container.style.position = 'relative';
        container.style.display = 'flex';
        container.style.flexDirection = 'column';

        this.statusBarEl = document.createElement('div');
        this.statusBarEl.addClass('obsidian-vault-size-bar');
        
        this.leftSlot = document.createElement('span');
        this.leftSlot.addClass('size-bar-left');
        
        this.rightSlot = document.createElement('span');
        this.rightSlot.addClass('size-bar-right');

        this.applyFontStyles();

        this.statusBarEl.appendChild(this.leftSlot);
        this.statusBarEl.appendChild(this.rightSlot);

        container.appendChild(this.statusBarEl);

        const filesContainer = container.querySelector('.nav-files-container');
        if (filesContainer) {
            filesContainer.style.paddingBottom = '30px';
        }

        this.updateBar();
    }

    applyFontStyles() {
        if (!this.leftSlot || !this.rightSlot) return;
        
        const size = this.settings.fontSize;
        const inlineFontStyles = `font-size: ${size}px !important; font-family: var(--font-interface) !important; color: var(--text-muted) !important; display: inline-block !important;`;
        
        this.leftSlot.style.cssText = inlineFontStyles + " float: left !important; text-align: left !important; max-width: 46%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;";
        this.rightSlot.style.cssText = inlineFontStyles + " float: right !important; text-align: right !important; max-width: 46%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;";
    }

    registerSizeEvents() {
        this.registerEvent(this.app.vault.on('modify', () => this.updateBar()));
        this.registerEvent(this.app.vault.on('create', () => this.updateBar()));
        this.registerEvent(this.app.vault.on('delete', () => this.updateBar()));

        this.registerDomEvent(document, 'click', (evt) => {
            const target = evt.target;
            const navItem = target.closest('.nav-file-title, .nav-folder-title');
            
            if (navItem) {
                const fileExplorer = this.app.workspace.getLeavesOfType("file-explorer")[0]?.view;
                if (!fileExplorer || !fileExplorer.fileItems) return;

                for (const [path, item] of Object.entries(fileExplorer.fileItems)) {
                    if (item.titleEl === navItem || item.el === navItem.parentElement) {
                        this.lastClickedPath = path;
                        this.updateBar();
                        break;
                    }
                }
            }
        });

        this.registerEvent(this.app.workspace.on('active-leaf-change', () => {
            const activeFile = this.app.workspace.getActiveFile();
            if (activeFile) {
                this.lastClickedPath = activeFile.path;
                this.updateBar();
            }
        }));
    }

    async updateBar() {
        if (!this.statusBarEl) return;

        let selectedSizeText = "Selected: 0 B";
        if (this.lastClickedPath) {
            const targetItem = this.app.vault.getAbstractFileByPath(this.lastClickedPath);
            if (targetItem) {
                const sizeBytes = this.calculateItemSize(targetItem);
                selectedSizeText = `Selected: ${this.formatBytes(sizeBytes)}`;
            }
        } else {
            const activeFile = this.app.workspace.getActiveFile();
            if (activeFile) {
                const sizeBytes = this.calculateItemSize(activeFile);
                selectedSizeText = `Selected: ${this.formatBytes(sizeBytes)}`;
            }
        }
        this.leftSlot.innerHTML = `&nbsp;${selectedSizeText}`;

        const totalBytes = await this.calculateVaultTotalSize();
        let rightText = `Total: ${this.formatBytes(totalBytes)}`;

        const syncPlugin = this.app.internalPlugins?.plugins?.['sync'];
        if (syncPlugin && syncPlugin.enabled) {
            const syncInstance = syncPlugin.instance;
            let limitBytes = null;

            if (syncInstance?.api?.limit) limitBytes = syncInstance.api.limit;
            
            const userPlan = syncInstance?.api?.user?.plan;
            if (userPlan) {
                if (userPlan.toLowerCase().includes('standard') || userPlan.toLowerCase().includes('basic')) {
                    limitBytes = 1 * 1024 * 1024 * 1024; 
                } else if (userPlan.toLowerCase().includes('plus')) {
                    limitBytes = 10 * 1024 * 1024 * 1024; 
                } else if (userPlan.toLowerCase().includes('pro')) {
                    limitBytes = 50 * 1024 * 1024 * 1024; 
                }
            }

            if (!limitBytes) {
                if (syncInstance?.api?.getLimit) {
                    limitBytes = typeof syncInstance.api.getLimit === 'function' ? await syncInstance.api.getLimit() : syncInstance.api.getLimit;
                } else if (syncInstance?.config?.maxVaultSize) {
                    limitBytes = syncInstance.config.maxVaultSize;
                }
            }

            if (!limitBytes) {
                limitBytes = 1 * 1024 * 1024 * 1024; 
            }

            rightText += ` / ${this.formatBytes(limitBytes)}`;
        }

        this.rightSlot.innerHTML = `${rightText}&nbsp;`;
    }

    calculateItemSize(item) {
        if (item instanceof TFile) {
            return item.stat.size;
        } else if (item instanceof TFolder) {
            let total = 0;
            this.getFolderSizeRecursively(item, (file) => {
                total += file.stat.size;
            });
            return total;
        }
        return 0;
    }

    getFolderSizeRecursively(folder, callback) {
        if (!folder.children) return;
        for (const child of folder.children) {
            if (child instanceof TFile) {
                callback(child);
            } else if (child instanceof TFolder) {
                this.getFolderSizeRecursively(child, callback);
            }
        }
    }

    async calculateVaultTotalSize() {
        let total = 0;
        const files = this.app.vault.getFiles();
        for (const file of files) {
            total += file.stat.size;
        }
        return total;
    }

    formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
};

// Class name standardized to comply with orchestrator scanning rules
class SubPluginSettingTab extends PluginSettingTab {
    constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display() {
        const { containerEl } = this;
        containerEl.empty();

        // Nesting title check
        if (!containerEl.classList.contains('orchestrator-sub-settings')) {
            containerEl.createEl('h2', { text: 'Vault Size Bar Configuration' });
        }
        
        new Setting(containerEl)
            .setName('Font Size (px)')
            .setDesc('Adjust the size of the text displayed inside the size bar layer at the bottom of the navigation explorer.')
            .addSlider((slider) => {
                slider
                    .setLimits(7, 16, 0.5)
                    .setValue(this.plugin.settings.fontSize)
                    .setDynamicTooltip();
                
                slider.sliderEl.addEventListener('input', async (e) => {
                    const value = parseFloat(e.target.value);
                    this.plugin.settings.fontSize = value;
                    this.plugin.applyFontStyles();
                });

                slider.onChange(async (value) => {
                    this.plugin.settings.fontSize = value;
                    await this.plugin.saveData(this.plugin.settings);
                    this.plugin.applyFontStyles();
                });
            });
    }
}