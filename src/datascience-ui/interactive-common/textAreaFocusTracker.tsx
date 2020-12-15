// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import * as React from 'react';

export class TextAreaFocusTracker extends React.Component {
    private lastFocusedTextArea: HTMLElement | undefined;
    public componentDidMount() {
        window.addEventListener('focus', () => this.onWindowGotFocus(), false);
        window.addEventListener('blur', () => this.onWindowLostFocus(), false);
    }
    public render() {
        const hiddenStyle: React.CSSProperties = {
            display: 'none'
        };

        return <div id="focus_tracker" style={hiddenStyle} />;
    }

    private onWindowGotFocus() {
        // When the window receives focus (from outside), on a delay attempt to reset our focus
        setTimeout(this.setToLastKnown.bind(this), 0);
    }

    private onWindowLostFocus() {
        // When the window loses focus, remember the lost focus as long as it
        // is a text area
        if (document.activeElement && document.activeElement.nodeName === 'TEXTAREA') {
            this.lastFocusedTextArea = document.activeElement as HTMLElement;
        }
    }

    private setToLastKnown() {
        // Try to set the focus to the last TEXTAREA if we are currently
        // pointing at the BODY. Only do this for the BODY because the
        // only thing that sets the focus to the BODY is the VS code focus code.
        if (
            document.activeElement &&
            document.activeElement.nodeName === document.body.nodeName &&
            this.lastFocusedTextArea
        ) {
            this.lastFocusedTextArea.focus();
        }
    }
}
