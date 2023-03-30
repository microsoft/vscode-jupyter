// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as Redux from 'redux';
import { IInteractiveWindowMapping } from '../../../../messageTypes';

import { PostOffice } from '../../react-common/postOffice';
import { isAllowedAction, unwrapPostableAction } from './helpers';
import { CommonActionType } from './reducers/types';

export function generatePostOfficeSendReducer(postOffice: PostOffice): Redux.Reducer<{}, Redux.AnyAction> {
    // eslint-disable-next-line
    return function (_state: {} | undefined, action: Redux.AnyAction): {} {
        if (isAllowedAction(action)) {
            // Make sure a valid message
            if (action.type === CommonActionType.PostOutgoingMessage) {
                const { type, payload } = unwrapPostableAction(action.payload);
                // Just post this to the post office.
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                postOffice.sendMessage<IInteractiveWindowMapping>(type, payload?.data as any);
            }
        }

        // We don't modify the state.
        return {};
    };
}
