import { Plugin, PluginSettingTab, Setting } from 'obsidian';
import { autoModules } from './modules';

interface OrchestratorSettings {
    enabledModules: Record<string, boolean>;
    expandedSettings: Record<string, boolean>;
    modulesData: Record<string, any>;
}

const DEFAULT_SETTINGS: OrchestratorSettings = {
    enabledModules: {},
    expandedSettings: {},
    modulesData: {}
};

export default class MasterOrchestratorPlugin extends Plugin {
    declare settings: OrchestratorSettings;
    activeInstances: Record<string, any> = {};

    async onload() {
        await this.loadSettings();
        this.addSettingTab(new OrchestratorSettingTab(this.app, this));

        // Dynamically initialize all compiled modules matching saved toggle states
        Object.keys(autoModules).forEach((id) => {
            if (this.settings.enabledModules[id]) {
                this.startModule(id);
            }
        });
    }

    startModule(id: string) {
        if (this.activeInstances[id]) return;
        const moduleMeta = autoModules[id];
        if (!moduleMeta) return;

        // Instantiate component and supply runtime orchestration references
        const instance = new moduleMeta.classRef(this.app, this.manifest, this, id);
        this.addChild(instance);
        this.activeInstances[id] = instance;
    }

    stopModule(id: string) {
        const instance = this.activeInstances[id];
        if (instance) {
            this.removeChild(instance);
            delete this.activeInstances[id];
        }
    }

    async loadSettings() {
        const loadedData = await this.loadData();
        this.settings = Object.assign({}, DEFAULT_SETTINGS, loadedData);
        this.settings.enabledModules = Object.assign({}, DEFAULT_SETTINGS.enabledModules, loadedData?.enabledModules);
        this.settings.expandedSettings = Object.assign({}, DEFAULT_SETTINGS.expandedSettings, loadedData?.expandedSettings);
        this.settings.modulesData = Object.assign({}, DEFAULT_SETTINGS.modulesData, loadedData?.modulesData);

        // Ensure every discovered module has its respective fallback initialization keys
        Object.keys(autoModules).forEach((id) => {
            const moduleMeta = autoModules[id];
            this.settings.modulesData[id] = Object.assign({}, moduleMeta.defaults, this.settings.modulesData[id]);
        });
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    refreshSettingsUi() {
        const settingTab = (this.app as any).setting?.settingTabs?.find((tab: any) => tab instanceof OrchestratorSettingTab);
        if (settingTab) settingTab.display();
    }

    onunload() {
        Object.keys(this.activeInstances).forEach(id => this.stopModule(id));
    }
}

class OrchestratorSettingTab extends PluginSettingTab {
    plugin: MasterOrchestratorPlugin;
    constructor(app: any, plugin: MasterOrchestratorPlugin) { super(app, plugin); this.plugin = plugin; }

    display() {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.createEl('h2', { text: 'Plugin Sandbox Orchestrator' });

        Object.keys(autoModules).forEach(id => {
            const isModuleEnabled = this.plugin.settings.enabledModules[id] || false;

            // Generate a clean display title (e.g., "fontColors" -> "Font Colors")
            const displayTitle = id.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());

            const moduleSectionEl = containerEl.createDiv();
            moduleSectionEl.style.border = "1px solid var(--background-modifier-border)";
            moduleSectionEl.style.borderRadius = "8px";
            moduleSectionEl.style.padding = "12px";
            moduleSectionEl.style.marginBottom = "12px";
            moduleSectionEl.style.backgroundColor = "var(--background-primary-alt)";

            const mainRowSetting = new Setting(moduleSectionEl)
                .setName(displayTitle)
                .setDesc(`Workspace component feature extension module [${id}].`)
                .addToggle(toggle => toggle
                    .setValue(isModuleEnabled)
                    .onChange(async (value) => {
                        this.plugin.settings.enabledModules[id] = value;
                        await this.plugin.saveSettings();
                        if (value) {
                            this.plugin.startModule(id);
                        } else {
                            this.plugin.stopModule(id);
                            this.plugin.settings.expandedSettings[id] = false;
                        }
                        this.display();
                    }));

            mainRowSetting.settingEl.style.borderTop = "none";
            mainRowSetting.settingEl.style.padding = "0";

            const activeInstance = this.plugin.activeInstances[id];
            if (isModuleEnabled && activeInstance && typeof activeInstance.renderSettings === 'function') {
                const showSettingsActive = this.plugin.settings.expandedSettings[id] || false;
                const controlEl = mainRowSetting.settingEl.querySelector('.setting-item-control');

                if (controlEl) {
                    const textLabel = document.createElement('span');
                    textLabel.innerText = "Options";
                    textLabel.style.fontSize = "0.75em";
                    textLabel.style.color = "var(--text-muted)";
                    textLabel.style.marginRight = "6px";
                    textLabel.style.marginLeft = "12px";

                    const subToggleEl = document.createElement('input');
                    subToggleEl.type = "checkbox";
                    subToggleEl.checked = showSettingsActive;
                    subToggleEl.className = "task-list-item-checkbox";
                    subToggleEl.style.cursor = "pointer";
                    subToggleEl.style.transform = "scale(0.9)";

                    subToggleEl.addEventListener('change', async (e: any) => {
                        this.plugin.settings.expandedSettings[id] = e.target.checked;
                        await this.plugin.saveSettings();
                        this.display();
                    });

                    controlEl.insertBefore(subToggleEl, controlEl.firstChild);
                    controlEl.insertBefore(textLabel, controlEl.firstChild);
                }

                if (showSettingsActive) {
                    const subSettingsContainer = moduleSectionEl.createDiv({ cls: 'orchestrator-sub-settings' });
                    subSettingsContainer.style.fontSize = "85%";
                    subSettingsContainer.style.marginTop = "10px";
                    subSettingsContainer.style.padding = "8px 12px";
                    subSettingsContainer.style.borderTop = "1px dashed var(--background-modifier-border)";

                    try {
                        activeInstance.renderSettings(subSettingsContainer);
                    } catch (err) {
                        console.error(`UI Error [${id}]:`, err);
                    }
                }
            }
        });
    }
}