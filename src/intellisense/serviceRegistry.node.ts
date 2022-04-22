// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import { inject, injectable, named } from 'inversify';
import { Uri } from 'vscode';
import { CancellationToken, ConfigurationParams, ConfigurationRequest, Disposable, Middleware, ResponseError, _WindowMiddleware } from 'vscode-languageclient';
import { IInteractiveWindowProvider } from '../interactive-window/types';
import { findAssociatedNotebookDocument } from '../notebooks/helpers';
import { INotebookControllerManager, INotebookLanguageClientProvider } from '../notebooks/types';
import { IExtensionSingleActivationService, IExtensionSyncActivationService } from '../platform/activation/types';
import { IPythonApiProvider } from '../platform/api/types';
import { IVSCodeNotebook } from '../platform/common/application/types';
import { STANDARD_OUTPUT_CHANNEL } from '../platform/common/constants';
import { getFilePath } from '../platform/common/platform/fs-paths';
import { IConfigurationService, IOutputChannel } from '../platform/common/types';
import { isThenable } from '../platform/common/utils/async';
import { IInterpreterService } from '../platform/interpreter/contracts';
import { IServiceManager } from '../platform/ioc/types';
import { NotebookCellLanguageService } from './cellLanguageService';
import { NotebookCellBangInstallDiagnosticsProvider } from './diagnosticsProvider';
import { EmptyNotebookCellLanguageService } from './emptyNotebookCellLanguageService';
import { PythonKernelCompletionProvider } from './pythonKernelCompletionProvider';
import { PythonKernelCompletionProviderRegistration } from './pythonKernelCompletionProviderRegistration';

export async function registerTypes(serviceManager: IServiceManager, configService: IConfigurationService, _isDevMode: boolean) {
    serviceManager.addSingleton<PythonKernelCompletionProvider>(
        PythonKernelCompletionProvider,
        PythonKernelCompletionProvider
    ); // Used in tests
    serviceManager.addSingleton<IExtensionSingleActivationService>(
        IExtensionSingleActivationService,
        PythonKernelCompletionProviderRegistration
    );
    serviceManager.addSingleton<IExtensionSyncActivationService>(
        IExtensionSyncActivationService,
        NotebookCellBangInstallDiagnosticsProvider
    );
    serviceManager.addSingleton<NotebookCellLanguageService>(NotebookCellLanguageService, NotebookCellLanguageService);
    serviceManager.addBinding(NotebookCellLanguageService, IExtensionSingleActivationService);
    serviceManager.addSingleton<IExtensionSingleActivationService>(
        IExtensionSingleActivationService,
        EmptyNotebookCellLanguageService
    );

    if (configService.getSettings().pylanceLspNotebooksEnabled) {
        serviceManager.addSingleton<NotebookPythonPathService>(NotebookPythonPathService, NotebookPythonPathService);
        serviceManager.addBinding(NotebookPythonPathService, IExtensionSingleActivationService);
    }

    serviceManager.addSingleton<INotebookLanguageClientProvider>(INotebookLanguageClientProvider, IntellisenseProvider);
}

export class PythonPathMiddleware implements Middleware, Disposable {
    dispose() {}

    public workspace = {
        configuration: async (
            params: ConfigurationParams,
            token: CancellationToken,
            next: ConfigurationRequest.HandlerSignature
        ) => {
            // Handle workspace/configuration requests.
            let settings = next(params, token);
            if (isThenable(settings)) {
                settings = await settings;
            }
            if (settings instanceof ResponseError) {
                return settings;
            }

            // QUESTIONS:
            // How to get NotebookDocument object?
            // Do we need to deal with controllers?
            // Can the python path change? Need to implement this? -- didChangeConfiguration?: (sections: string[] | undefined, next: DidChangeConfigurationSignature) => void;

            const pythonPath = "";

            for (const [i, item] of params.items.entries()) {
                if (item.section === 'python') {
                    (settings[i] as any).pythonPath = pythonPath;
                }
            }

            return settings;
        }
    };
}

@injectable()
export class NotebookPythonPathService implements IExtensionSingleActivationService {
    constructor(
        @inject(IPythonApiProvider) private readonly apiProvider: IPythonApiProvider,
        @inject(IVSCodeNotebook) private readonly notebooks: IVSCodeNotebook,
        @inject(IInteractiveWindowProvider) private readonly interactiveWindowProvider: IInteractiveWindowProvider,
        @inject(INotebookControllerManager) private readonly notebookControllerManager: INotebookControllerManager,
        @inject(IInterpreterService) private readonly interpreterService: IInterpreterService,
        @inject(IOutputChannel) @named(STANDARD_OUTPUT_CHANNEL) private readonly output: IOutputChannel
    ) {
        this.output.appendLine(`NotebookPythonPathService: constructor`);
    }

    public async activate() {
        this.output.appendLine(`NotebookPythonPathService: activate`);
        await this.apiProvider.getApi().then((api) =>
                api.registerJupyterPythonPathFunction(this.jupyterPythonPathFunction)
            );
    }

    private async jupyterPythonPathFunction(uri: Uri): Promise<string | undefined> {
        this.output.appendLine(`NotebookPythonPathService: jupyterPythonPathFunction: ${uri.toString()}`);
        const notebook = findAssociatedNotebookDocument(uri, this.notebooks, this.interactiveWindowProvider);
        const controller = notebook
            ? this.notebookControllerManager.getSelectedNotebookController(notebook)
            : undefined;

        const interpreter = controller ? controller.connection.interpreter : await this.interpreterService.getActiveInterpreter(uri);
        if (!interpreter){return undefined;}

        const pythonPath = getFilePath(interpreter.uri);
        return pythonPath;
    }
}
