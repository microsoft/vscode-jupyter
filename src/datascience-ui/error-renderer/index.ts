// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import './styles.css';
import { ActivationFunction, OutputItem, RendererContext } from 'vscode-notebook-renderer';
import ansiToHtml from 'ansi-to-html';

/* eslint-disable @typescript-eslint/no-explicit-any */

const handleInnerClick = (event: MouseEvent, context: RendererContext<any>) => {
    if (!event || !event.view || !event.view.document) {
        return;
    }

    for (const pathElement of event.composedPath()) {
        const node: any = pathElement;
        if (node.tagName && node.tagName.toLowerCase() === 'a' && node.href && node.href.indexOf('file') === 0) {
            if (context.postMessage) {
                context.postMessage({
                    message: 'open_link',
                    payload: node.href
                });
                event.preventDefault();
                return;
            }
        }
    }
};

export const activate: ActivationFunction = (_context) => {
    return {
        renderOutputItem(outputItem: OutputItem, element: HTMLElement) {
            console.log(outputItem.metadata);
            const converter = new ansiToHtml({
                fg: 'var(--vscode-terminal-foreground)',
                bg: 'var(--vscode-terminal-background)',
                colors: [
                    'var(--vscode-terminal-ansiBlack)', // 0
                    'var(--vscode-terminal-ansiBrightRed)', // 1
                    'var(--vscode-terminal-ansiGreen)', // 2
                    'var(--vscode-terminal-ansiYellow)', // 3
                    'var(--vscode-terminal-ansiBrightBlue)', // 4
                    'var(--vscode-terminal-ansiMagenta)', // 5
                    'var(--vscode-terminal-ansiCyan)', // 6
                    'var(--vscode-terminal-ansiBrightBlack)', // 7
                    'var(--vscode-terminal-ansiWhite)', // 8
                    'var(--vscode-terminal-ansiRed)', // 9
                    'var(--vscode-terminal-ansiBrightGreen)', // 10
                    'var(--vscode-terminal-ansiBrightYellow)', // 11
                    'var(--vscode-terminal-ansiBlue)', // 12
                    'var(--vscode-terminal-ansiBrightMagenta)', // 13
                    'var(--vscode-terminal-ansiBrightCyan)', // 14
                    'var(--vscode-terminal-ansiBrightWhite)' // 15
                ]
            });
            const metadata: any = outputItem.metadata;
            const outputItemJson = outputItem.json();
            console.log(outputItem.json());
            const traceback: string[] = metadata?.outputType === 'error' && metadata?.transient && Array.isArray(metadata?.transient)
                ? metadata?.transient
                : (Array.isArray(outputItemJson.stack) ? outputItemJson.stack : [outputItemJson.stack]);
            const html = traceback ? converter.toHtml(traceback.join('\n')) : outputItemJson.message;
            const container = document.createElement('div');
            container.classList.add('cell-output-text');
            container.innerHTML = html;
            element.appendChild(container);
            container.addEventListener('click', e => {
                handleInnerClick(e, _context);
            });
        }
    };
};
