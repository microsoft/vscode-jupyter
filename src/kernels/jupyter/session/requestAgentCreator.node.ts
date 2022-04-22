// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import { Agent as HttpsAgent } from 'https';
import { injectable } from 'inversify';
import { IJupyterRequestAgentCreator } from '../types';

@injectable()
export class RequestAgentCreator implements IJupyterRequestAgentCreator {
    createHttpRequestAgent() {
        new HttpsAgent({ rejectUnauthorized: false });
    }
}
