// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { getLocation } from 'jsonc-parser';
import { CancellationToken, CompletionItem, CompletionItemProvider, Position, TextDocument, languages } from 'vscode';
import { IExtensionSyncActivationService } from '../../activation/types';
import { IDisposableRegistry } from '../../common/types';
import * as path from '../../../platform/vscode-path/path';
import { IInterpreterService } from '../contracts';
import { IPythonExtensionChecker } from '../../api/types';
import { getDisplayPath } from '../../common/platform/fs-paths';
import { getPythonEnvDisplayName } from '../helpers';

@injectable()
export class PythonEnvFilterCompletionProvider implements CompletionItemProvider, IExtensionSyncActivationService {
    public readonly supportedWorkspaceTypes = { untrustedWorkspace: false, virtualWorkspace: false };

    constructor(
        @inject(IDisposableRegistry) private readonly disposableRegistry: IDisposableRegistry,
        @inject(IInterpreterService) private readonly interpreters: IInterpreterService,
        @inject(IPythonExtensionChecker) private readonly pythonExtChecker: IPythonExtensionChecker
    ) {}

    public async activate(): Promise<void> {
        this.disposableRegistry.push(languages.registerCompletionItemProvider({ language: 'json' }, this, ',', '['));
        this.disposableRegistry.push(languages.registerCompletionItemProvider({ language: 'jsonc' }, this, ',', '['));
    }

    public async provideCompletionItems(
        document: TextDocument,
        position: Position,
        _token: CancellationToken
    ): Promise<CompletionItem[]> {
        if (
            !this.pythonExtChecker.isPythonExtensionInstalled ||
            !this.pythonExtChecker.isPythonExtensionActive ||
            this.interpreters.resolvedEnvironments.length === 0 ||
            !PythonEnvFilterCompletionProvider.canProvideCompletions(document, position)
        ) {
            return [];
        }

        return this.interpreters.resolvedEnvironments.map((env) => {
            const label = getPythonEnvDisplayName(env);
            const envPath = getDisplayPath(env.uri);
            return {
                label,
                detail: envPath,
                insertText: `"${envPath.replace(/\\/g, '\\\\')}"`,
                filterText: `${label} ${envPath}`
            };
        });
    }

    public static canProvideCompletions(document: TextDocument, position: Position): boolean {
        if (path.basename(document.uri.fsPath) !== 'settings.json') {
            return false;
        }
        const location = getLocation(document.getText(), document.offsetAt(position));
        // Cursor must be inside the configurations array and not in any nested items.
        // Hence path[0] = array, path[1] = array element index.
        return location.path[0] === 'jupyter.kernels.excludePythonEnvironments' && location.path.length === 2;
    }
}
