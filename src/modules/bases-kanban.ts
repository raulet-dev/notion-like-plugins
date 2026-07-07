import { Component, App, PluginManifest, TFile, BasesView } from 'obsidian';

export const ExampleViewType = 'kanban';

export interface BasesKanbanSettings {
    // Left empty per specs; configurations isolate cleanly inside the local view data
}

export const BASES_KANBAN_DEFAULTS: BasesKanbanSettings = {};

// 1. PERSISTENT REGISTRATION CONTROLLER MODULE
export class BasesKanbanModule extends Component {
    app: App;
    manifest: PluginManifest;
    pluginInstance: any;
    moduleId: string;

    constructor(app: App, manifest: PluginManifest, pluginInstance: any, moduleId: string) {
        super();
        this.app = app;
        this.manifest = manifest;
        this.pluginInstance = pluginInstance;
        this.moduleId = moduleId;
    }

    async onload() {
        this.registerBasesKanbanLayout();
    }

    private registerBasesKanbanLayout() {
        if (typeof (this.pluginInstance as any).registerBasesView !== 'function') {
            return;
        }

        (this.pluginInstance as any).registerBasesView(ExampleViewType, {
            name: 'Kanban',
            icon: 'lucide-kanban',
            factory: (controller: any, containerEl: HTMLElement) => {
                return new MyBasesKanbanView(controller, containerEl);
            },
            options: () => [
                {
                    type: 'property',
                    displayName: 'Group by property',
                    key: 'groupByProperty',
                    placeholder: 'Select target property...'
                }
            ]
        });
    }

    renderSettings(containerEl: HTMLElement) {
        containerEl.createEl("p", { 
            text: "Configuration options are managed directly inside each individual view layout panel popover configurations menu.",
            cls: "setting-item-description" 
        });
    }
}

// 2. OFFICIAL BASES VIEW LIFECYCLE TRACK RENDERER
export class MyBasesKanbanView extends BasesView {
    readonly type = ExampleViewType; 
    private controller: any;
    private containerEl: HTMLElement;

    constructor(controller: any, containerEl: HTMLElement) {
        super(controller); 
        this.controller = controller;
        this.containerEl = containerEl;
    }

    public onDataUpdated(): void {
        // HARD RESET DESTRUCTIVE WORKFLOW: Completely wipe structural styles and classes to avoid colliding with other view layouts
        this.containerEl.empty();
        this.containerEl.removeClass("bases-kanban-view-wrapper");
        this.containerEl.removeAttribute("style");

        const targetProperty = (this.config?.get('groupByProperty') as string) || "note.status";
        const entries: any[] = (this as any).data?.data || [];
        const detectedValuesSet = new Set<string>();

        // Fetch saved dictionaries natively out of the core config profiles
        const rawTitles = this.config?.get('columnTitles');
        const rawColors = this.config?.get('columnColors');

        const columnTitlesRegistry: Record<string, string> = rawTitles && typeof rawTitles === 'object' ? { ...rawTitles } : {};
        const columnColorsRegistry: Record<string, string> = rawColors && typeof rawColors === 'object' ? { ...rawColors } : {};

        entries.forEach((entry: any) => {
            if (entry && typeof entry.getValue === 'function') {
                const valueWrapper = entry.getValue(targetProperty);
                if (valueWrapper && typeof valueWrapper.toString === 'function') {
                    const stringifiedValue = valueWrapper.toString().trim();
                    if (stringifiedValue !== "") {
                        detectedValuesSet.add(stringifiedValue);
                    }
                }
            }
        });

        let columnsList = Array.from(detectedValuesSet);
        if (columnsList.includes("null")) {
            columnsList = ["null", ...columnsList.filter(v => v !== "null")];
        }

        // Apply style rules down isolated structural elements instead of mutating the base root container directly
        const columnsWrapper = this.containerEl.createDiv({ cls: "kanban-columns-container" });
        columnsWrapper.style.cssText = "display: flex; gap: 16px; overflow-x: auto; padding: 15px; align-items: flex-start; height: 100%; width: 100%; box-sizing: border-box;";

        columnsList.forEach((columnValue: string) => {
            const columnEl = columnsWrapper.createDiv({ cls: "kanban-column" });
            
            const savedTitle = columnTitlesRegistry[columnValue] || (columnValue === "null" ? "NULL / UNASSIGNED" : columnValue.toUpperCase());
            
            const rawSavedColor = columnColorsRegistry[columnValue];
            const hasCustomColor = rawSavedColor && rawSavedColor !== "automatic";
            const backgroundStyle = hasCustomColor ? `background: ${rawSavedColor};` : "";

            columnEl.style.cssText = `flex: 0 0 280px; width: 280px; ${backgroundStyle} border-radius: 8px; border: 1px solid var(--background-modifier-border); max-height: 100%; display: flex; flex-direction: column; padding: 12px; box-sizing: border-box; transition: background 0.2s ease;`;
            
            if (!hasCustomColor) {
                columnEl.style.backgroundColor = "var(--background-primary-alt)";
            }

            const headerOuterRow = columnEl.createDiv({ cls: "kanban-column-header-outer" });
            headerOuterRow.style.cssText = "min-height: 32px; display: flex; align-items: center; margin-bottom: 12px; width: 100%; position: relative;";

            const headerWrapper = headerOuterRow.createDiv({ cls: "kanban-column-header-wrapper" });
            headerWrapper.style.cssText = "display: flex; justify-content: space-between; align-items: center; cursor: pointer; width: 100%;";

            const headerEl = headerWrapper.createEl("h3", { text: savedTitle, cls: "kanban-column-header" });
            headerEl.style.cssText = "margin: 0; font-size: 0.85rem; letter-spacing: 0.5px; font-weight: 600; color: var(--text-normal); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex-grow: 1;";
            
            headerWrapper.addEventListener("contextmenu", (e: MouseEvent) => {
                e.preventDefault();
                e.stopPropagation();
                this.openHeaderEditor(headerOuterRow, headerWrapper, columnValue, columnTitlesRegistry, columnColorsRegistry, columnEl);
            });

            const cardsContainer = columnEl.createDiv({ cls: "kanban-cards-container" });
            cardsContainer.dataset.columnValue = columnValue;
            cardsContainer.style.cssText = "display: flex; flex-direction: column; gap: 8px; overflow-y: auto; flex-grow: 1; min-height: 150px; padding-bottom: 20px;";

            this.initializeDropZone(cardsContainer, targetProperty);

            entries.forEach((entry: any) => {
                const file = entry?.file;
                if (file instanceof TFile) {
                    let currentStatus = "null";
                    
                    if (entry && typeof entry.getValue === 'function') {
                        const valueWrapper = entry.getValue(targetProperty);
                        if (valueWrapper && typeof valueWrapper.toString === 'function') {
                            const stringifiedValue = valueWrapper.toString().trim();
                            if (stringifiedValue !== "") {
                                currentStatus = stringifiedValue;
                            }
                        }
                    }

                    if (currentStatus === columnValue) {
                        const cardEl = cardsContainer.createDiv({ cls: "kanban-card", text: file.basename });
                        cardEl.setAttribute("draggable", "true");
                        cardEl.style.cssText = "background: var(--background-primary); border: 1px solid var(--background-modifier-border); padding: 10px; border-radius: 6px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); font-size: 0.9rem; color: var(--text-normal); cursor: grab; user-select: none; margin-bottom: 2px;";
                        
                        cardEl.addEventListener("dblclick", async (ev: MouseEvent) => {
                            ev.preventDefault();
                            const newLeaf = this.app.workspace.getLeaf('tab');
                            await newLeaf.openFile(file);
                        });

                        cardEl.setAttribute("draggable", "true");
                        cardEl.addEventListener("dragstart", (dragEv: DragEvent) => {
                            dragEv.dataTransfer?.setData("text/plain", file.path);
                            cardEl.style.opacity = "0.4";
                        });

                        cardEl.addEventListener("dragend", () => {
                            cardEl.style.opacity = "1";
                        });
                    }
                }
            });
        });
    }

    private openHeaderEditor(
        headerOuterRow: HTMLDivElement, 
        headerWrapper: HTMLDivElement, 
        columnValue: string, 
        columnTitlesRegistry: Record<string, string>, 
        columnColorsRegistry: Record<string, string>, 
        columnEl: HTMLDivElement
    ) {
        headerWrapper.style.display = "none";
        let isResettingToAutomatic = false;

        const editorBubble = headerOuterRow.createDiv({ cls: "kanban-header-editor-bubble" });
        editorBubble.style.cssText = "display: flex; align-items: center; gap: 8px; background: var(--background-secondary); padding: 4px; border-radius: 6px; border: 1px solid var(--background-modifier-border); width: 100%; box-sizing: border-box;";

        const renameInput = editorBubble.createDiv({ cls: "kanban-editor-input-wrap" }).createEl("input", { type: "text" });
        renameInput.value = columnTitlesRegistry[columnValue] || (columnValue === "null" ? "NULL / UNASSIGNED" : columnValue.toUpperCase());
        renameInput.style.cssText = "width: 100%; padding: 4px 6px; border-radius: 4px; background: var(--background-primary); color: var(--text-normal); border: 1px solid var(--background-modifier-border); font-size: 0.85rem; height: 26px;";
        renameInput.parentElement!.style.cssText = "flex-grow: 1; min-width: 0;";
        renameInput.focus();

        const colorPicker = editorBubble.createEl("input", { type: "color" });
        let currentRawColor = columnColorsRegistry[columnValue] || "#1e1e1e";
        if (currentRawColor.startsWith("var") || currentRawColor === "automatic") currentRawColor = "#2a2a2a"; 
        colorPicker.value = currentRawColor;
        colorPicker.style.cssText = "width: 24px; height: 24px; padding: 0; border: none; border-radius: 4px; cursor: pointer; background: transparent; flex-shrink: 0;";

        colorPicker.addEventListener("input", () => {
            isResettingToAutomatic = false;
            columnEl.style.backgroundColor = colorPicker.value;
        });

        const resetBtn = editorBubble.createEl("button", { text: "↺", title: "Reset to automatic color" });
        resetBtn.style.cssText = "padding: 0; width: 24px; height: 24px; background: transparent; border: 1px solid var(--background-modifier-border); color: var(--text-muted); border-radius: 4px; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 1.1rem; flex-shrink: 0; transition: color 0.15s ease;";
        
        resetBtn.addEventListener("mouseenter", () => resetBtn.style.color = "var(--text-accent)");
        resetBtn.addEventListener("mouseleave", () => resetBtn.style.color = "var(--text-muted)");
        
        resetBtn.addEventListener("click", async (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            isResettingToAutomatic = true;
            columnEl.style.backgroundColor = "var(--background-primary-alt)";
            
            const updatedColors = { ...columnColorsRegistry };
            updatedColors[columnValue] = "automatic";
            
            const updatedTitles = { ...columnTitlesRegistry };
            const finalTitle = renameInput.value.trim();
            if (finalTitle !== "") {
                updatedTitles[columnValue] = finalTitle;
            }

            this.config?.set('columnTitles', updatedTitles);
            this.config?.set('columnColors', updatedColors);

            if (this.controller && typeof this.controller.save === 'function') {
                await this.controller.save();
            }

            editorBubble.remove();
            headerWrapper.style.display = "flex";
            this.onDataUpdated();
        });

        const saveChanges = async () => {
            if (isResettingToAutomatic) return;

            const finalTitle = renameInput.value.trim();
            const updatedTitles = { ...columnTitlesRegistry };
            if (finalTitle !== "") {
                updatedTitles[columnValue] = finalTitle;
            }
            
            const updatedColors = { ...columnColorsRegistry };
            if (columnColorsRegistry[columnValue] === "automatic") {
                updatedColors[columnValue] = "automatic";
            } else {
                updatedColors[columnValue] = colorPicker.value;
            }

            this.config?.set('columnTitles', updatedTitles);
            this.config?.set('columnColors', updatedColors);

            if (this.controller && typeof this.controller.save === 'function') {
                await this.controller.save();
            }

            editorBubble.remove();
            headerWrapper.style.display = "flex";
            this.onDataUpdated();
        };

        renameInput.addEventListener("keydown", (e: KeyboardEvent) => {
            if (e.key === "Enter") saveChanges();
            if (e.key === "Escape") {
                editorBubble.remove();
                headerWrapper.style.display = "flex";
                this.onDataUpdated();
            }
        });

        colorPicker.addEventListener("change", saveChanges);
        
        setTimeout(() => {
            const closeListener = (ev: MouseEvent) => {
                if (!editorBubble.contains(ev.target as Node)) {
                    saveChanges();
                    document.removeEventListener("mousedown", closeListener);
                }
            };
            document.addEventListener("mousedown", closeListener);
        }, 50);
    }

    private initializeDropZone(container: HTMLElement, targetProperty: string) {
        container.addEventListener("dragover", (e: DragEvent) => {
            e.preventDefault();
        });

        container.addEventListener("drop", async (e: DragEvent) => {
            e.preventDefault();

            const filePath = e.dataTransfer?.getData("text/plain");
            const destinationValue = container.dataset.columnValue;

            if (!filePath || !destinationValue) return;

            const cleanFrontmatterKey = targetProperty.replace(/^note\./, '');
            const file = this.app.vault.getAbstractFileByPath(filePath);
            
            if (file instanceof TFile) {
                await this.app.fileManager.processFrontMatter(file, (frontmatter: any) => {
                    if (destinationValue === "null" || destinationValue === "Unassigned") {
                        delete frontmatter[cleanFrontmatterKey];
                    } else {
                        frontmatter[cleanFrontmatterKey] = destinationValue;
                    }
                });
                
                if (this.controller && typeof this.controller.refresh === 'function') {
                    this.controller.refresh();
                }
            }
        });
    }
}