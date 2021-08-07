// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { InteractiveWindowMessages } from '../../../../client/datascience/interactive-common/interactiveWindowTypes';
import { CssMessages } from '../../../../client/datascience/messages';
import { IExternalCommandFromWebview } from '../../../../client/datascience/types';
import { IMainState } from '../../mainState';
import { postActionToExtension } from '../helpers';
import {
    CommonActionType,
    CommonReducerArg,
    ILinkClickAction,
    ISendCommandAction,
    IShowDataViewerAction
} from './types';

// These are all reducers that don't actually change state. They merely dispatch a message to the other side.
export namespace Transfer {
    export function showDataViewer(arg: CommonReducerArg<CommonActionType, IShowDataViewerAction>): IMainState {
        postActionToExtension(arg, InteractiveWindowMessages.ShowDataViewer, {
            variable: arg.payload.data.variable,
            columnSize: arg.payload.data.columnSize
        });
        return arg.prevState;
    }

    export function sendCommand(arg: CommonReducerArg<CommonActionType, ISendCommandAction>): IMainState {
        postActionToExtension(arg, InteractiveWindowMessages.NativeCommand, {
            command: arg.payload.data.command
        });
        return arg.prevState;
    }

    export function linkClick(arg: CommonReducerArg<CommonActionType, ILinkClickAction>): IMainState {
        if (arg.payload.data.href.startsWith('data:image/png')) {
            postActionToExtension(arg, InteractiveWindowMessages.SavePng, arg.payload.data.href);
        } else {
            postActionToExtension(arg, InteractiveWindowMessages.OpenLink, arg.payload.data.href);
        }
        return arg.prevState;
    }

    export function started(arg: CommonReducerArg): IMainState {
        // Send all of our initial requests
        postActionToExtension(arg, InteractiveWindowMessages.Started);
        postActionToExtension(arg, CssMessages.GetCssRequest, { isDark: arg.prevState.baseTheme !== 'vscode-light' });
        return arg.prevState;
    }

    // Variable view is basically a modified / reduced version of IW / Notebooks, different started function here to skip MonacoTheme request
    export function variableViewStarted(arg: CommonReducerArg): IMainState {
        // Send all of our initial requests
        postActionToExtension(arg, InteractiveWindowMessages.Started);
        postActionToExtension(arg, CssMessages.GetCssRequest, { isDark: arg.prevState.baseTheme !== 'vscode-light' });
        return arg.prevState;
    }

    export function executeExternalCommand(
        arg: CommonReducerArg<CommonActionType, IExternalCommandFromWebview>
    ): IMainState {
        postActionToExtension(arg, InteractiveWindowMessages.ExecuteExternalCommand, arg.payload.data);

        return {
            ...arg.prevState
        };
    }
}
