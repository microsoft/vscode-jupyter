/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { DebugProtocol } from 'vscode-debugprotocol';
import { randomBytes } from 'crypto';
import * as nteract from '@nteract/messaging';

/* Interacting with the Python interface that likes lots of snake_cases: */
/* eslint-disable @typescript-eslint/camelcase */

// Augmented types: todo, should we even use nteract/messaging? mostly useful
// for encode/decode right now, and we could get a lot better type information
// than they provide.

//#region jupyter-augments

export type MessageType = nteract.MessageType | 'debug_request' | 'debug_reply' | 'debug_event';

export type JupyterMessageHeader<MT extends MessageType> = Omit<nteract.JupyterMessageHeader, 'msg_type'> & {
    msg_type: MT;
};

export type JupyterMessage<MT extends MessageType = MessageType, C = unknown, Channel = 'shell'> = Omit<
    nteract.JupyterMessage<never, C>,
    'header' | 'channel'
> & {
    header: JupyterMessageHeader<MT>;
    channel: Channel;
};

/**
 * @see https://jupyter-client.readthedocs.io/en/stable/messaging.html?highlight=debug#execute
 */
export type ExecuteRequest = JupyterMessage<
    'execute_request',
    {
        code: string;
        silent: boolean;
        store_history: boolean;
        user_expressions: { [key: string]: string };
        allow_stdin: boolean;
        stop_on_error: boolean;
    },
    'shell'
>;

/**
 * @see https://jupyter-client.readthedocs.io/en/stable/messaging.html?highlight=debug#execute
 */
export type ExecuteReply = JupyterMessage<
    'execute_reply',
    {
        status: string;
        execution_count: number;
    },
    'shell'
>;

/**
 * @see https://jupyter-client.readthedocs.io/en/stable/messaging.html?highlight=debug#update-display-data
 */
export type ExecuteResult = JupyterMessage<
    'execute_result',
    {
        data: { [mimeType: string]: string };
        metadata: { [key: string]: unknown };
    },
    'iopub'
>;

/**
 * @see https://jupyter-client.readthedocs.io/en/stable/messaging.html?highlight=debug#display-data
 */
export type DisplayData = JupyterMessage<
    'display_data',
    {
        data: { [mimeType: string]: string };
        metadata: { [key: string]: unknown };
        transient: { [key: string]: unknown };
    },
    'iopub'
>;

/**
 * @see https://jupyter-client.readthedocs.io/en/stable/messaging.html?highlight=debug#display-data
 */
export type StreamOutput = JupyterMessage<
    'stream',
    {
        stream: 'stdout' | 'stderr';
        text: string;
    },
    'iopub'
>;

/**
 * @see https://jupyter-client.readthedocs.io/en/stable/messaging.html?highlight=debug#display-data
 */
export type ExecutionError = JupyterMessage<
    'error',
    {
        ename: string;
        evalue: string;
        traceback: string[];
    },
    'iopub'
>;

//#endregion jupyter-augments

//#region debugging-messages

// The following declarations are copied from https://github.com/jupyterlab/debugger and show
// the structure of the 3 experimental debug messages that tunnel DAP over the Jupyter protocol.

/**
 * An experimental `'debug_request'` messsage on the `'control'` channel.
 *
 * @hidden
 *
 * #### Notes
 * Debug messages are experimental messages that are not in the official
 * kernel message specification. As such, this function is *NOT* considered
 * part of the public API, and may change without notice.
 */
export type DebugRequestMessage = JupyterMessage<'debug_request', DebugProtocol.Request, 'control'>;

/**
 * An experimental `'debug_request'` messsage on the `'control'` channel.
 *
 * @hidden
 *
 * #### Notes
 * Debug messages are experimental messages that are not in the official
 * kernel message specification. As such, this function is *NOT* considered
 * part of the public API, and may change without notice.
 */
export type DebugReplyMessage = JupyterMessage<'debug_reply', DebugProtocol.Response, 'control'>;

/**
 * An experimental `'debug_event'` message on the `'iopub'` channel
 *
 * @hidden
 *
 * #### Notes
 * Debug messages are experimental messages that are not in the official
 * kernel message specification. As such, this is *NOT* considered
 * part of the public API, and may change without notice.
 */
export type DebugEventMessage = JupyterMessage<'debug_event', DebugProtocol.Event, 'iopub'>;

/**
 * Union of all debug messages.
 */
export type DebugMessage = DebugEventMessage | DebugReplyMessage | DebugRequestMessage;

//#endregion debugging-messages

export type TypedJupyerMessage =
    | DebugEventMessage
    | DebugReplyMessage
    | DebugRequestMessage
    | ExecuteRequest
    | ExecuteReply
    | ExecuteResult
    | DisplayData
    | ExecutionError
    | StreamOutput;

/**
 * Type guard for Jupyter messages. Simply checking msg.header.msg_type
 * is not good enough for TS discriminate between types, for some reason.
 */
export const isMessageType = <T extends MessageType>(
    messageType: T,
    test: TypedJupyerMessage
): test is TypedJupyerMessage & JupyterMessage<T> => test.header.msg_type === messageType;

//#region factories

// this exists in nteract/messaging, but is not exported:
const createHeader = <MT extends MessageType>(messageType: MT): JupyterMessageHeader<MT> => ({
    msg_id: randomBytes(8).toString('hex'),
    date: new Date().toISOString(),
    version: '5.2',
    msg_type: messageType,
    username: 'vscode',
    session: randomBytes(8).toString('hex')
});

const simpleFactory = <T extends TypedJupyerMessage>(type: T['header']['msg_type'], channel: T['channel']) => (
    content: T['content']
): T =>
    ({
        channel,
        header: createHeader(type),
        metadata: {},
        parent_header: {},
        content,
        buffers: new Uint8Array()
    } as T);

export const debugRequest = simpleFactory<DebugRequestMessage>('debug_request', 'control');
export const debugResponse = simpleFactory<DebugReplyMessage>('debug_reply', 'control');

export const executeRequest = (
    code: string,
    options: {
        silent?: boolean;
        storeHistory?: boolean;
        userExpressions?: { [key: string]: string };
        allowStdin?: boolean;
        stopOnError?: boolean;
    } = {}
): ExecuteRequest => ({
    channel: 'shell',
    header: createHeader('execute_request'),
    metadata: {},
    parent_header: {},
    content: {
        code,
        silent: options.silent ?? false,
        store_history: options.storeHistory ?? true,
        user_expressions: options.userExpressions ?? {},
        allow_stdin: options.allowStdin ?? true,
        stop_on_error: options.stopOnError ?? false
    },
    buffers: new Uint8Array()
});

//#endregion
