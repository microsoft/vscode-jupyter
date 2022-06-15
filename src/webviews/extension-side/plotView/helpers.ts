// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { NotebookCellOutput } from 'vscode';
import { CellOutputMetadata } from '../../../kernels/execution/helpers';

export function getCellOutputMetadata(cell?: NotebookCellOutput): CellOutputMetadata | undefined {
    if (cell && cell.metadata !== undefined) {
        return cell.metadata as CellOutputMetadata;
    }
}
