// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';
import { inject, injectable } from 'inversify';
import { languages } from 'vscode';
import { IExtensionSingleActivationService } from '../../platform/activation/types';
import { NOTEBOOK_SELECTOR } from '../../platform/common/constants';
import { IDisposableRegistry, IConfigurationService } from '../../platform/common/types';
import { PythonKernelCompletionProvider } from './pythonKernelCompletionProvider';

// Default set of trigger characters for jupyter
const DefaultTriggerCharacters = ['.', '%'];

/**
 * This class basically registers the necessary providers and the like with VSC.
 * I.e. this is where we integrate our stuff with VS Code via their extension endpoints.
 */
@injectable()
export class PythonKernelCompletionProviderRegistration implements IExtensionSingleActivationService {
    constructor(
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(IConfigurationService) private readonly config: IConfigurationService,
        @inject(PythonKernelCompletionProvider) private readonly completionProvider: PythonKernelCompletionProvider
    ) {}
    public async activate(): Promise<void> {
        let triggerChars =
            this.config.getSettings().pythonCompletionTriggerCharacters?.split('') || DefaultTriggerCharacters;

        // Special case. We know that the jupyter autocomplete works in strings, so if strings are available, trigger on / too so
        // we can fill out paths.
        if (triggerChars.includes('"') || triggerChars.includes("'")) {
            triggerChars = [...triggerChars, '/'];
        }
        this.registerCompletionItemProvider(triggerChars);
    }

    private registerCompletionItemProvider(triggerChars: string[]) {
        // Register the jupyter kernel completions for PYTHON cells.
        const disposable = languages.registerCompletionItemProvider(
            NOTEBOOK_SELECTOR,
            this.completionProvider,
            ...triggerChars
        );
        this.disposables.push(disposable);
    }
}
