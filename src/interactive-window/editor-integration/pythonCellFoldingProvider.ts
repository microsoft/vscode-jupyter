// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import {
    TextDocument,
    FoldingContext,
    CancellationToken,
    ProviderResult,
    FoldingRange,
    FoldingRangeKind,
    FoldingRangeProvider,
    languages
} from 'vscode';
import { IExtensionSyncActivationService } from '../../platform/activation/types';
import { InteractiveInputScheme, NotebookCellScheme, PYTHON_FILE_ANY_SCHEME } from '../../platform/common/constants';
import { IConfigurationService, IExtensionContext } from '../../platform/common/types';
import { IDataScienceCodeLensProvider } from './types';

@injectable()
export class PythonCellFoldingProvider implements IExtensionSyncActivationService, FoldingRangeProvider {
    constructor(
        @inject(IDataScienceCodeLensProvider) private dataScienceCodeLensProvider: IDataScienceCodeLensProvider,
        @inject(IExtensionContext) private extensionContext: IExtensionContext,
        @inject(IConfigurationService) private configurationService: IConfigurationService
    ) {}

    public activate() {
        const enabled = this.configurationService.getSettings().pythonCellFolding;
        if (enabled) {
            this.extensionContext.subscriptions.push(
                languages.registerFoldingRangeProvider([PYTHON_FILE_ANY_SCHEME], this)
            );
        }
    }

    provideFoldingRanges(
        document: TextDocument,
        _context: FoldingContext,
        token: CancellationToken
    ): ProviderResult<FoldingRange[]> {
        if ([NotebookCellScheme, InteractiveInputScheme].includes(document.uri.scheme)) {
            return undefined;
        }

        const codeWatcher = this.dataScienceCodeLensProvider.getCodeWatcher(document);
        if (codeWatcher) {
            const codeLenses = codeWatcher.getCodeLenses();
            if (token.isCancellationRequested || codeLenses.length == 0) {
                return undefined;
            }
            return codeLenses.map((codeLens) => {
                return new FoldingRange(codeLens.range.start.line, codeLens.range.end.line, FoldingRangeKind.Region);
            });
        }
        return undefined;
    }
}
