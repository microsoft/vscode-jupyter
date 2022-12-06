// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

// Stuff common to React and Extensions.

type BaseData = {
    /**
     * Tells us whether this message is incoming for reducer use or
     * whether this is a message that needs to be sent out to extension (from reducer).
     */
    messageDirection?: 'incoming' | 'outgoing';
};

type BaseDataWithPayload<T> = {
    /**
     * Tells us whether this message is incoming for reducer use or
     * whether this is a message that needs to be sent out to extension (from reducer).
     */
    messageDirection?: 'incoming' | 'outgoing';
    data: T;
};

// This forms the base content of every payload in all dispatchers.
export type BaseReduxActionPayload<T = never | undefined> = T extends never
    ? T extends undefined
        ? BaseData
        : BaseDataWithPayload<T>
    : BaseDataWithPayload<T>;
