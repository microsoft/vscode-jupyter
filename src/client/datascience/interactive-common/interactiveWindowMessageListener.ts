// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import '../../common/extensions';

import { IWebviewPanel, IWebviewPanelMessageListener } from '../../common/application/types';
import { InteractiveWindowRemoteMessages } from './interactiveWindowTypes';

/* eslint-disable @typescript-eslint/no-explicit-any */

// This class listens to messages that come from the local Interactive window
export class InteractiveWindowMessageListener implements IWebviewPanelMessageListener {
    private disposedCallback: () => void;
    private callback: (message: string, payload: any) => void;
    private viewChanged: (panel: IWebviewPanel) => void;
    constructor(
        callback: (message: string, payload: any) => void,
        viewChanged: (panel: IWebviewPanel) => void,
        disposed: () => void
    ) {
        // Save our dispose callback so we remove our interactive window
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
        // We received a message from the local webview. Broadcast it to everybody if it's a remote message
        if (InteractiveWindowRemoteMessages.indexOf(message) >= 0) {
            //
        } else {
            // Send to just our local callback.
            this.callback(message, payload);
        }
    }

    public onChangeViewState(panel: IWebviewPanel) {
        // Forward this onto our callback
        this.viewChanged(panel);
    }
}
