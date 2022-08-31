// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';
import fastDeepEqual from 'fast-deep-equal';
import * as Redux from 'redux';
import { InteractiveWindowMessages } from '../../../../messageTypes';
import { BaseReduxActionPayload } from '../../../types';

import { IMainState } from '../../interactive-common/mainState';
import { PostOffice } from '../../react-common/postOffice';
import { combineReducers, createQueueableActionMiddleware, QueuableAction } from '../../react-common/reduxUtils';
import { getDefaultSettings } from '../../react-common/settingsReactSide';
import { generateTestState } from '../mainState';
import { isAllowedMessage, postActionToExtension } from './helpers';
import { generatePostOfficeSendReducer } from './postOffice';
import { generateVariableReducer, IVariableState } from './reducers/variables';

// Externally defined function to see if we need to force on test middleware
export declare function forceTestMiddleware(): boolean;

function generateDefaultState(
    skipDefault: boolean,
    testMode: boolean,
    baseTheme: string,
    editable: boolean
): IMainState {
    if (!skipDefault) {
        return generateTestState('', editable);
    } else {
        return {
            // eslint-disable-next-line
            skipDefault,
            testMode,
            baseTheme: baseTheme,
            busy: true,
            submittedText: false,
            currentExecutionCount: 0,
            debugging: false,
            knownDark: false,
            dirty: false,
            isAtBottom: true,
            font: {
                size: 14,
                family: "Consolas, 'Courier New', monospace"
            },
            codeTheme: 'ipython-theme',
            focusPending: 0,
            loaded: false,
            settings: testMode ? getDefaultSettings() : undefined // When testing, we don't send (or wait) for the real settings.
        };
    }
}

function generateMainReducer<M>(
    skipDefault: boolean,
    testMode: boolean,
    baseTheme: string,
    editable: boolean,
    reducerMap: M
): Redux.Reducer<IMainState, QueuableAction<M>> {
    // First create our default state.
    const defaultState = generateDefaultState(skipDefault, testMode, baseTheme, editable);

    // Then combine that with our map of state change message to reducer
    return combineReducers<IMainState, M>(defaultState, reducerMap);
}

function createSendInfoMiddleware(): Redux.Middleware<{}, IStore> {
    return (_store) => (next) => (action) => {
        return next(action);
    };
}

/* TODO: Figure out a better way to do this. Cant use process.env anymore
function createTestLogger() {
    const logFileEnv = process.env.VSC_JUPYTER_WEBVIEW_LOG_FILE;
    if (logFileEnv) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const log4js = require('log4js') as typeof import('log4js');
        const logFilePath = path.isAbsolute(logFileEnv) ? logFileEnv : path.join(EXTENSION_ROOT_DIR, logFileEnv);
        log4js.configure({
            appenders: { reduxLogger: { type: 'file', filename: logFilePath } },
            categories: { default: { appenders: ['reduxLogger'], level: 'debug' } }
        });
        return log4js.getLogger();
    }
}
*/

function createTestMiddleware(transformLoad: () => Promise<void>): Redux.Middleware<{}, IStore> {
    // Make sure all dynamic imports are loaded.
    const transformPromise = transformLoad();

    // eslint-disable-next-line complexity
    return (store) => (next) => (action) => {
        const prevState = store.getState();
        const res = next(action);
        const afterState = store.getState();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const sendMessage = (message: any, payload?: any) => {
            setTimeout(() => {
                transformPromise
                    .then(() => postActionToExtension({ queueAction: store.dispatch }, message, payload))
                    .ignoreErrors();
            });
        };

        // Indicate settings updates
        if (!fastDeepEqual(prevState.main.settings, afterState.main.settings)) {
            // Send async so happens after render state changes (so our enzyme wrapper is up to date)
            sendMessage(InteractiveWindowMessages.SettingsUpdated);
        }

        // Indicate variables complete
        if (
            (!fastDeepEqual(prevState.variables.variables, afterState.variables.variables) ||
                prevState.variables.currentExecutionCount !== afterState.variables.currentExecutionCount ||
                prevState.variables.refreshCount !== afterState.variables.refreshCount) &&
            action.type === InteractiveWindowMessages.GetVariablesResponse
        ) {
            sendMessage(InteractiveWindowMessages.VariablesComplete);
        }

        if (action.type !== 'action.postOutgoingMessage') {
            sendMessage(`DISPATCHED_ACTION_${action.type}`, {});
        }
        return res;
    };
}

function createMiddleWare(
    testMode: boolean,
    postOffice: PostOffice,
    transformLoad: () => Promise<void>
): Redux.Middleware<{}, IStore>[] {
    // Create the middleware that modifies actions to queue new actions
    const queueableActions = createQueueableActionMiddleware();

    // Create the update context middle ware. It handles the 'sendInfo' message that
    // requires sending on every cell vm length change
    const updateContext = createSendInfoMiddleware();

    // Create the test middle ware. It sends messages that are used for testing only
    // Or if testing in UI Test.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const isUITest = (postOffice.acquireApi() as any)?.handleMessage ? true : false;
    let forceOnTestMiddleware = false;
    if (typeof forceTestMiddleware !== 'undefined') {
        forceOnTestMiddleware = forceTestMiddleware();
    }
    const testMiddleware =
        forceOnTestMiddleware || testMode || isUITest ? createTestMiddleware(transformLoad) : undefined;

    /* Fixup this code if you need to debug redux
    // Create the logger if we're not in production mode or we're forcing logging
    const reduceLogMessage = '<payload too large to displayed in logs (at least on CI)>';
    const logger = createLogger({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        stateTransformer: (state: any) => {
            if (!state || typeof state !== 'object') {
                return state;
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const rootState = { ...state } as any;
            if ('main' in rootState && typeof rootState.main === 'object') {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const main = (rootState.main = ({ ...rootState.main } as any) as Partial<IMainState>);
                main.rootCss = reduceLogMessage;
                main.rootStyle = reduceLogMessage;
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                main.settings = reduceLogMessage as any;
            }

            return rootState;
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        actionTransformer: (action: any) => {
            if (!action) {
                return action;
            }
            return action;
        },
        logger: testMode ? createTestLogger() : window.console
    });
    */
    const results: Redux.Middleware<{}, IStore>[] = [];
    results.push(queueableActions);
    results.push(updateContext);
    if (testMiddleware) {
        results.push(testMiddleware);
    }

    return results;
}

export interface IStore {
    main: IMainState;
    variables: IVariableState;
    post: {};
}

export interface IMainWithVariables extends IMainState {
    variableState: IVariableState;
}

export function createStore<M>(
    skipDefault: boolean,
    baseTheme: string,
    testMode: boolean,
    editable: boolean,
    showVariablesOnDebug: boolean,
    variablesStartOpen: boolean,
    reducerMap: M,
    postOffice: PostOffice,
    transformLoad: () => Promise<void>
) {
    // Create reducer for the main react UI
    const mainReducer = generateMainReducer(skipDefault, testMode, baseTheme, editable, reducerMap);

    // Create reducer to pass window messages to the other side
    const postOfficeReducer = generatePostOfficeSendReducer(postOffice);

    // Create another reducer for handling variable state
    const variableReducer = generateVariableReducer(showVariablesOnDebug, variablesStartOpen);

    // Combine these together
    const rootReducer = Redux.combineReducers<IStore>({
        main: mainReducer,
        variables: variableReducer,
        post: postOfficeReducer
    });

    // Create our middleware
    const middleware = createMiddleWare(testMode, postOffice, transformLoad);

    // Use this reducer and middle ware to create a store
    const store = Redux.createStore(rootReducer, Redux.applyMiddleware(...middleware));

    // Make all messages from the post office dispatch to the store, changing the type to
    // turn them into actions.
    postOffice.addHandler({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        handleMessage(message: string, payload?: any): boolean {
            // Double check this is one of our messages. React will actually post messages here too during development
            if (isAllowedMessage(message)) {
                const basePayload: BaseReduxActionPayload = { data: payload };
                store.dispatch({ type: message, payload: basePayload });
            }
            return true;
        }
    });

    return store;
}
