// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { NotebookDocument } from 'vscode';

export const IPlotSaveHandler = Symbol('IPlotSaveHandler');

export interface IPlotSaveHandler {
    savePlot(notebook: NotebookDocument, outputId: string, mimeType: string): Promise<void>;
}
