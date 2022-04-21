// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import { inject } from 'inversify';
import { CancellationToken, ConfigurationParams, ConfigurationRequest, Disposable, Middleware, ResponseError, _WindowMiddleware } from 'vscode-languageclient';
import { INotebookLanguageClientProvider } from '../notebooks/types';
import { IExtensionSingleActivationService, IExtensionSyncActivationService } from '../platform/activation/types';
import { IPythonApiProvider } from '../platform/api/types';
import { getFilePath } from '../platform/common/platform/fs-paths';
import { IConfigurationService } from '../platform/common/types';
import { isThenable } from '../platform/common/utils/async';
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

    if (!configService.getSettings().pylanceLspNotebooksEnabled) {
        serviceManager.addSingleton<INotebookLanguageClientProvider>(INotebookLanguageClientProvider, IntellisenseProvider);
    }
    else
    {
        // QUESTIONS:]
        // Better way to kick off async call to middleware injection API?
        // If this is the right place to do this, better way to get experiment status?
        // Why do we need to inject middleware rather than having Python extension create it via vscode-jupyter-lsp-middleware? Maybe that package can't calculate path on its own?
        serviceManager.addSingleton<NotebookPythonPathService>(NotebookPythonPathService, NotebookPythonPathService);
        await serviceManager.get<NotebookPythonPathService>(NotebookPythonPathService).initialize();
    }
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
            // const interpreter = controller?.connection.interpreter || (await this.interpreterService.getActiveInterpreter(n.uri)); // <-- n is NotebookDocument
            // const pythonPath = getFilePath(interpreter.uri);
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

class NotebookPythonPathService {
    constructor(
        @inject(IPythonApiProvider) private readonly apiProvider: IPythonApiProvider,
    ) {}

    public async initialize() {
        await this.apiProvider.getApi().then((api) =>
                api.injectMiddlewareHook(new PythonPathMiddleware())
            );
    }
}
