import { Component, App, PluginManifest, TFile, BasesView, Keymap } from 'obsidian';

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
    
    activeViews: MyBasesKanbanView[] = [];

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

    public removeView(view: MyBasesKanbanView) {
        this.activeViews = this.activeViews.filter(v => v !== view);
    }

    private registerBasesKanbanLayout() {
        if (typeof (this.pluginInstance as any).registerBasesView !== 'function') {
            return;
        }

        (this.pluginInstance as any).registerBasesView(ExampleViewType, {
            name: 'Kanban',
            icon: 'lucide-kanban',
            factory: (controller: any, containerEl: HTMLElement) => {
                const view = new MyBasesKanbanView(controller, containerEl, this);
                this.activeViews.push(view);
                return view;
            },
            options: (config: any) => {
                const currentProp = config.get('groupByProperty') || "note.status";
                const view = this.activeViews.find(v => v.config === config);
                
                // Get all properties currently available in the dataset
                const allProps = view?.allProperties || [];
                const propsToRender = new Set(allProps);
                propsToRender.add(currentProp); // Ensure the active prop is always included

                const optionsList: any[] = [
                    {
                        type: 'property',
                        displayName: 'Group by property',
                        key: 'groupByProperty',
                        placeholder: 'Select target property...',
                        filter: (prop: string) => {
                            if (view && view.allProperties && view.allProperties.length > 0) {
                                return view.allProperties.includes(prop as any);
                            }
                            return true;
                        }
                    }
                ];

                // Dynamically generate a hidden multitext for every property
                propsToRender.forEach(prop => {
                    optionsList.push({
                        type: 'multitext',
                        displayName: 'Kanban Columns',
                        key: `columnOrder_${prop}`,
                        default: [],
                        shouldHide: () => {
                            // Reactively hide this component if it doesn't match the dropdown
                            const activeProp = config.get('groupByProperty') || "note.status";
                            return activeProp !== prop;
                        }
                    });
                });

                return optionsList;
            }
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
    private moduleInstance: BasesKanbanModule;

    constructor(controller: any, containerEl: HTMLElement, moduleInstance: BasesKanbanModule) {
        super(controller); 
        this.controller = controller;
        this.containerEl = containerEl;
        this.moduleInstance = moduleInstance;
    }

    public onunload(): void {
        this.moduleInstance.removeView(this);
        super.onunload();
    }

    public onDataUpdated(): void {
        this.containerEl.empty();
        this.containerEl.removeClass("bases-kanban-view-wrapper");
        this.containerEl.removeAttribute("style");

        const targetProperty = (this.config?.get('groupByProperty') as string) || "note.status";
        const orderKey = `columnOrder_${targetProperty}`;
        
        const entries: any[] = this.data?.data || [];
        const detectedValuesSet = new Set<string>();

        const rawTitles = this.config?.get('columnTitles');
        const rawColors = this.config?.get('columnColors');

        const columnTitlesRegistry: Record<string, string> = rawTitles && typeof rawTitles === 'object' ? { ...rawTitles } : {};
        const columnColorsRegistry: Record<string, string> = rawColors && typeof rawColors === 'object' ? { ...rawColors } : {};

        const visibleProperties = this.config?.getOrder() || [];

        // 1. Initial scan: Find all statuses present inside the vault files
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

        // 2. Pull the uniquely scoped array list
        let savedOrder = this.config?.get(orderKey) as string[] | undefined;
        
        // 3. Auto-seed if the property hasn't been configured yet
        if (!savedOrder || savedOrder.length === 0) {
            savedOrder = Array.from(detectedValuesSet);
            if (savedOrder.includes("null")) {
                savedOrder = ["null", ...savedOrder.filter(v => v !== "null")];
            } else {
                savedOrder.unshift("null");
            }
            
            this.config?.set(orderKey, savedOrder);
            if (this.controller && typeof this.controller.save === 'function') {
                this.controller.save(); 
            }
        } else {
            if (!savedOrder.includes("null")) {
                savedOrder.unshift("null");
            }
        }

        const columnsList = [...savedOrder];

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

            columnEl.addEventListener("dragover", (e: DragEvent) => {
                if (e.dataTransfer?.types.includes("application/x-kanban-column")) {
                    e.preventDefault();
                    e.stopPropagation();
                    e.dataTransfer.dropEffect = "move";
                }
            });

            columnEl.addEventListener("drop", async (e: DragEvent) => {
                if (!e.dataTransfer?.types.includes("application/x-kanban-column")) return;
                
                e.preventDefault();
                e.stopPropagation();

                const draggedCol = e.dataTransfer.getData("application/x-kanban-column");
                if (!draggedCol || draggedCol === columnValue) return;

                const currentOrder = columnsList.slice();
                const draggedIdx = currentOrder.indexOf(draggedCol);
                const targetIdx = currentOrder.indexOf(columnValue);

                if (draggedIdx > -1 && targetIdx > -1) {
                    currentOrder.splice(draggedIdx, 1);
                    currentOrder.splice(targetIdx, 0, draggedCol);
                    
                    this.config?.set(orderKey, currentOrder); 
                    if (this.controller && typeof this.controller.save === 'function') {
                        await this.controller.save();
                    }
                    this.onDataUpdated();
                }
            });

            const headerOuterRow = columnEl.createDiv({ cls: "kanban-column-header-outer" });
            headerOuterRow.style.cssText = "min-height: 32px; display: flex; align-items: center; margin-bottom: 12px; width: 100%; position: relative;";
            
            headerOuterRow.setAttribute("draggable", "true");
            headerOuterRow.addEventListener("dragstart", (e: DragEvent) => {
                e.dataTransfer?.setData("application/x-kanban-column", columnValue);
                setTimeout(() => { columnEl.style.opacity = "0.5"; }, 0);
                e.stopPropagation();
            });
            headerOuterRow.addEventListener("dragend", (e: DragEvent) => {
                columnEl.style.opacity = "1";
                e.stopPropagation();
            });

            const headerWrapper = headerOuterRow.createDiv({ cls: "kanban-column-header-wrapper" });
            headerWrapper.style.cssText = "display: flex; justify-content: space-between; align-items: center; cursor: grab; width: 100%;";
            headerWrapper.title = "Drag to reorder column / Right-click to edit";

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

                    if (!columnsList.includes(currentStatus)) {
                        currentStatus = "null";
                    }

                    if (currentStatus === columnValue) {
                        const cardEl = cardsContainer.createDiv({ cls: "kanban-card" });
                        cardEl.setAttribute("draggable", "true");
                        cardEl.style.cssText = "background: var(--background-primary); border: 1px solid var(--background-modifier-border); padding: 10px; border-radius: 6px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); cursor: grab; user-select: none; margin-bottom: 2px; display: flex; flex-direction: column; gap: 8px;";
                        
                        cardEl.createDiv({ cls: "kanban-card-title", text: file.basename }).style.cssText = "font-size: 0.9rem; color: var(--text-normal); font-weight: 500;";

                        if (visibleProperties.length > 0) {
                            const propsContainer = cardEl.createDiv({ cls: "kanban-card-properties" });
                            propsContainer.style.cssText = "display: flex; flex-direction: column; gap: 4px; border-top: 1px solid var(--background-modifier-border); padding-top: 8px; margin-top: 4px;";

                            visibleProperties.forEach((propId: any) => {
                                const propValue = entry.getValue(propId);
                                
                                if (propValue && typeof propValue.toString === 'function' && propValue.toString().trim() !== "") {
                                    const friendlyName = this.config?.getDisplayName(propId) || propId;

                                    try {
                                        let items: any[] = [];
                                        if (propValue && typeof (propValue as any).length === 'function' && typeof (propValue as any).get === 'function') {
                                            const len = (propValue as any).length();
                                            for (let i = 0; i < len; i++) items.push((propValue as any).get(i));
                                        } else if (Array.isArray(propValue)) {
                                            items = propValue;
                                        } else {
                                            items = [propValue];
                                        }

                                        const hasLinks = items.some(item => item && item.toString().includes('[['));

                                        const propRow = propsContainer.createDiv({ cls: "kanban-card-property-row" });
                                        let valContainer: HTMLElement;

                                        if (hasLinks) {
                                            propRow.style.cssText = "display: flex; flex-direction: column; align-items: flex-start; gap: 4px; font-size: 0.75rem; color: var(--text-muted); line-height: 1.3;";
                                            propRow.createDiv({ text: friendlyName + ":", cls: "kanban-card-property-label" }).style.cssText = "opacity: 0.8; font-weight: 500;";
                                            
                                            valContainer = propRow.createDiv({ cls: "kanban-card-property-value" });
                                            valContainer.style.cssText = "width: 100%; color: var(--text-normal); display: flex; flex-direction: column; align-items: flex-start; gap: 4px; text-align: left; word-break: break-word;";
                                        } else {
                                            propRow.style.cssText = "display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; font-size: 0.75rem; color: var(--text-muted); line-height: 1.3;";
                                            propRow.createSpan({ text: friendlyName, cls: "kanban-card-property-label" }).style.cssText = "min-width: 70px; opacity: 0.8;";
                                            
                                            valContainer = propRow.createDiv({ cls: "kanban-card-property-value" });
                                            valContainer.style.cssText = "flex-grow: 1; color: var(--text-normal); display: flex; flex-direction: column; align-items: flex-end; gap: 4px; text-align: right; word-break: break-word;";
                                        }

                                        items.forEach(item => {
                                            if (item === null || item === undefined) return;
                                            const str = item.toString().trim();
                                            if (!str) return;

                                            const itemWrapper = valContainer.createDiv();
                                            if (hasLinks) {
                                                itemWrapper.style.cssText = "display: flex; flex-wrap: wrap; justify-content: flex-start; column-gap: 4px; text-align: left; width: 100%;";
                                            } else {
                                                itemWrapper.style.cssText = "display: flex; flex-wrap: wrap; justify-content: flex-end; column-gap: 4px; text-align: right; width: 100%;";
                                            }

                                            const linkRegex = /\[\[(.*?)\]\]/g;
                                            let match;
                                            let lastIndex = 0;

                                            while ((match = linkRegex.exec(str)) !== null) {
                                                if (match.index > lastIndex) {
                                                    const preText = str.slice(lastIndex, match.index).trim();
                                                    if (preText && preText !== ',') {
                                                        itemWrapper.createSpan({ text: preText.replace(/^,|,$/g, '').trim() });
                                                    }
                                                }

                                                const inner = match[1];
                                                let linkPath = inner;
                                                let displayAlias = null;
                                                
                                                if (inner.includes('|')) {
                                                    const parts = inner.split('|');
                                                    linkPath = parts[0];
                                                    displayAlias = parts[1];
                                                }

                                                const resolvedFile = this.app.metadataCache.getFirstLinkpathDest(linkPath, "");
                                                const textToShow = displayAlias || (resolvedFile ? resolvedFile.basename : linkPath);

                                                const linkEl = itemWrapper.createEl("a", { text: textToShow, cls: "internal-link" });
                                                linkEl.style.cssText = "color: var(--text-accent); text-decoration: underline; cursor: pointer;";
                                                
                                                if (resolvedFile) {
                                                    linkEl.onclick = async (e) => {
                                                        e.preventDefault();
                                                        e.stopPropagation();
                                                        const paneType = Keymap.isModEvent(e as any) || 'tab';
                                                        const newLeaf = this.app.workspace.getLeaf(paneType as any);
                                                        await newLeaf.openFile(resolvedFile);
                                                    };
                                                }

                                                lastIndex = linkRegex.lastIndex;
                                            }

                                            if (lastIndex < str.length) {
                                                const postText = str.slice(lastIndex).trim();
                                                if (postText && postText !== ',') {
                                                    itemWrapper.createSpan({ text: postText.replace(/^,|,$/g, '').trim() });
                                                }
                                            }
                                        });

                                    } catch (e) {
                                        console.error("Kanban text fallback error:", e);
                                        const propRow = propsContainer.createDiv({ cls: "kanban-card-property-row" });
                                        propRow.style.cssText = "display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; font-size: 0.75rem; color: var(--text-muted); line-height: 1.3;";
                                        propRow.createSpan({ text: friendlyName, cls: "kanban-card-property-label" }).style.cssText = "min-width: 70px; opacity: 0.8;";
                                        propRow.createDiv({ text: propValue.toString(), cls: "kanban-card-property-value" }).style.cssText = "flex-grow: 1; color: var(--text-normal); text-align: right; word-break: break-word;";
                                    }
                                }
                            });
                        }

                        cardEl.addEventListener("dblclick", async (ev: MouseEvent) => {
                            ev.preventDefault();
                            const newLeaf = this.app.workspace.getLeaf('tab');
                            await newLeaf.openFile(file);
                        });

                        cardEl.addEventListener("dragstart", (dragEv: DragEvent) => {
                            dragEv.dataTransfer?.setData("text/plain", file.path);
                            cardEl.style.opacity = "0.4";
                            dragEv.stopPropagation(); 
                        });

                        cardEl.addEventListener("dragend", (dragEv: DragEvent) => {
                            cardEl.style.opacity = "1";
                            dragEv.stopPropagation();
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
            if (e.dataTransfer?.types.includes("text/plain")) {
                e.preventDefault();
                e.stopPropagation();
            }
        });

        container.addEventListener("drop", async (e: DragEvent) => {
            if (!e.dataTransfer?.types.includes("text/plain")) return;
            
            e.preventDefault();
            e.stopPropagation(); 

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