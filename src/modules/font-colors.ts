import { Component, App, PluginManifest, Setting } from 'obsidian';

export interface ColorItem { name: string; hex: string; }
export interface BgPair { name: string; bg: string; text: string; }

export interface FontColorsSettings {
    textColors: ColorItem[];
    backgroundPairs: BgPair[];
}

export const FONT_COLORS_DEFAULTS: FontColorsSettings = {
    textColors: [
        { name: 'Gray', hex: '#737373' },
        { name: 'Brown', hex: '#8B5A2B' },
        { name: 'Orange', hex: '#FF6B00' },
        { name: 'Yellow', hex: '#D4A373' },
        { name: 'Green', hex: '#00A86B' },
        { name: 'Blue', hex: '#0077B6' },
        { name: 'Purple', hex: '#7209B7' },
        { name: 'Pink', hex: '#FF477E' }
    ],
    backgroundPairs: [
        { name: 'Gray', bg: '#555555', text: '#FFFFFF' },
        { name: 'Brown', bg: '#6E473B', text: '#FFFFFF' },
        { name: 'Orange', bg: '#FF6B00', text: '#FFFFFF' },
        { name: 'Yellow', bg: '#FFD166', text: '#1C1A17' },
        { name: 'Green', bg: '#06D6A0', text: '#1C1A17' },
        { name: 'Blue', bg: '#118AB2', text: '#FFFFFF' },
        { name: 'Purple', bg: '#7209B7', text: '#FFFFFF' },
        { name: 'Pink', bg: '#EF476F', text: '#FFFFFF' }
    ]
};

export class FontColorsModule extends Component {
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

    get settings(): FontColorsSettings {
        return this.pluginInstance.settings.modulesData[this.moduleId];
    }

    async onload() {
        this.registerEvent(
            this.app.workspace.on('editor-menu', (menu, editor) => {
                let targetData = this.detectAndExpandSpanSelection(editor);
                if (!targetData.text || targetData.text.trim() === "") return;

                menu.addSeparator();

                menu.addItem((item: any) => {
                    item.setTitle("Text Color").setIcon("type").setSubmenu();
                    item.submenu.addItem((subItem: any) => {
                        subItem.setTitle("Clear Text Color").setIcon("eraser").onClick(() => {
                            editor.setSelection(targetData.startPos, targetData.endPos);
                            editor.replaceSelection(targetData.cleanText);
                        });
                    });

                    this.settings.textColors.forEach(c => {
                        item.submenu.addItem((subItem: any) => {
                            subItem.setTitle(c.name).onClick(() => {
                                editor.setSelection(targetData.startPos, targetData.endPos);
                                const replacement = `<span style="color: ${c.hex};">${targetData.cleanText}</span>`;
                                editor.replaceSelection(replacement);
                            });
                            setTimeout(() => {
                                if (subItem.dom) {
                                    subItem.dom.style.color = c.hex;
                                    subItem.dom.style.fontWeight = "600";
                                }
                            }, 0);
                        });
                    });
                });

                menu.addItem((item: any) => {
                    item.setTitle("Background Color").setIcon("highlighter").setSubmenu();
                    item.submenu.addItem((subItem: any) => {
                        subItem.setTitle("Clear Background").setIcon("eraser").onClick(() => {
                            editor.setSelection(targetData.startPos, targetData.endPos);
                            editor.replaceSelection(targetData.cleanText);
                        });
                    });

                    this.settings.backgroundPairs.forEach(c => {
                        item.submenu.addItem((subItem: any) => {
                            subItem.setTitle(`${c.name} background`).onClick(() => {
                                editor.setSelection(targetData.startPos, targetData.endPos);
                                const replacement = `<span style="background-color: ${c.bg}; color: ${c.text}; padding: 2px 6px; border-radius: 4px; display: inline-block; line-height: 1.2;">${targetData.cleanText}</span>`;
                                editor.replaceSelection(replacement);
                            });
                            setTimeout(() => {
                                if (subItem.dom) {
                                    subItem.dom.style.backgroundColor = c.bg;
                                    subItem.dom.style.color = c.text;
                                    subItem.dom.style.borderRadius = "4px";
                                    subItem.dom.style.margin = "2px 4px";
                                    subItem.dom.style.padding = "4px 8px";
                                }
                            }, 0);
                        });
                    });
                });
            })
        );
    }

    detectAndExpandSpanSelection(editor: any) {
        let from = editor.getCursor("from");
        let to = editor.getCursor("to");
        let rawSelectedText = editor.getSelection();
        let lineText = editor.getLine(from.line);

        let extendedFromOffset = Math.max(0, from.ch - 150);
        let extendedToOffset = Math.min(lineText.length, to.ch + 50);

        let contextLeft = lineText.substring(extendedFromOffset, from.ch);
        let contextRight = lineText.substring(to.ch, extendedToOffset);

        let startPos = { line: from.line, ch: from.ch };
        let endPos = { line: to.line, ch: to.ch };

        let leftSpanMatch = contextLeft.match(/<span style="[^"]*">[^<>]*$/i);
        let rightSpanMatch = contextRight.match(/^[^<>]*<\/span>/i);

        if (leftSpanMatch && rightSpanMatch) {
            startPos.ch = extendedFromOffset + leftSpanMatch.index!;
            endPos.ch = to.ch + rightSpanMatch[0].length;
            rawSelectedText = lineText.substring(startPos.ch, endPos.ch);
        }

        let cleanText = rawSelectedText.replace(/<(span|font)[^>]*>([\s\S]*?)<\/\1>/gi, '$2');
        return { text: rawSelectedText, cleanText, startPos, endPos };
    }

    renderSettings(containerEl: HTMLElement) {
        containerEl.createEl('h3', { text: 'Text Colors' });
        this.settings.textColors.forEach((color, index) => {
            const s = new Setting(containerEl)
                .setName(`Text Color #${index + 1}`);
            
            const previewEl = s.nameEl.createEl('span', { text: 'Sample' });
            previewEl.style.color = color.hex;
            previewEl.style.fontWeight = '600';
            previewEl.style.marginRight = '15px';
            previewEl.style.border = '1px solid var(--background-modifier-border)';
            previewEl.style.padding = '2px 6px';
            previewEl.style.borderRadius = '4px';

            s.addText(text => text
                    .setValue(color.name)
                    .onChange(async (value) => {
                        color.name = value;
                        await this.pluginInstance.saveSettings();
                    }))
                .addColorPicker(cp => cp
                    .setValue(color.hex)
                    .onChange(async (value) => {
                        color.hex = value;
                        if (previewEl) previewEl.style.color = value;
                        await this.pluginInstance.saveSettings();
                    }))
                .addButton(btn => btn
                    .setButtonText('Delete').setWarning()
                    .onClick(async () => {
                        this.settings.textColors.splice(index, 1);
                        await this.pluginInstance.saveSettings();
                        this.pluginInstance.refreshSettingsUi();
                    }));
        });

        new Setting(containerEl)
            .setName('Add Custom Text Color')
            .addButton(btn => btn.setButtonText('Add Color').setCta().onClick(async () => {
                this.settings.textColors.push({ name: 'Custom Color', hex: '#000000' });
                await this.pluginInstance.saveSettings();
                this.pluginInstance.refreshSettingsUi();
            }));
    }
}