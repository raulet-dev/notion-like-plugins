import { Component, App, PluginManifest, TFile, MarkdownPostProcessorContext, Setting } from 'obsidian';

export interface GraphBlockConfig {
    type: 'donut' | 'line' | 'vertical-bar' | 'horizontal-bar';
    path: string;
    x: string;
    y?: string;
    grouped?: 'no' | 'x' | 'y' | 'xy';
}

export interface ColorPaletteItem {
    hex: string;
}

export interface BasesGraphSettings {
    colorPalette: ColorPaletteItem[];
}

export const BASES_GRAPH_DEFAULTS: BasesGraphSettings = {
    colorPalette: [
        { hex: '#5fa4f5' }, // Vibrant Blue
        { hex: '#e3e3e3' }, // Off-White / Light Gray
        { hex: '#f59e0b' }, // Amber / Orange
        { hex: '#10b981' }, // Emerald Green
        { hex: '#ec4899' }, // Pink
        { hex: '#8b5cf6' }, // Purple
        { hex: '#a8a29e' }, // Stone Gray
        { hex: '#f43f5e' }  // Rose Red
    ]
};

export class BasesGraphModule extends Component {
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

    get settings(): BasesGraphSettings {
        return this.pluginInstance.settings.modulesData[this.moduleId] || BASES_GRAPH_DEFAULTS;
    }

    async onload() {
        this.registerGraphCodeBlock();
    }

    private getColorsArray(): string[] {
        if (this.settings.colorPalette && this.settings.colorPalette.length > 0) {
            return this.settings.colorPalette.map(c => c.hex);
        }
        return BASES_GRAPH_DEFAULTS.colorPalette.map(c => c.hex);
    }

    private registerGraphCodeBlock() {
        if (typeof this.pluginInstance.registerMarkdownCodeBlockProcessor !== 'function') return;

        this.pluginInstance.registerMarkdownCodeBlockProcessor('graph', async (source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
            el.empty();
            el.addClass('bases-graph-render-container');

            const config = this.parseConfig(source);
            if (!config.path || !config.x) {
                const errorEl = el.createEl('p', { text: '⚠️ Graph configuration requires "path" and "x" parameters.' });
                errorEl.style.cssText = "color: var(--text-muted); font-size: 0.9rem;";
                return;
            }

            const baseFile = this.app.metadataCache.getFirstLinkpathDest(config.path, "");
            if (!baseFile) {
                const errorEl = el.createEl('p', { text: `⚠️ Target database file "${config.path}" could not be located inside your vault.` });
                errorEl.style.cssText = "color: var(--text-error); font-size: 0.9rem;";
                return;
            }

            // DYNAMIC RESOLUTION WORKFLOW: Read the .base schema to match aliases/display names back to frontmatter properties
            let resolvedXProp = config.x;
            let resolvedYProp = config.y;

            try {
                const baseContent = await this.app.vault.read(baseFile);
                const baseJson = JSON.parse(baseContent);
                const propertiesMap = baseJson.properties || {};

                for (const [propId, propDef] of Object.entries(propertiesMap)) {
                    const def = propDef as any;
                    const cleanTargetX = config.x.toLowerCase().replace(/[\s_-]/g, '');
                    
                    if (def?.displayName && def.displayName.toLowerCase().replace(/[\s_-]/g, '') === cleanTargetX) {
                        resolvedXProp = propId; // Auto-remaps "Rent" to physical note field context
                    }
                    
                    if (config.y) {
                        const cleanTargetY = config.y.toLowerCase().replace(/[\s_-]/g, '');
                        if (def?.displayName && def.displayName.toLowerCase().replace(/[\s_-]/g, '') === cleanTargetY) {
                            resolvedYProp = propId;
                        }
                    }
                }
            } catch (e) {
                // Fail-safe fall back to raw configurations on JSON error
            }

            const dataMatrix = this.collectMetricsData(config, baseFile.parent?.path || "", resolvedXProp, resolvedYProp);
            if (dataMatrix.length === 0) {
                const errorEl = el.createEl('p', { text: '🗄️ No matching properties metrics discovered across this directory section.' });
                errorEl.style.cssText = "color: var(--text-muted); font-size: 0.9rem;";
                return;
            }

            switch (config.type) {
                case 'donut':
                    this.renderDonutChart(el, dataMatrix);
                    break;
                case 'line':
                    this.renderLineChart(el, dataMatrix);
                    break;
                case 'horizontal-bar':
                    this.renderHorizontalBarChart(el, dataMatrix);
                    break;
                case 'vertical-bar':
                default:
                    this.renderVerticalBarChart(el, dataMatrix);
                    break;
            }
        });
    }

    private parseConfig(source: string): GraphBlockConfig {
        const lines = source.split('\n');
        const config: any = { type: 'vertical-bar', grouped: 'xy' };

        lines.forEach(line => {
            const parts = line.split(':');
            if (parts.length >= 2) {
                const key = parts[0].trim().replace(/['"<>]/g, '');
                const val = parts.slice(1).join(':').trim().replace(/['"<>]/g, '');
                config[key] = val;
            }
        });

        return config as GraphBlockConfig;
    }

    /**
     * ADVANCED UNBOXING STRATEGY: Safely pulls flat strings out of deep database framework objects,
     * arrays, or raw text links inside frontmatter configurations.
     */
    private extractPropertyTokens(frontmatter: any, normalizedTargetKey: string): string[] {
        if (!frontmatter) return [];
        
        let rawValue: any = null;
        for (const key of Object.keys(frontmatter)) {
            if (key.toLowerCase().replace(/[\s_-]/g, '') === normalizedTargetKey) {
                rawValue = frontmatter[key];
                break;
            }
        }

        if (rawValue === undefined || rawValue === null) return [];

        const unwrapToken = (val: any): string => {
            if (val === undefined || val === null) return "";
            if (typeof val === 'object') {
                return String(val.value || val.display || val.name || val.path || val.link || "").trim();
            }
            return String(val).trim().replace(/^\[\[(.*?)\]\]$/, '$1'); // Strips out wiki brackets
        };

        if (Array.isArray(rawValue)) {
            return rawValue.map(item => unwrapToken(item)).filter(item => item !== "");
        }

        const singleToken = unwrapToken(rawValue);
        return singleToken !== "" ? [singleToken] : [];
    }

    private collectMetricsData(config: GraphBlockConfig, parentFolderPath: string, resolvedX: string, resolvedY?: string): Array<{ label: string; value: number; color: string }> {
        const countsMap = new Map<string, number>();
        const files = this.app.vault.getMarkdownFiles();
        
        const cleanXProp = resolvedX.replace(/^note\./, '').toLowerCase().replace(/[\s_-]/g, '');
        const cleanYProp = resolvedY ? resolvedY.replace(/^note\./, '').toLowerCase().replace(/[\s_-]/g, '') : null;
        const groupingStrategy = config.grouped || 'xy';
        const dynamicColors = this.getColorsArray();

        files.forEach((file: TFile) => {
            if (parentFolderPath !== "" && !file.path.startsWith(parentFolderPath)) return;

            const cache = this.app.metadataCache.getFileCache(file);
            if (!cache?.frontmatter) return;

            const xTokens = this.extractPropertyTokens(cache.frontmatter, cleanXProp);
            const yTokens = cleanYProp ? this.extractPropertyTokens(cache.frontmatter, cleanYProp) : [];

            // RELATIONAL COMBINATION WORKFLOW
            if (cleanYProp) {
                const label = xTokens.length > 0 ? xTokens[0] : 'Unassigned';
                const rawYValue = yTokens.length > 0 ? yTokens[0] : '0';
                const parsedValue = parseFloat(rawYValue.replace(/[^0-9.]/g, '')) || 0;

                if (groupingStrategy === 'no') {
                    countsMap.set(`${file.basename} (${label})`, parsedValue);
                } else {
                    countsMap.set(label, (countsMap.get(label) || 0) + parsedValue);
                }
            } else {
                // OCCURRENCE COUNT FREQUENCY WORKFLOW
                if (groupingStrategy === 'no') {
                    countsMap.set(file.basename, 1);
                } else {
                    const processLabelsList = xTokens.length > 0 ? xTokens : ['Unassigned'];
                    processLabelsList.forEach(label => {
                        countsMap.set(label, (countsMap.get(label) || 0) + 1);
                    });
                }
            }
        });

        return Array.from(countsMap.entries()).map(([label, value], idx) => ({
            label,
            value,
            color: dynamicColors[idx % dynamicColors.length]
        })).sort((a, b) => b.value - a.value);
    }

    // ==================== VISUALIZATION ENGINES ====================

    private renderDonutChart(parent: HTMLElement, data: any[]) {
        const total = data.reduce((sum, item) => sum + item.value, 0);
        const svgNamespace = "http://www.w3.org/2000/svg";
        
        const wrapper = parent.createDiv();
        wrapper.style.cssText = "display: flex; flex-direction: column; align-items: center; width: 100%; max-width: 450px; position: relative;";

        const svg = document.createElementNS(svgNamespace, "svg");
        svg.setAttribute("viewBox", "0 0 360 360");
        svg.setAttribute("width", "100%");
        svg.style.maxHeight = "320px";

        const radius = 120;
        const circumference = 2 * Math.PI * radius;
        let runningAngleOffset = -90;

        data.forEach(item => {
            const percentage = item.value / total;
            const strokeDashOffset = circumference * (1 - percentage);
            const rotation = runningAngleOffset;

            const circle = document.createElementNS(svgNamespace, "circle");
            circle.setAttribute("cx", "180");
            circle.setAttribute("cy", "180");
            circle.setAttribute("r", String(radius));
            circle.setAttribute("fill", "transparent");
            circle.setAttribute("stroke", item.color);
            circle.setAttribute("stroke-width", "28");
            circle.setAttribute("stroke-dasharray", String(circumference));
            circle.setAttribute("stroke-dashoffset", String(strokeDashOffset));
            circle.setAttribute("transform", `rotate(${rotation} 180 180)`);
            svg.appendChild(circle);

            runningAngleOffset += percentage * 360;
        });

        const textGroup = document.createElementNS(svgNamespace, "g");
        textGroup.setAttribute("text-anchor", "middle");

        const countTxt = document.createElementNS(svgNamespace, "text");
        countTxt.setAttribute("x", "180");
        countTxt.setAttribute("y", "185");
        countTxt.setAttribute("fill", "#ffffff");
        countTxt.setAttribute("style", "font-size: 56px; font-weight: 700; font-family: system-ui;");
        countTxt.textContent = String(total);

        const subTxt = document.createElementNS(svgNamespace, "text");
        subTxt.setAttribute("x", "180");
        subTxt.setAttribute("y", "220");
        subTxt.setAttribute("fill", "#666666");
        subTxt.setAttribute("style", "font-size: 14px; font-weight: 500; letter-spacing: 0.5px; font-family: system-ui;");
        subTxt.textContent = "Total";

        textGroup.appendChild(countTxt);
        textGroup.appendChild(subTxt);
        svg.appendChild(textGroup);
        wrapper.appendChild(svg);

        const legendGrid = wrapper.createDiv();
        legendGrid.style.cssText = "display: flex; flex-direction: column; gap: 8px; margin-top: 15px; width: 100%; font-family: system-ui; font-size: 0.85rem;";
        
        data.forEach(item => {
            const row = legendGrid.createDiv();
            row.style.cssText = "display: flex; align-items: center; justify-content: space-between; color: #888;";
            
            const leftWrap = row.createDiv();
            leftWrap.style.cssText = "display: flex; align-items: center; gap: 8px;";
            const dot = leftWrap.createDiv();
            dot.style.cssText = `width: 10px; height: 10px; border-radius: 50%; background: ${item.color};`;
            
            const labelSpan = leftWrap.createEl('span', { text: item.label });
            labelSpan.style.cssText = "color: #fff; font-weight: 500;";

            const valueSpan = row.createEl('span', { text: `${item.value} (${((item.value / total) * 100).toFixed(1)}%)` });
            valueSpan.style.cssText = "color: #666;";
        });
    }

    private renderVerticalBarChart(parent: HTMLElement, data: any[]) {
        const maxValue = Math.max(...data.map(d => d.value), 1);
        const yTicksMax = Math.ceil(maxValue / 8) * 8;
        const svgNamespace = "http://www.w3.org/2000/svg";

        const svg = document.createElementNS(svgNamespace, "svg");
        svg.setAttribute("viewBox", "0 0 500 320");
        svg.setAttribute("width", "100%");
        svg.style.maxHeight = "320px";

        const gridGroup = document.createElementNS(svgNamespace, "g");
        for (let i = 0; i <= 4; i++) {
            const yVal = 40 + i * 55;
            const tickValue = yTicksMax - (i * (yTicksMax / 4));
            
            const line = document.createElementNS(svgNamespace, "line");
            line.setAttribute("x1", "50");
            line.setAttribute("y1", String(yVal));
            line.setAttribute("x2", "470");
            line.setAttribute("y2", String(yVal));
            line.setAttribute("stroke", "#222");
            line.setAttribute("stroke-dasharray", "3,3");
            gridGroup.appendChild(line);

            const label = document.createElementNS(svgNamespace, "text");
            label.setAttribute("x", "30");
            label.setAttribute("y", String(yVal + 4));
            label.setAttribute("fill", "#666");
            label.setAttribute("style", "font-size: 12px; font-family: system-ui; text-anchor: right;");
            label.textContent = String(tickValue);
            gridGroup.appendChild(label);
        }
        svg.appendChild(gridGroup);

        const barWidth = 32;
        const chartSpacing = (420 / data.length);

        data.forEach((item, index) => {
            const xPos = 50 + (index * chartSpacing) + (chartSpacing / 2) - (barWidth / 2);
            const pct = item.value / yTicksMax;
            const barHeight = pct * 220;
            const yPos = 260 - barHeight;

            const rect = document.createElementNS(svgNamespace, "rect");
            rect.setAttribute("x", String(xPos));
            rect.setAttribute("y", String(yPos));
            rect.setAttribute("width", String(barWidth));
            rect.setAttribute("height", String(barHeight));
            rect.setAttribute("fill", item.color);
            rect.setAttribute("rx", "3");
            svg.appendChild(rect);

            const valLabel = document.createElementNS(svgNamespace, "text");
            valLabel.setAttribute("x", String(xPos + barWidth / 2));
            valLabel.setAttribute("y", String(yPos - 8));
            valLabel.setAttribute("fill", "#fff");
            valLabel.setAttribute("text-anchor", "middle");
            valLabel.setAttribute("style", "font-size: 12px; font-weight: 600; font-family: system-ui;");
            valLabel.textContent = String(item.value);
            svg.appendChild(valLabel);

            const axisLabel = document.createElementNS(svgNamespace, "text");
            axisLabel.setAttribute("x", String(xPos + barWidth / 2));
            axisLabel.setAttribute("y", "285");
            axisLabel.setAttribute("fill", "#888");
            axisLabel.setAttribute("text-anchor", "middle");
            axisLabel.setAttribute("style", "font-size: 12px; font-family: system-ui; font-weight: 500;");
            axisLabel.textContent = item.label.length > 14 ? item.label.substring(0, 12) + '..' : item.label;
            svg.appendChild(axisLabel);
        });

        parent.appendChild(svg);
    }

    private renderHorizontalBarChart(parent: HTMLElement, data: any[]) {
        const maxValue = Math.max(...data.map(d => d.value), 1);
        const xTicksMax = Math.ceil(maxValue / 8) * 8;
        const svgNamespace = "http://www.w3.org/2000/svg";

        const svg = document.createElementNS(svgNamespace, "svg");
        svg.setAttribute("viewBox", "0 0 500 260");
        svg.setAttribute("width", "100%");

        for (let i = 0; i <= 4; i++) {
            const xVal = 100 + i * 85;
            const tickValue = (i * (xTicksMax / 4));

            const line = document.createElementNS(svgNamespace, "line");
            line.setAttribute("x1", String(xVal));
            line.setAttribute("y1", "30");
            line.setAttribute("x2", String(xVal));
            line.setAttribute("y2", "210");
            line.setAttribute("stroke", "#222");
            line.setAttribute("stroke-dasharray", "3,3");
            svg.appendChild(line);

            const label = document.createElementNS(svgNamespace, "text");
            label.setAttribute("x", String(xVal));
            label.setAttribute("y", "230");
            label.setAttribute("fill", "#666");
            label.setAttribute("text-anchor", "middle");
            label.setAttribute("style", "font-size: 11px; font-family: system-ui;");
            label.textContent = String(tickValue);
            svg.appendChild(label);
        }

        const barHeight = 20;
        const rowSpacing = (180 / data.length);

        data.forEach((item, index) => {
            const yPos = 40 + (index * rowSpacing) + (rowSpacing / 2) - (barHeight / 2);
            const pct = item.value / xTicksMax;
            const barWidth = pct * 340;

            const titleLabel = document.createElementNS(svgNamespace, "text");
            titleLabel.setAttribute("x", "85");
            titleLabel.setAttribute("y", String(yPos + barHeight / 2 + 4));
            titleLabel.setAttribute("fill", "#888");
            titleLabel.setAttribute("text-anchor", "end");
            titleLabel.setAttribute("style", "font-size: 12px; font-family: system-ui; font-weight: 500;");
            titleLabel.textContent = item.label.length > 12 ? item.label.substring(0, 10) + '..' : item.label;
            svg.appendChild(titleLabel);

            const rect = document.createElementNS(svgNamespace, "rect");
            rect.setAttribute("x", "100");
            rect.setAttribute("y", String(yPos));
            rect.setAttribute("width", String(barWidth));
            rect.setAttribute("height", String(barHeight));
            rect.setAttribute("fill", item.color);
            rect.setAttribute("rx", "3");
            svg.appendChild(rect);

            const countLabel = document.createElementNS(svgNamespace, "text");
            countLabel.setAttribute("x", String(106 + barWidth));
            countLabel.setAttribute("y", String(yPos + barHeight / 2 + 4));
            countLabel.setAttribute("fill", "#fff");
            countLabel.setAttribute("style", "font-size: 12px; font-weight: 600; font-family: system-ui;");
            countLabel.textContent = String(item.value);
            svg.appendChild(countLabel);
        });

        parent.appendChild(svg);
    }

    private renderLineChart(parent: HTMLElement, data: any[]) {
        const maxValue = Math.max(...data.map(d => d.value), 1);
        const yTicksMax = Math.ceil(maxValue / 8) * 8;
        const svgNamespace = "http://www.w3.org/2000/svg";

        const svg = document.createElementNS(svgNamespace, "svg");
        svg.setAttribute("viewBox", "0 0 500 320");
        svg.setAttribute("width", "100%");

        for (let i = 0; i <= 4; i++) {
            const yVal = 40 + i * 55;
            const tickValue = yTicksMax - (i * (yTicksMax / 4));

            const line = document.createElementNS(svgNamespace, "line");
            line.setAttribute("x1", "60");
            line.setAttribute("y1", String(yVal));
            line.setAttribute("x2", "460");
            line.setAttribute("y2", String(yVal));
            line.setAttribute("stroke", "#222");
            line.setAttribute("stroke-dasharray", "3,3");
            svg.appendChild(line);

            const label = document.createElementNS(svgNamespace, "text");
            label.setAttribute("x", "35");
            label.setAttribute("y", String(yVal + 4));
            label.setAttribute("fill", "#666");
            label.setAttribute("style", "font-size: 11px; font-family: system-ui;");
            label.textContent = String(tickValue);
            svg.appendChild(label);
        }

        const chartSpacing = (400 / (data.length > 1 ? data.length - 1 : 1));
        let pathCoordinatesString = "";
        const pointsArray: Array<{x: number, y: number, item: any}> = [];

        data.forEach((item, index) => {
            const xPos = data.length > 1 ? 60 + (index * chartSpacing) : 260;
            const pct = item.value / yTicksMax;
            const yPos = 260 - (pct * 220);

            pointsArray.push({ x: xPos, y: yPos, item });
            pathCoordinatesString += (index === 0 ? "M " : " L ") + xPos + " " + yPos;
        });

        if (pointsArray.length > 0) {
            const polyLine = document.createElementNS(svgNamespace, "path");
            polyLine.setAttribute("d", pathCoordinatesString);
            polyLine.setAttribute("fill", "none");
            polyLine.setAttribute("stroke", "#5fa4f5");
            polyLine.setAttribute("stroke-width", "3");
            svg.appendChild(polyLine);
        }

        pointsArray.forEach(pt => {
            const dot = document.createElementNS(svgNamespace, "circle");
            dot.setAttribute("cx", String(pt.x));
            dot.setAttribute("cy", String(pt.y));
            dot.setAttribute("r", "5");
            dot.setAttribute("fill", "#5fa4f5");
            dot.setAttribute("stroke", "#141414");
            dot.setAttribute("stroke-width", "1.5");
            svg.appendChild(dot);

            const txt = document.createElementNS(svgNamespace, "text");
            txt.setAttribute("x", String(pt.x));
            txt.setAttribute("y", String(pt.y - 12));
            txt.setAttribute("fill", "#fff");
            txt.setAttribute("text-anchor", "middle");
            txt.setAttribute("style", "font-size: 12px; font-weight: 600; font-family: system-ui;");
            txt.textContent = String(pt.item.value);
            svg.appendChild(txt);

            const axisTxt = document.createElementNS(svgNamespace, "text");
            axisTxt.setAttribute("x", String(pt.x));
            axisTxt.setAttribute("y", "285");
            axisTxt.setAttribute("fill", "#888");
            axisTxt.setAttribute("text-anchor", "middle");
            axisTxt.setAttribute("style", "font-size: 12px; font-family: system-ui; font-weight: 500;");
            axisTxt.textContent = pt.item.label;
            svg.appendChild(axisTxt);
        });

        parent.appendChild(svg);
    }

    // ==================== CONFIGURATION SETTINGS MENU GENERATOR ====================

    renderSettings(containerEl: HTMLElement) {
        containerEl.createEl('h3', { text: 'Metrics Graphs Palette Settings' });
        
        const descEl = containerEl.createEl('p', { 
            text: 'Customize the sequence of hex color groups applied successively to chart values inside metric elements.'
        });
        descEl.style.cssText = 'color: var(--text-muted); font-size: 0.85rem; margin-bottom: 15px;';

        this.settings.colorPalette.forEach((colorItem, index) => {
            const s = new Setting(containerEl)
                .setName(`Palette Vector Slot #${index + 1}`);

            const previewDot = s.nameEl.createEl('span', { cls: 'graph-settings-preview-dot' });
            previewDot.style.backgroundColor = colorItem.hex;

            s.addColorPicker(cp => cp
                .setValue(colorItem.hex)
                .onChange(async (value) => {
                    colorItem.hex = value;
                    previewDot.style.backgroundColor = value;
                    await this.pluginInstance.saveSettings();
                }))
            .addButton(btn => btn
                .setButtonText('Remove').setWarning()
                .onClick(async () => {
                    this.settings.colorPalette.splice(index, 1);
                    await this.pluginInstance.saveSettings();
                    this.pluginInstance.refreshSettingsUi();
                }));
        });

        new Setting(containerEl)
            .setName('Add Custom Palette Color')
            .addButton(btn => btn
                .setButtonText('Add Color Step').setCta()
                .onClick(async () => {
                    this.settings.colorPalette.push({ hex: '#5fa4f5' });
                    await this.pluginInstance.saveSettings();
                    this.pluginInstance.refreshSettingsUi();
                }));
    }
}