import { Component, App, PluginManifest, TFile, BasesView } from 'obsidian';

export const ExampleViewType = 'kanban';

export interface BasesKanbanSettings {
    // Left empty per specs; view properties isolate automatically inside the local view data
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
        this.containerEl.empty();
        this.containerEl.addClass("bases-kanban-view-wrapper");

        // Grabs property ID key (returns as "note.status" or "note.Occupied by")
        const targetProperty = (this.config?.get('groupByProperty') as string) || "note.status";

        // Reads structural array directly out of the native results data block
        const entries: any[] = (this as any).data?.data || [];
        const detectedValuesSet = new Set<string>();

        // Native discovery mechanism scanning all live query value instances
        entries.forEach((entry: any) => {
            if (entry && typeof entry.getValue === 'function') {
                const valueWrapper = entry.getValue(targetProperty);
                if (valueWrapper && typeof valueWrapper.toString === 'function') {
                    const stringifiedValue = valueWrapper.toString().trim();
                    // Keep the native "null" column identifier string, skip true empty text anomalies
                    if (stringifiedValue !== "") {
                        detectedValuesSet.add(stringifiedValue);
                    }
                }
            }
        });

        // FIXED STEP 1: Removed manual Unassigned column sorting injection so only native columns (including "null") render
        let columnsList = Array.from(detectedValuesSet);
        
        // Push "null" to the first position for better column tracking if it exists
        if (columnsList.includes("null")) {
            columnsList = ["null", ...columnsList.filter(v => v !== "null")];
        }

        const columnsWrapper = this.containerEl.createDiv({ cls: "kanban-columns-container" });
        columnsWrapper.style.cssText = "display: flex; gap: 16px; overflow-x: auto; padding: 15px; align-items: flex-start; height: 100%; width: 100%; box-sizing: border-box;";

        columnsList.forEach((columnValue: string) => {
            const columnEl = columnsWrapper.createDiv({ cls: "kanban-column" });
            columnEl.style.cssText = "flex: 0 0 280px; width: 280px; background: var(--background-primary-alt); border-radius: 8px; border: 1px solid var(--background-modifier-border); max-height: 100%; display: flex; flex-direction: column; padding: 12px; box-sizing: border-box;";
            
            // Format column display title ("null" displays cleanly as "NULL / UNASSIGNED")
            const displayTitle = columnValue === "null" ? "NULL / UNASSIGNED" : columnValue.toUpperCase();
            const headerEl = columnEl.createEl("h3", { text: displayTitle, cls: "kanban-column-header" });
            headerEl.style.cssText = "margin: 0 0 12px 0; font-size: 0.85rem; letter-spacing: 0.5px; font-weight: 600; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;";
            
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
                        
                        // FIXED STEP 3: Double-click event listener to open the note inside a clean new workspace tab
                        cardEl.addEventListener("dblclick", async (e: MouseEvent) => {
                            e.preventDefault();
                            const newLeaf = this.app.workspace.getLeaf('tab');
                            await newLeaf.openFile(file);
                        });

                        cardEl.addEventListener("dragstart", (e: DragEvent) => {
                            e.dataTransfer?.setData("text/plain", file.path);
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

    private initializeDropZone(container: HTMLElement, targetProperty: string) {
        container.addEventListener("dragover", (e: DragEvent) => {
            e.preventDefault();
            container.style.background = "var(--background-modifier-hover)";
        });

        container.style.transition = "background 0.15s ease";

        container.addEventListener("dragleave", () => {
            container.style.background = "transparent";
        });

        container.addEventListener("drop", async (e: DragEvent) => {
            e.preventDefault();
            container.style.background = "transparent";

            const filePath = e.dataTransfer?.getData("text/plain");
            const destinationValue = container.dataset.columnValue;

            if (!filePath || !destinationValue) return;

            // Strip the core data category prefix (e.g., "note.Occupied by" -> "Occupied by")
            const cleanFrontmatterKey = targetProperty.replace(/^note\./, '');

            const file = this.app.vault.getAbstractFileByPath(filePath);
            if (file instanceof TFile) {
                await this.app.fileManager.processFrontMatter(file, (frontmatter: any) => {
                    // FIXED STEP 2: Forcefully delete the frontmatter property key if dragged into the null section
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