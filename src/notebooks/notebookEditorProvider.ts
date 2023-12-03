// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { injectable } from 'inversify';
import { Uri, NotebookEditor, window, workspace } from 'vscode';
import { Resource } from '../platform/common/types';
import { getResourceType } from '../platform/common/utils';
import { getComparisonKey } from '../platform/vscode-path/resources';
import { IEmbedNotebookEditorProvider, INotebookEditorProvider } from './types';
import { getOSType, OSType } from '../platform/common/utils/platform';

/**
 * Notebook Editor provider used by other parts of DS code.
 * This is an adapter, that takes the VSCode api for editors (did notebook editors open, close save, etc) and
 * then exposes them in a manner we expect - i.e. INotebookEditorProvider.
 * This is also responsible for tracking all notebooks that open and then keeping the VS Code notebook models updated with changes we made to our underlying model.
 * E.g. when cells are executed the results in our model is updated, this tracks those changes and syncs VSC cells with those updates.
 */
@injectable()
export class NotebookEditorProvider implements INotebookEditorProvider {
    private providers: Set<IEmbedNotebookEditorProvider> = new Set();

    registerEmbedNotebookProvider(provider: IEmbedNotebookEditorProvider): void {
        this.providers.add(provider);
    }

    findNotebookEditor(resource: Resource) {
        const key = resource ? getComparisonKey(resource, true) : 'false';
        const notebook =
            getResourceType(resource) === 'notebook'
                ? workspace.notebookDocuments.find((item) => getComparisonKey(item.uri, true) === key)
                : undefined;
        const targetNotebookEditor =
            notebook && window.activeNotebookEditor?.notebook === notebook ? window.activeNotebookEditor : undefined;

        if (targetNotebookEditor) {
            return targetNotebookEditor;
        }

        for (let provider of this.providers) {
            const editor = provider.findNotebookEditor(resource);

            if (editor) {
                return editor;
            }
        }
    }

    get activeNotebookEditor(): NotebookEditor | undefined {
        return (
            this.findNotebookEditor(window.activeNotebookEditor?.notebook.uri) ||
            this.findNotebookEditor(window.activeTextEditor?.document.uri)
        );
    }

    findAssociatedNotebookDocument(uri: Uri) {
        const ignoreCase = getOSType() === OSType.Windows;
        let notebook = workspace.notebookDocuments.find((n) => {
            // Use the path part of the URI. It should match the path for the notebook
            return ignoreCase ? n.uri.path.toLowerCase() === uri.path.toLowerCase() : n.uri.path === uri.path;
        });

        if (notebook) {
            return notebook;
        }

        for (let provider of this.providers) {
            const document = provider.findAssociatedNotebookDocument(uri);

            if (document) {
                return document;
            }
        }
    }
}
