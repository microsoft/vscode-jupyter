// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';
import { InteractiveWindowMessages, IInteractiveWindowMapping } from '../../../../messageTypes';
import { BaseReduxActionPayload } from '../../../types';
import { IMainState } from '../../interactive-common/mainState';
import { CommonActionType, CommonActionTypeMapping } from '../../interactive-common/redux/reducers/types';
import { ReducerArg, ReducerFunc } from '../../react-common/reduxUtils';

// ActionMapping and reducer functions for the variable view panel

export type VariableViewPanelReducerFunc<T = never | undefined> = ReducerFunc<
    IMainState,
    CommonActionType | InteractiveWindowMessages,
    BaseReduxActionPayload<T>
>;

export type VariableViewPanelReducerArg<T = never | undefined> = ReducerArg<
    IMainState,
    CommonActionType | InteractiveWindowMessages,
    BaseReduxActionPayload<T>
>;

type VariableViewPanelReducerFunctions<T> = {
    [P in keyof T]: T[P] extends never | undefined ? VariableViewPanelReducerFunc : VariableViewPanelReducerFunc<T[P]>;
};

export type IVariableViewPanelActionMapping = VariableViewPanelReducerFunctions<IInteractiveWindowMapping> &
    VariableViewPanelReducerFunctions<CommonActionTypeMapping>;
