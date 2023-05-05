// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { injectable } from 'inversify';
import { GetServerOptions, IJupyterConnection } from '../../types';
import { IJupyterServerProvider } from '../types';

@injectable()
export class JupyterServerProvider implements IJupyterServerProvider {
    public async getOrCreateServer(_: GetServerOptions): Promise<IJupyterConnection> {
        throw new Error('Invalid Operation in Web');
    }
}
