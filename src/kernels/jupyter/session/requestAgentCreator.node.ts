// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Agent as HttpsAgent } from 'https';
import { injectable } from 'inversify';
import { IJupyterRequestAgentCreator } from '../types';

@injectable()
export class RequestAgentCreator implements IJupyterRequestAgentCreator {
    createHttpRequestAgent() {
        return new HttpsAgent({ rejectUnauthorized: false }); // CodeQL [SM03616] User has been prompted at this point whether to allow making requests to http servers with invalid certificates.
    }
}
