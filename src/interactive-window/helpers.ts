// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { NotebookCell, window } from 'vscode';
import { NotebookCellScheme } from '../platform/common/constants';
import { IJupyterSettings } from '../platform/common/types';
import { removeLinesFromFrontAndBackNoConcat, appendLineFeed } from '../webviews/webview-side/common';
import { uncommentMagicCommands } from './editor-integration/cellFactory';
import { CellMatcher } from './editor-integration/cellMatcher';
import { InteractiveCellMetadata } from './editor-integration/types';
import { IInteractiveWindowProvider, IInteractiveWindow } from './types';

export function getInteractiveCellMetadata(cell: NotebookCell): InteractiveCellMetadata | undefined {
    if (cell.metadata.interactive !== undefined) {
        return cell.metadata as InteractiveCellMetadata;
    }
}
export function getActiveInteractiveWindow(
    interactiveWindowProvider: IInteractiveWindowProvider | undefined
): IInteractiveWindow | undefined {
    if (!interactiveWindowProvider) {
        return;
    }
    if (interactiveWindowProvider.activeWindow) {
        return interactiveWindowProvider.activeWindow;
    }
    if (window.activeTextEditor === undefined) {
        return;
    }
    const textDocumentUri = window.activeTextEditor.document.uri;
    if (textDocumentUri.scheme !== NotebookCellScheme) {
        return interactiveWindowProvider.get(textDocumentUri);
    }
}

/**
 * Given a string representing Python code, return a processed
 * code string suitable for adding to a NotebookCell and executing.
 * @param code The code string text from a #%% code cell to be executed.
 */
export function generateInteractiveCode(code: string, settings: IJupyterSettings, cellMatcher: CellMatcher): string {
    const lines = code.splitLines({ trim: false, removeEmptyEntries: false });

    // Remove the first marker
    const withoutFirstMarker = cellMatcher.stripFirstMarkerNoConcat(lines);
    // Skip leading and trailing lines
    const noLeadingOrTrailing = removeLinesFromFrontAndBackNoConcat(withoutFirstMarker);
    // Uncomment magics while adding linefeeds
    const withMagicsAndLinefeeds = appendLineFeed(
        noLeadingOrTrailing,
        '\n',
        settings.magicCommandsAsComments ? uncommentMagicCommands : undefined
    );

    return withMagicsAndLinefeeds.join('');
}
