// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import * as React from 'react';

import { CssMessages, IGetCssResponse, SharedMessages } from '../../client/datascience/messages';
import { IJupyterExtraSettings } from '../../client/datascience/types';
import { IMessageHandler, PostOffice } from './postOffice';
import { detectBaseTheme } from './themeDetector';

export interface IStyleInjectorProps {
    expectingDark: boolean;
    postOffice: PostOffice;
    settings: IJupyterExtraSettings;
    darkChanged?(newDark: boolean): void;
    onReady?(): void;
}

interface IStyleInjectorState {
    rootCss?: string;
    theme?: string;
    knownDark?: boolean;
}

export class StyleInjector extends React.Component<IStyleInjectorProps, IStyleInjectorState>
    implements IMessageHandler {
    constructor(props: IStyleInjectorProps) {
        super(props);
        this.state = { rootCss: undefined, theme: undefined };
    }

    public componentWillMount() {
        // Add ourselves as a handler for the post office
        this.props.postOffice.addHandler(this);
    }

    public componentWillUnmount() {
        // Remove ourselves as a handler for the post office
        this.props.postOffice.removeHandler(this);
    }

    public componentDidMount() {
        if (!this.state.rootCss) {
            // Set to a temporary value.
            this.setState({ rootCss: ' ' });
            this.props.postOffice.sendUnsafeMessage(CssMessages.GetCssRequest, { isDark: this.props.expectingDark });
        }
    }

    public render() {
        return (
            <div className="styleSetter">
                <style>{this.state.rootCss}</style>
                {this.props.children}
            </div>
        );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public handleMessage = (msg: string, payload?: any): boolean => {
        switch (msg) {
            case CssMessages.GetCssResponse:
                this.handleCssResponse(payload);
                break;

            case SharedMessages.UpdateSettings:
                this.updateSettings(payload);
                break;

            default:
                break;
        }

        return true;
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private handleCssResponse(payload?: any) {
        const response = payload as IGetCssResponse;
        if (response && response.css) {
            // Recompute our known dark value from the class name in the body
            // VS code should update this dynamically when the theme changes
            const computedKnownDark = this.computeKnownDark();

            // We also get this in our response, but computing is more reliable
            // than searching for it.

            if (this.state.knownDark !== computedKnownDark && this.props.darkChanged) {
                this.props.darkChanged(computedKnownDark);
            }

            this.setState(
                {
                    rootCss: response.css,
                    theme: response.theme,
                    knownDark: computedKnownDark
                },
                this.props.onReady
            );
        }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private updateSettings(payload: any) {
        if (payload) {
            const newSettings = JSON.parse(payload as string);
            const dsSettings = newSettings as IJupyterExtraSettings;
            if (dsSettings && dsSettings.extraSettings && dsSettings.extraSettings.theme !== this.state.theme) {
                // User changed the current theme. Rerender
                this.props.postOffice.sendUnsafeMessage(CssMessages.GetCssRequest, { isDark: this.computeKnownDark() });
            }
        }
    }

    private computeKnownDark(): boolean {
        const ignore = this.props.settings.ignoreVscodeTheme ? true : false;
        const baseTheme = ignore ? 'vscode-light' : detectBaseTheme();
        return baseTheme !== 'vscode-light';
    }
}
