// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import './styles.css';
import { ActivationFunction, OutputItem, RendererContext } from 'vscode-notebook-renderer';
import ansiToHtml from 'ansi-to-html';
import escape from 'lodash/escape';

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
            const outputItemJson = outputItem.json();

            const container = document.createElement('div');
            element.appendChild(container);
            container.classList.add('cell-output-text');

            const metadata: any = outputItem.metadata;
            let traceback: string[] =
                metadata?.outputType === 'error' && metadata?.transient && Array.isArray(metadata?.transient)
                    ? metadata?.transient
                    : Array.isArray(outputItemJson.stack)
                    ? outputItemJson.stack.map((item: string) => escape(item))
                    : [escape(outputItemJson.stack)];

            // there is traceback
            // Fix links in tracebacks.
            // RegEx `<a href='<file path>?line=<linenumber>'>line number</a>`
            // When we escape, the links would be escaped as well.
            // We need to unescape them.
            const regExp = new RegExp(/&lt;a href=&#39;file:(.*(?=\?))\?line=(\d*)&#39;&gt;(\d*)&lt;\/a&gt;/);
            traceback = traceback.map((line) => {
                let matches: RegExpExecArray | undefined | null;
                while ((matches = regExp.exec(line)) !== null) {
                    if (matches.length === 4) {
                        line = line.replace(
                            matches[0],
                            `<a href='file:${matches[1]}?line=${matches[2]}'>${matches[3]}<a>`
                        );
                    }
                }
                return line;
            });

            const html = traceback.some((item) => item.trim().length)
                ? converter.toHtml(traceback.join('\n'))
                : undefined;

            if (html) {
                const traceback = document.createElement('div');
                container.appendChild(traceback);
                traceback.innerHTML = html;
                traceback.addEventListener('click', (e) => {
                    handleInnerClick(e, _context);
                });
            } else {
                const header = document.createElement('div');
                const headerMessage =
                    outputItemJson.name && outputItemJson.message
                        ? `${outputItemJson.name}: ${outputItemJson.message}`
                        : outputItemJson.name || outputItemJson.message;

                if (headerMessage) {
                    header.classList.add('output-error-header');
                    header.innerText = headerMessage;
                    container.appendChild(header);
                } else {
                    // We can't display nothing (other extesnsions might have differen formats of errors, like Julia, .NET, etc).
                    const tbEle = document.createElement('div');
                    container.appendChild(tbEle);
                    tbEle.innerHTML = traceback.join('<br>');
                }
            }
        }
    };
};
