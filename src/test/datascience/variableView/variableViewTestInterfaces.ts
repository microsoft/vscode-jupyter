// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import { IVariableViewProvider } from '../../../client/datascience/variablesView/types';
import { VariableView } from '../../../client/datascience/variablesView/variableView';

export interface ITestVariableViewProvider extends IVariableViewProvider {
    readonly activeVariableView: Promise<VariableView>;
}
