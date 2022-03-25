// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import '../../common/extensions';

import { IWebviewPanel, IWebviewPanelMessageListener } from '../../common/application/types';

/* eslint-disable @typescript-eslint/no-explicit-any */

// This class listens to messages that come from the local Plot Viewer window
export class PlotViewerMessageListener implements IWebviewPanelMessageListener {
    private disposedCallback: () => void;
    private callback: (message: string, payload: any) => void;
    private viewChanged: (panel: IWebviewPanel) => void;

    constructor(
        callback: (message: string, payload: any) => void,
        viewChanged: (panel: IWebviewPanel) => void,
        disposed: () => void
    ) {
        // Save our dispose callback so we remove our history window
        this.disposedCallback = disposed;

        // Save our local callback so we can handle the non broadcast case(s)
        this.callback = callback;

        // Save view changed so we can forward view change events.
        this.viewChanged = viewChanged;
    }

    public async dispose() {
        this.disposedCallback();
    }

    public onMessage(message: string, payload: any) {
        // Send to just our local callback.
        this.callback(message, payload);
    }

    public onChangeViewState(panel: IWebviewPanel) {
        // Forward this onto our callback
        if (this.viewChanged) {
            this.viewChanged(panel);
        }
    }
}
