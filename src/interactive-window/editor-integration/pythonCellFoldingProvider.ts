// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import {
    TextDocument,
    FoldingContext,
    CancellationToken,
    ProviderResult,
    FoldingRange,
    FoldingRangeKind
} from 'vscode';
import { IDataScienceCodeLensProvider, IPythonCellFoldingProvider } from './types';

@injectable()
export class PythonCellFoldingProvider implements IPythonCellFoldingProvider {
    constructor(
        @inject(IDataScienceCodeLensProvider) private dataScienceCodeLensProvider: IDataScienceCodeLensProvider
    ) {}

    provideFoldingRanges(
        document: TextDocument,
        _context: FoldingContext,
        token: CancellationToken
    ): ProviderResult<FoldingRange[]> {
        const codeWatcher = this.dataScienceCodeLensProvider.getCodeWatcher(document);
        if (codeWatcher) {
            const codeLenses = codeWatcher.getCodeLenses();
            if (token.isCancellationRequested) {
                return undefined;
            }
            return codeLenses.map((codeLens) => {
                return new FoldingRange(codeLens.range.start.line, codeLens.range.end.line, FoldingRangeKind.Region);
            });
        }
        return undefined;
    }
}
