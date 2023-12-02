// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { injectable } from 'inversify';
import { ExportUtilBase } from './exportUtil';

/**
 * Export utilities that are common to node/web
 */
@injectable()
export class ExportUtil extends ExportUtilBase {}
