// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { IInteractiveWindow, IInteractiveWindowProvider } from '../client/datascience/types';
import { window } from 'vscode';
import { NotebookCellScheme } from '../client/common/constants';

export function getActiveInteractiveWindow(
    interactiveWindowProvider: IInteractiveWindowProvider
): IInteractiveWindow | undefined {
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
