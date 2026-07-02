const { Plugin } = require('obsidian');

module.exports = class NotionColorMenuPlugin extends Plugin {
    async onload() {
        const textColors = [
            { name: 'Gray', hex: '#737373' },
            { name: 'Brown', hex: '#8B5A2B' },
            { name: 'Orange', hex: '#FF6B00' },
            { name: 'Yellow', hex: '#D4A373' },
            { name: 'Green', hex: '#00A86B' },
            { name: 'Blue', hex: '#0077B6' },
            { name: 'Purple', hex: '#7209B7' },
            { name: 'Pink', hex: '#FF477E' }
        ];

        const backgroundPairs = [
            { name: 'Gray', bg: '#555555', text: '#FFFFFF' },
            { name: 'Brown', bg: '#6E473B', text: '#FFFFFF' },
            { name: 'Orange', bg: '#FF6B00', text: '#FFFFFF' },
            { name: 'Yellow', bg: '#FFD166', text: '#1C1A17' },
            { name: 'Green', bg: '#06D6A0', text: '#1C1A17' },
            { name: 'Blue', bg: '#118AB2', text: '#FFFFFF' },
            { name: 'Purple', bg: '#7209B7', text: '#FFFFFF' },
            { name: 'Pink', bg: '#EF476F', text: '#FFFFFF' }
        ];

        this.registerEvent(
            this.app.workspace.on('editor-menu', (menu, editor, view) => {
                // Look for selections and actively discover hidden spans in Live Preview
                let targetData = this.detectAndExpandSpanSelection(editor);
                if (!targetData.text || targetData.text.trim() === "") return;

                menu.addSeparator();

                // 1. Text Color Dropdown
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

                    textColors.forEach(c => {
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

                // 2. Background Dropdown
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

                    backgroundPairs.forEach(c => {
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

    // Advanced selection handler to trap hidden HTML markup tokens in Live Preview editor states
    detectAndExpandSpanSelection(editor) {
        let from = editor.getCursor("from");
        let to = editor.getCursor("to");
        
        // 1. Snag original coordinates and text block lines
        let rawSelectedText = editor.getSelection();
        let lineText = editor.getLine(from.line);
        
        // 2. Expand horizons dynamically to look for wrapping span tags hidden by Live Preview engine
        let extendedFromOffset = Math.max(0, from.ch - 150); 
        let extendedToOffset = Math.min(lineText.length, to.ch + 50);
        
        let contextLeft = lineText.substring(extendedFromOffset, from.ch);
        let contextRight = lineText.substring(to.ch, extendedToOffset);
        
        let startPos = { line: from.line, ch: from.ch };
        let endPos = { line: to.line, ch: to.ch };
        
        // Match expressions for open/close tags
        let leftSpanMatch = contextLeft.match(/<span style="[^"]*">[^<>]*$/i);
        let rightSpanMatch = contextRight.match(/^[^<>]*<\/span>/i);
        
        if (leftSpanMatch && rightSpanMatch) {
            // Found hidden span code block wrapping selection! Readjust selection points out over the tags
            startPos.ch = extendedFromOffset + leftSpanMatch.index;
            endPos.ch = to.ch + rightSpanMatch[0].length;
            rawSelectedText = lineText.substring(startPos.ch, endPos.ch);
        }

        // Clean out formatting to make sure replacement processing remains mutually exclusive
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