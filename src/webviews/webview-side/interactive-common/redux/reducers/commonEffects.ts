// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { IGetCssResponse, InteractiveWindowMessages } from '../../../../../platform/messageTypes';
import { IMainState } from '../../../interactive-common/mainState';
import { storeLocStrings } from '../../../react-common/locReactSide';
import { postActionToExtension } from '../helpers';
import { Helpers } from './helpers';
import { CommonActionType, CommonReducerArg, IOpenSettingsAction, LoadIPyWidgetClassLoadAction } from './types';

export namespace CommonEffects {
    export function activate(arg: CommonReducerArg): IMainState {
        return focusPending(arg.prevState);
    }

    export function handleLocInit(arg: CommonReducerArg<CommonActionType, string>): IMainState {
        // Read in the loc strings
        const locJSON = JSON.parse(arg.payload.data);
        storeLocStrings(locJSON);
        return arg.prevState;
    }

    export function handleCss(arg: CommonReducerArg<CommonActionType, IGetCssResponse>): IMainState {
        // Recompute our known dark value from the class name in the body
        // VS code should update this dynamically when the theme changes
        const computedKnownDark = Helpers.computeKnownDark(arg.prevState.settings);

        // We also get this in our response, but computing is more reliable
        // than searching for it.
        const newBaseTheme =
            arg.prevState.knownDark !== computedKnownDark && !arg.prevState.testMode
                ? computedKnownDark
                    ? 'vscode-dark'
                    : 'vscode-light'
                : arg.prevState.baseTheme;

        return {
            ...arg.prevState,
            knownDark: computedKnownDark,
            baseTheme: newBaseTheme
        };
    }

    export function focusPending(prevState: IMainState): IMainState {
        return {
            ...prevState,
            // This is only applicable for interactive window & not native editor.
            focusPending: prevState.focusPending + 1
        };
    }

    export function openSettings(arg: CommonReducerArg<CommonActionType, IOpenSettingsAction>): IMainState {
        postActionToExtension(arg, InteractiveWindowMessages.OpenSettings, arg.payload.data.setting);
        return arg.prevState;
    }

    export function handleLoadIPyWidgetClassSuccess(
        arg: CommonReducerArg<CommonActionType, LoadIPyWidgetClassLoadAction>
    ): IMainState {
        // Make sure to tell the extension so it can log telemetry.
        postActionToExtension(arg, InteractiveWindowMessages.IPyWidgetLoadSuccess, arg.payload.data);
        return arg.prevState;
    }

    // Extension has requested HTML for the webview, get it by ID and send it back as a message
    export function getHTMLByIdRequest(arg: CommonReducerArg<CommonActionType, string>): IMainState {
        const element = document.getElementById(arg.payload.data);

        if (element) {
            postActionToExtension(arg, InteractiveWindowMessages.GetHTMLByIdResponse, element.innerHTML);
        }
        return arg.prevState;
    }
}
