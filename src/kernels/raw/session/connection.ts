// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { IRawConnection } from '../../types';

export class RawConnection implements IRawConnection {
    public readonly type = 'raw';
    public readonly localLaunch = true;
    public readonly displayName = '';
}
