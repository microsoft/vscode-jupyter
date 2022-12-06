// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';
import { injectable } from 'inversify';
import { BaseBackingFileCreator } from './backingFileCreator.base';

@injectable()
export class BackingFileCreator extends BaseBackingFileCreator {}
