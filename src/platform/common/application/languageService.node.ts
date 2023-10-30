// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { injectable } from 'inversify';
import { CompletionItemProvider, DocumentSelector, languages } from 'vscode';
import { ILanguageService } from './types';
import { IDisposable } from '../types';

/**
 * Wrapper around vscode's languages namespace.
 */
@injectable()
export class LanguageService implements ILanguageService {
    public registerCompletionItemProvider(
        selector: DocumentSelector,
        provider: CompletionItemProvider,
        ...triggerCharacters: string[]
    ): IDisposable {
        return languages.registerCompletionItemProvider(selector, provider, ...triggerCharacters);
    }
}
