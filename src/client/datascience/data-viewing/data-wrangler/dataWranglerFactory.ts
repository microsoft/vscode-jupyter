// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import '../../../common/extensions';
import { WebviewPanel } from 'vscode';
import { inject, injectable } from 'inversify';

import { IAsyncDisposable, IAsyncDisposableRegistry, IDisposableRegistry } from '../../../common/types';
import { IServiceContainer } from '../../../ioc/types';
import { Commands, EditorContexts } from '../../constants';
import { IDataWrangler, IDataWranglerFactory } from './types';
import { ICommandManager } from '../../../common/application/types';
import { ContextKey } from '../../../common/contextKey';
import { debounce } from 'lodash';
import { IDataViewerDataProvider } from '../types';

// Creates Data Wranglers, keeps track of created data wranglers and disposes them when necessary
@injectable()
export class DataWranglerFactory implements IDataWranglerFactory, IAsyncDisposable {
    private knownDataWranglers = new Set<IDataWrangler>();
    private viewContext: ContextKey;

    constructor(
        @inject(IServiceContainer) private serviceContainer: IServiceContainer,
        @inject(IAsyncDisposableRegistry) asyncRegistry: IAsyncDisposableRegistry,
        @inject(IDisposableRegistry) private disposables: IDisposableRegistry,
        @inject(ICommandManager) private commandManager: ICommandManager
    ) {
        asyncRegistry.push(this);
        this.viewContext = new ContextKey(EditorContexts.IsDataWranglerActive, this.commandManager);
        this.disposables.push(
            this.commandManager.registerCommand(Commands.RefreshDataWrangler, this.refreshDataWrangler, this),
            this.commandManager.registerCommand(Commands.UndoDataWrangler, this.undoLastStepDataWrangler, this)
        );
    }

    public async dispose() {
        for (const wrangler of this.knownDataWranglers) {
            wrangler.dispose();
        }
    }

    public async create(
        dataProvider: IDataViewerDataProvider,
        title: string,
        webviewPanel?: WebviewPanel
    ): Promise<IDataWrangler> {
        let result: IDataWrangler | undefined;

        // Create the data wrangler
        const dataWrangler = this.serviceContainer.get<IDataWrangler>(IDataWrangler);
        try {
            // Then load the data.
            this.knownDataWranglers.add(dataWrangler);
            dataWrangler.onDidDisposeDataWrangler(this.updateOpenDataWranglers, this, this.disposables);
            dataWrangler.onDidChangeDataWranglerViewState(this.updateViewStateContext, this, this.disposables);

            // Show the window and the data
            await dataWrangler.showData(dataProvider, title, webviewPanel);
            result = dataWrangler;
        } finally {
            if (!result) {
                // If throw any errors, close the window we opened.
                dataWrangler.dispose();
            }
        }
        return result;
    }

    private updateOpenDataWranglers(wrangler: IDataWrangler) {
        this.knownDataWranglers.delete(wrangler);
    }

    private async updateViewStateContext() {
        // A data wrangler's view state has changed. Look through our known wranglers to see if any are active
        let hasVisiblewrangler = false;
        this.knownDataWranglers.forEach((wrangler) => {
            if (wrangler.visible) {
                hasVisiblewrangler = true;
            }
        });
        await this.viewContext.set(hasVisiblewrangler);
    }

    // Refresh command is mapped to a keybinding. Refresh
    // is expensive. Ensure we debounce refresh requests
    // in case the user is mashing the refresh shortcut.
    private refreshDataWrangler = debounce(() => {
        // Refresh any visible data wranglers. Use visible
        // instead of active because this allows the user
        // to see the data wrangler update without explicitly
        // setting focus to the data wrangler (which would be
        // less convenient)
        for (const wrangler of this.knownDataWranglers) {
            if (wrangler.visible) {
                void wrangler.refreshData();
            }
        }
    }, 1000);

    private undoLastStepDataWrangler = async () => {
        for (const wrangler of this.knownDataWranglers) {
            if (wrangler.visible) {
                await wrangler.removeLatestHistoryItem();
            }
        }
    };
}
