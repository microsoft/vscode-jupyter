// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';
import { InteractiveWindowMessages } from '../../../../../messageTypes';
import { IMainState } from '../../../interactive-common/mainState';
import { storeLocStrings } from '../../../react-common/locReactSide';
import { postActionToExtension } from '../helpers';
import { CommonActionType, CommonReducerArg } from './types';

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

    export function focusPending(prevState: IMainState): IMainState {
        return {
            ...prevState,
            // This is only applicable for interactive window & not native editor.
            focusPending: prevState.focusPending + 1
        };
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
