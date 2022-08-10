// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { injectable } from 'inversify';
import { CompletionItemProvider, DocumentSelector, languages } from 'vscode';
import { Disposable } from 'vscode-jsonrpc';
import { ILanguageService } from './types';

/**
 * Wrapper around vscode's languages namespace.
 */
@injectable()
export class LanguageService implements ILanguageService {
    public registerCompletionItemProvider(
        selector: DocumentSelector,
        provider: CompletionItemProvider,
        ...triggerCharacters: string[]
    ): Disposable {
        return languages.registerCompletionItemProvider(selector, provider, ...triggerCharacters);
    }
}
