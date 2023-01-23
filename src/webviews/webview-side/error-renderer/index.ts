// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import './styles.css';
import { ActivationFunction, OutputItem, RendererContext } from 'vscode-notebook-renderer';
import ansiToHtml from 'ansi-to-html';
import escape from 'lodash/escape';
import { ErrorRendererMessageType, Localizations } from '../../../messageTypes';
import { createDeferred } from '../../../platform/common/utils/async';

const localizations: Localizations = {
    errorOutputExceedsLinkToOpenFormatString:
        'Output exceeds the <a href={0}>size limit</a>. Open the full output data <a href={1}>in a text editor</a>'
};

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Handle a click on an anchor element.
 * @return {boolean} `true` if the event has been handled, else `false`
 */
function handleInnerClick(target: HTMLAnchorElement, context: RendererContext<any>) {
    if (target.href && context.postMessage) {
        if (target.href.indexOf('file') === 0) {
            context.postMessage({
                message: 'open_link',
                payload: target.href
            });
            return true;
        }
        if (target.href.indexOf('vscode-notebook-cell') === 0) {
            context.postMessage({
                message: 'open_link',
                payload: target.href
            });
            return true;
        } else if (target.href.indexOf('command:workbench.action.openSettings') === 0) {
            // Let the webview handle this.
            return false;
        } else if (target.href.indexOf('command') === 0) {
            context.postMessage({
                message: 'open_link',
                payload: target.href
            });
            return true;
        } else if (target.href.indexOf('https://aka.ms/') === 0) {
            context.postMessage({
                message: 'open_link',
                payload: target.href
            });
            return true;
        }
    }
    return false;
}

if (!String.prototype.format) {
    String.prototype.format = function (this: string) {
        const args = arguments;
        return this.replace(/{(\d+)}/g, (match, number) => (args[number] === undefined ? match : args[number]));
    };
}

function generateViewMoreElement(outputId: string) {
    const container = document.createElement('span');
    const infoInnerHTML = localizations.errorOutputExceedsLinkToOpenFormatString.format(
        `"command:workbench.action.openSettings?["notebook.output.textLineLimit"]"`,
        `"command:workbench.action.openLargeOutput?${outputId}"`
    );
    container.innerHTML = infoInnerHTML;
    return container;
}

function handleANSIOutput(context: RendererContext<any>, converter: ansiToHtml, traceback: string[]) {
    const tracebackElm = document.createElement('div');
    try {
        tracebackElm.innerHTML = traceback
            .map((tb) => {
                try {
                    return tb
                        .split(/\r?\n/)
                        .map((tbLine) => {
                            try {
                                return converter.toHtml(tbLine);
                            } catch (ex) {
                                console.warn(`Failed to convert a traceback line to HTML`, ex);
                                return tbLine;
                            }
                        })
                        .join('\n');
                } catch (ex) {
                    console.warn(`Failed to convert a traceback line to HTML`, ex);
                    return tb;
                }
            })
            .join('\n');
    } catch (ex) {
        console.warn(`Failed to convert traceback to HTML`, ex);
        tracebackElm.innerHTML = traceback.join('\n');
    }
    tracebackElm.addEventListener('click', (e) => {
        const a = e.target as HTMLAnchorElement;
        if (a && a.href && handleInnerClick(a, context)) {
            e.stopImmediatePropagation();
            e.preventDefault();
        }
    });
    return tracebackElm;
}

export function truncatedArrayOfString(
    id: string,
    traceback: string[],
    linesLimit: number,
    container: HTMLElement,
    context: RendererContext<any>,
    converter: ansiToHtml,
    outputItemJson: any
) {
    if (!traceback.some((item) => item.trim().length)) {
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
        return;
    }

    let buffer = traceback.join('\n').split(/\r\n|\n|\r/g);
    let lineCount = buffer.length;

    if (lineCount < linesLimit) {
        container.appendChild(handleANSIOutput(context, converter, traceback));
        return;
    }

    container.appendChild(generateViewMoreElement(id));

    const div = document.createElement('div');
    container.appendChild(div);
    div.appendChild(handleANSIOutput(context, converter, buffer.slice(0, linesLimit - 5)));

    // view more ...
    const viewMoreElm = document.createElement('div');
    viewMoreElm.innerText = '...';
    viewMoreElm.classList.add('error-view-more');
    container.appendChild(viewMoreElm);

    const div2 = document.createElement('div');
    container.appendChild(div2);
    div2.appendChild(handleANSIOutput(context, converter, buffer.slice(lineCount - 5)));
}

export const activate: ActivationFunction = (context) => {
    const latestContext = context as RendererContext<void> & { readonly settings: { readonly lineLimit: number } };
    const loadLocalization = createDeferred();

    if (context.postMessage && context.onDidReceiveMessage) {
        context.postMessage!({
            type: ErrorRendererMessageType.RequestLoadLoc
        });

        context.onDidReceiveMessage((e) => {
            if (e.type === ErrorRendererMessageType.ResponseLoadLoc) {
                Object.assign(localizations, e.payload as Localizations);
                loadLocalization.resolve();
            }
        });
    } else {
        loadLocalization.resolve();
    }

    return {
        renderOutputItem: async (outputItem: OutputItem, element: HTMLElement) => {
            await loadLocalization.promise;
            const lineLimit = latestContext.settings.lineLimit;
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
            // RegEx `<a href='<file path>?line=<linenumber>'>line number or file name</a>`
            // When we escape, the links would be escaped as well.
            // We need to unescape them.
            const fileLinkRegExp = new RegExp(
                /&lt;a href=&#39;(file|vscode-notebook-cell):(.*(?=\?))\?line=(\d*)&#39;&gt;(.*)&lt;\/a&gt;/
            );
            const commandRegEx = new RegExp(/&lt;a href=&#39;command:(.*)&#39;&gt;(.*)&lt;\/a&gt;/);
            const akaMsLinks = new RegExp(/&lt;a href=&#39;https:\/\/aka.ms\/(.*)&#39;&gt;(.*)&lt;\/a&gt;/);
            traceback = traceback.map((line) => {
                let matches: RegExpExecArray | undefined | null;
                while ((matches = fileLinkRegExp.exec(line)) !== null) {
                    if (matches.length === 5) {
                        line = line.replace(
                            matches[0],
                            `<a href='${matches[1]}:${matches[2]}?line=${matches[3]}'>${matches[4]}</a>`
                        );
                    }
                }
                while ((matches = commandRegEx.exec(line)) !== null) {
                    if (matches.length === 3) {
                        line = line.replace(matches[0], `<a href='command:${matches[1]}'>${matches[2]}</a>`);
                    }
                }
                while ((matches = akaMsLinks.exec(line)) !== null) {
                    if (matches.length === 3) {
                        line = line.replace(matches[0], `<a href='https://aka.ms/${matches[1]}'>${matches[2]}</a>`);
                    }
                }
                return line;
            });

            truncatedArrayOfString(outputItem.id, traceback, lineLimit, container, context, converter, outputItemJson);
        }
    };
};
