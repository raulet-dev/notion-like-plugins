const { Plugin, PluginSettingTab, Setting } = require('obsidian');

const DEFAULTS = {
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

module.exports = class NotionColorMenuPlugin extends Plugin {
    async onload() {
        // Load data from <id>-data.json via the orchestrator's monkey-patched hooks
        const loadedData = await this.loadData();
        this.settings = Object.assign({}, DEFAULTS, loadedData);
        this.settings.textColors = this.settings.textColors || DEFAULTS.textColors;
        this.settings.backgroundPairs = this.settings.backgroundPairs || DEFAULTS.backgroundPairs;

        this.registerEvent(
            this.app.workspace.on('editor-menu', (menu, editor, view) => {
                let targetData = this.detectAndExpandSpanSelection(editor);
                if (!targetData.text || targetData.text.trim() === "") return;

                menu.addSeparator();

                menu.addItem((item) => {
                    item.setTitle("Text Color").setIcon("type").setSubmenu();

                    item.submenu.addItem((subItem) => {
                        subItem
                            .setTitle("Clear Text Color")
                            .setIcon("eraser")
                            .onClick(() => {
                                editor.setSelection(targetData.startPos, targetData.endPos);
                                editor.replaceSelection(targetData.cleanText);
                            });
                    });

                    this.settings.textColors.forEach(c => {
                        item.submenu.addItem((subItem) => {
                            subItem
                                .setTitle(c.name)
                                .onClick(() => {
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

                menu.addItem((item) => {
                    item.setTitle("Background Color").setIcon("highlighter").setSubmenu();

                    item.submenu.addItem((subItem) => {
                        subItem
                            .setTitle("Clear Background")
                            .setIcon("eraser")
                            .onClick(() => {
                                editor.setSelection(targetData.startPos, targetData.endPos);
                                editor.replaceSelection(targetData.cleanText);
                            });
                    });

                    this.settings.backgroundPairs.forEach(c => {
                        item.submenu.addItem((subItem) => {
                            subItem
                                .setTitle(`${c.name} background`)
                                .onClick(() => {
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

    // THE EXACT SAME IDENTICAL FUNCTION IN EVERY PLUGIN:
    getSettingTab() {
        if (typeof SubPluginSettingTab !== 'undefined') {
            return new SubPluginSettingTab(this.app, this);
        }
        return null;
    }

    detectAndExpandSpanSelection(editor) {
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
            startPos.ch = extendedFromOffset + leftSpanMatch.index;
            endPos.ch = to.ch + rightSpanMatch[0].length;
            rawSelectedText = lineText.substring(startPos.ch, endPos.ch);
        }

        let cleanText = rawSelectedText.replace(/<(span|font)[^>]*>([\s\S]*?)<\/\1>/gi, '$2');

        return {
            text: rawSelectedText,
            cleanText: cleanText,
            startPos: startPos,
            endPos: endPos
        };
    }

    onunload() {}
}

// Custom Settings tab layout appended at the footer of the file
class SubPluginSettingTab extends PluginSettingTab {
    constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display() {
        const { containerEl } = this;
        containerEl.empty();

        // 3. Nested Header Visibility Rule
        if (!containerEl.classList.contains('orchestrator-sub-settings')) {
            containerEl.createEl('h2', { text: 'Font Colors Configuration' });
        }

        containerEl.createEl('h3', { text: 'Text Colors' });

        this.plugin.settings.textColors.forEach((color, index) => {
            const s = new Setting(containerEl)
                .setName(`Text Color #${index + 1}`)
                .addText(text => text
                    .setPlaceholder('Label (e.g. Red)')
                    .setValue(color.name)
                    .onChange(async (value) => {
                        color.name = value;
                        await this.plugin.saveData(this.plugin.settings); //
                    }))
                .addColorPicker(cp => cp
                    .setValue(color.hex)
                    .onChange(async (value) => {
                        color.hex = value;
                        previewEl.style.color = value; // Dynamic preview update
                        await this.plugin.saveData(this.plugin.settings); //
                    }))
                .addButton(btn => btn
                    .setButtonText('Delete')
                    .setWarning()
                    .onClick(async () => {
                        this.plugin.settings.textColors.splice(index, 1);
                        await this.plugin.saveData(this.plugin.settings); //
                        this.display();
                    }));

            // Prepend the visual sample preview block
            const previewEl = s.nameEl.createEl('span', { text: 'Sample' });
            previewEl.style.color = color.hex;
            previewEl.style.fontWeight = '600';
            previewEl.style.marginRight = '15px';
            previewEl.style.border = '1px solid var(--background-modifier-border)';
            previewEl.style.padding = '2px 6px';
            previewEl.style.borderRadius = '4px';
        });

        new Setting(containerEl)
            .setName('Add Custom Text Color')
            .addButton(btn => btn
                .setButtonText('Add Color')
                .setCta()
                .onClick(async () => {
                    this.plugin.settings.textColors.push({ name: 'Custom Color', hex: '#000000' });
                    await this.plugin.saveData(this.plugin.settings); //
                    this.display();
                }));

        containerEl.createEl('h3', { text: 'Background Colors' });

        this.plugin.settings.backgroundPairs.forEach((pair, index) => {
            const s = new Setting(containerEl)
                .setName(`Background Target #${index + 1}`)
                .setDesc('Pick a background color and text contrast color.') // Replaced tooltips with description text
                .addText(text => text
                    .setPlaceholder('Label (e.g. Red)')
                    .setValue(pair.name)
                    .onChange(async (value) => {
                        pair.name = value;
                        await this.plugin.saveData(this.plugin.settings); //
                    }))
                .addColorPicker(cp => cp
                    .setValue(pair.bg)
                    .onChange(async (value) => {
                        pair.bg = value;
                        previewEl.style.backgroundColor = value; // Dynamic background update
                        await this.plugin.saveData(this.plugin.settings); //
                    }))
                .addColorPicker(cp => cp
                    .setValue(pair.text)
                    .onChange(async (value) => {
                        pair.text = value;
                        previewEl.style.color = value; // Dynamic contrast text update
                        await this.plugin.saveData(this.plugin.settings); //
                    }))
                .addButton(btn => btn
                    .setButtonText('Delete')
                    .setWarning()
                    .onClick(async () => {
                        this.plugin.settings.backgroundPairs.splice(index, 1);
                        await this.plugin.saveData(this.plugin.settings); //
                        this.display();
                    }));

            // Prepend the visual background sample block
            const previewEl = s.nameEl.createEl('span', { text: 'Sample' });
            previewEl.style.backgroundColor = pair.bg;
            previewEl.style.color = pair.text;
            previewEl.style.padding = '2px 6px';
            previewEl.style.borderRadius = '4px';
            previewEl.style.display = 'inline-block';
            previewEl.style.lineHeight = '1.2';
            previewEl.style.marginRight = '15px';
            previewEl.style.border = '1px solid var(--background-modifier-border)';
        });

        new Setting(containerEl)
            .setName('Add Custom Background Combo')
            .addButton(btn => btn
                .setButtonText('Add Background')
                .setCta()
                .onClick(async () => {
                    this.plugin.settings.backgroundPairs.push({ name: 'Custom Bg', bg: '#FFFFFF', text: '#000000' });
                    await this.plugin.saveData(this.plugin.settings); //
                    this.display();
                }));
    }
}