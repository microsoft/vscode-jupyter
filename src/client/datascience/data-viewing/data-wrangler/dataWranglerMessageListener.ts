// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import '../../../common/extensions';

import { IWebviewPanelMessageListener } from '../../../common/application/types';
import { DataViewerMessageListener } from '../dataViewerMessageListener';

/* eslint-disable @typescript-eslint/no-explicit-any */

// This class listens to messages that come from the local Data Explorer window
export class DataWranglerMessageListener extends DataViewerMessageListener implements IWebviewPanelMessageListener {}
