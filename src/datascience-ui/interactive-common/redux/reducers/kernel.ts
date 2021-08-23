// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { InteractiveWindowMessages } from '../../../../client/datascience/interactive-common/interactiveWindowTypes';
import { IMainState, IServerState } from '../../mainState';
import { postActionToExtension } from '../helpers';
import { CommonActionType, CommonReducerArg } from './types';

export namespace Kernel {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    export function selectKernel(
        arg: CommonReducerArg<CommonActionType | InteractiveWindowMessages, IServerState | undefined>
    ): IMainState {
        postActionToExtension(arg, InteractiveWindowMessages.SelectKernel);

        return arg.prevState;
    }
    export function selectJupyterURI(arg: CommonReducerArg): IMainState {
        postActionToExtension(arg, InteractiveWindowMessages.SelectJupyterServer);

        return arg.prevState;
    }
    export function restartKernel(arg: CommonReducerArg): IMainState {
        postActionToExtension(arg, InteractiveWindowMessages.RestartKernel);

        return arg.prevState;
    }

    export function interruptKernel(arg: CommonReducerArg): IMainState {
        postActionToExtension(arg, InteractiveWindowMessages.Interrupt);

        return arg.prevState;
    }

    export function updateStatus(
        arg: CommonReducerArg<CommonActionType | InteractiveWindowMessages, IServerState | undefined>
    ): IMainState {
        if (arg.payload.data) {
            return {
                ...arg.prevState,
                kernel: {
                    serverName: arg.payload.data.serverName,
                    jupyterServerStatus: arg.payload.data.jupyterServerStatus,
                    kernelName: arg.payload.data.kernelName,
                    language: arg.payload.data.language
                }
            };
        }
        return arg.prevState;
    }
}
