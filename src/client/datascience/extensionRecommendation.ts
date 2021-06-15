// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { inject, injectable, named } from 'inversify';
import { Memento, NotebookDocument } from 'vscode';
import { IExtensionSyncActivationService } from '../activation/types';
import { IApplicationShell, ICommandManager, IVSCodeNotebook } from '../common/application/types';
import { disposeAllDisposables } from '../common/helpers';
import { GLOBAL_MEMENTO, IDisposable, IDisposableRegistry, IExtensions, IMemento } from '../common/types';
import { Common, DataScience } from '../common/utils/localize';
import { noop } from '../common/utils/misc';
import { sendTelemetryEvent } from '../telemetry';
import { Telemetry } from './constants';
import {
    getKernelConnectionLanguage,
    getLanguageInNotebookMetadata,
    isPythonKernelConnection
} from './jupyter/kernels/helpers';
import { getNotebookMetadata, isJupyterNotebook } from './notebook/helpers/helpers';
import { INotebookControllerManager } from './notebook/types';
import { VSCodeNotebookController } from './notebook/vscodeNotebookController';

const mementoKeyToNeverPromptExtensionAgain = 'JVSC_NEVER_PROMPT_EXTENSIONS_LIST';
const knownExtensionsToRecommend = new Map<string, { displayName: string; extensionLink: string }>([
    [
        'ms-dotnettools.dotnet-interactive-vscode',
        {
            displayName: '.NET Interactive Notebooks Preview',
            extensionLink:
                'https://marketplace.visualstudio.com/items?itemName=ms-dotnettools.dotnet-interactive-vscode'
        }
    ]
]);
const extensionsThatSupportJupyterKernelLanguages = new Map<string, string>([
    ['c#', 'ms-dotnettools.dotnet-interactive-vscode'],
    ['csharp', 'ms-dotnettools.dotnet-interactive-vscode'],
    ['f#', 'ms-dotnettools.dotnet-interactive-vscode'],
    ['fsharp', 'ms-dotnettools.dotnet-interactive-vscode'],
    ['powershell', 'ms-dotnettools.dotnet-interactive-vscode']
]);

export function canOtherExtensionsRunCellsInNotebook(document: NotebookDocument) {
    const language = getLanguageInNotebookMetadata(getNotebookMetadata(document));
    const languages = language ? [language] : document.getCells().map((item) => item.document.languageId);
    if (languages.length === 0) {
        return false;
    }
    return languages.some((item) => extensionsThatSupportJupyterKernelLanguages.has(item));
}

@injectable()
export class ExtensionRecommendationService implements IExtensionSyncActivationService, IDisposable {
    private readonly disposables: IDisposable[] = [];
    private recommendedInSession = new Set<string>();
    constructor(
        @inject(IVSCodeNotebook) private readonly notebook: IVSCodeNotebook,
        @inject(INotebookControllerManager) private readonly controllerManager: INotebookControllerManager,
        @inject(IDisposableRegistry) disposables: IDisposableRegistry,
        @inject(IMemento) @named(GLOBAL_MEMENTO) private readonly globalMemento: Memento,
        @inject(IApplicationShell) private readonly appShell: IApplicationShell,
        @inject(IExtensions) private readonly extensions: IExtensions,
        @inject(ICommandManager) private readonly commandManager: ICommandManager
    ) {
        disposables.push(this);
    }
    public dispose() {
        disposeAllDisposables(this.disposables);
    }

    public activate() {
        this.notebook.onDidOpenNotebookDocument(this.onDidOpenNotebookDocument, this, this.disposables);
        this.controllerManager.onNotebookControllerSelected(this.onNotebookControllerSelected, this, this.disposables);
    }

    private onDidOpenNotebookDocument(notebook: NotebookDocument) {
        if (!isJupyterNotebook(notebook)) {
            return;
        }
        const language = getLanguageInNotebookMetadata(getNotebookMetadata(notebook));
        if (language) {
            this.recommendExtensionForLanguage(language).catch(noop);
        }
    }

    private onNotebookControllerSelected({ controller }: { controller: VSCodeNotebookController }) {
        if (controller.connection.kind !== 'startUsingKernelSpec') {
            return;
        }
        if (isPythonKernelConnection(controller.connection)) {
            return;
        }
        const language = getKernelConnectionLanguage(controller.connection);
        if (language) {
            this.recommendExtensionForLanguage(language).catch(noop);
        }
    }
    private async recommendExtensionForLanguage(language: string) {
        const extensionId = extensionsThatSupportJupyterKernelLanguages.get(language.toLowerCase());
        if (!extensionId || this.extensions.getExtension(extensionId)) {
            return;
        }
        const extensionInfo = knownExtensionsToRecommend.get(extensionId);
        if (!extensionInfo) {
            return;
        }
        if (
            this.globalMemento.get<string[]>(mementoKeyToNeverPromptExtensionAgain, []).includes(extensionId) ||
            this.recommendedInSession.has(extensionId)
        ) {
            return;
        }
        this.recommendedInSession.add(extensionId);
        const message = DataScience.recommendExtensionForNotebookLanguage().format(
            `[${extensionInfo.displayName}](${extensionInfo.extensionLink})`,
            language
        );
        sendTelemetryEvent(Telemetry.RecommendExtension, undefined, { extensionId, action: 'displayed' });
        const selection = await this.appShell.showInformationMessage(
            message,
            Common.bannerLabelYes(),
            Common.bannerLabelNo(),
            Common.doNotShowAgain()
        );
        switch (selection) {
            case Common.bannerLabelYes(): {
                sendTelemetryEvent(Telemetry.RecommendExtension, undefined, { extensionId, action: 'ok' });
                this.commandManager.executeCommand('extension.open', extensionId).then(noop, noop);
                break;
            }
            case Common.bannerLabelNo(): {
                sendTelemetryEvent(Telemetry.RecommendExtension, undefined, { extensionId, action: 'cancel' });
                break;
            }
            case Common.doNotShowAgain(): {
                sendTelemetryEvent(Telemetry.RecommendExtension, undefined, { extensionId, action: 'doNotShowAgain' });
                const list = this.globalMemento.get<string[]>(mementoKeyToNeverPromptExtensionAgain, []);
                if (!list.includes(extensionId)) {
                    list.push(extensionId);
                    await this.globalMemento.update(mementoKeyToNeverPromptExtensionAgain, list);
                }
                break;
            }
            default:
                sendTelemetryEvent(Telemetry.RecommendExtension, undefined, { extensionId, action: 'dismissed' });
        }
    }
}
