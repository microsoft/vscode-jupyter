// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { IVariableViewProvider } from '../../../webviews/extension-side/variablesView/types';
import { VariableView } from '../../../webviews/extension-side/variablesView/variableView';

export interface ITestVariableViewProvider extends IVariableViewProvider {
    readonly activeVariableView: Promise<VariableView>;
}
