// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import * as React from 'react';
import { Store } from 'redux';
import {
    ILoadIPyWidgetClassFailureAction,
    LoadIPyWidgetClassLoadAction,
    NotifyIPyWidgetWidgetVersionNotSupportedAction,
    SharedMessages
} from '../../../../messageTypes';
import { IJupyterExtraSettings } from '../../../../platform/webviews/types';
import { CommonAction, CommonActionType } from '../../interactive-common/redux/reducers/types';
import { IStore } from '../../interactive-common/redux/store';
import { PostOffice } from '../../react-common/postOffice';
import { WidgetManager } from '../common/manager';
import { ScriptManager } from '../common/scriptManager';

type Props = {
    postOffice: PostOffice;
    widgetContainerId: string;
    store: Store<IStore> & { dispatch: unknown };
};

export class WidgetManagerComponent extends React.Component<Props> {
    private readonly widgetManager: WidgetManager;
    private widgetsCanLoadFromCDN: boolean = false;
    private readonly scriptManager: ScriptManager;
    constructor(props: Props) {
        super(props);
        this.scriptManager = new ScriptManager(props.postOffice);
        this.scriptManager.onWidgetLoadError(this.handleLoadError.bind(this));
        this.scriptManager.onWidgetLoadSuccess(this.handleLoadSuccess.bind(this));
        this.scriptManager.onWidgetVersionNotSupported(this.handleUnsupportedWidgetVersion.bind(this));
        this.widgetManager = new WidgetManager(
            document.getElementById(this.props.widgetContainerId)!,
            this.props.postOffice,
            this.scriptManager.getScriptLoader()
        );

        props.postOffice.addHandler({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            handleMessage: (type: string, payload?: any) => {
                if (type === SharedMessages.UpdateSettings) {
                    const settings = JSON.parse(payload) as IJupyterExtraSettings;
                    this.widgetsCanLoadFromCDN = settings.widgetScriptSources.length > 0;
                }
                return true;
            }
        });
    }
    public override render() {
        return null;
    }
    public override componentWillUnmount() {
        this.widgetManager.dispose();
    }
    private createLoadSuccessAction(
        className: string,
        moduleName: string,
        moduleVersion: string
    ): CommonAction<LoadIPyWidgetClassLoadAction> {
        return {
            type: CommonActionType.LOAD_IPYWIDGET_CLASS_SUCCESS,
            payload: { messageDirection: 'incoming', data: { className, moduleName, moduleVersion } }
        };
    }

    private createLoadErrorAction(
        className: string,
        moduleName: string,
        moduleVersion: string,
        isOnline: boolean,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        error: any,
        timedout: boolean
    ): CommonAction<ILoadIPyWidgetClassFailureAction> {
        return {
            type: CommonActionType.LOAD_IPYWIDGET_CLASS_FAILURE,
            payload: {
                messageDirection: 'incoming',
                data: {
                    className,
                    moduleName,
                    moduleVersion,
                    isOnline,
                    timedout,
                    error,
                    cdnsUsed: this.widgetsCanLoadFromCDN
                }
            }
        };
    }
    private createWidgetVersionNotSupportedErrorAction(
        moduleName: 'qgrid',
        moduleVersion: string
    ): CommonAction<NotifyIPyWidgetWidgetVersionNotSupportedAction> {
        return {
            type: CommonActionType.IPYWIDGET_WIDGET_VERSION_NOT_SUPPORTED,
            payload: {
                messageDirection: 'incoming',
                data: {
                    moduleName,
                    moduleVersion
                }
            }
        };
    }
    private async handleLoadError(data: {
        className: string;
        moduleName: string;
        moduleVersion: string;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        error: any;
        timedout?: boolean;
        isOnline: boolean;
    }) {
        this.props.store.dispatch(
            this.createLoadErrorAction(
                data.className,
                data.moduleName,
                data.moduleVersion,
                data.isOnline,
                data.error,
                !!data.timedout
            )
        );
    }

    private handleUnsupportedWidgetVersion(data: { moduleName: 'qgrid'; moduleVersion: string }) {
        this.props.store.dispatch(this.createWidgetVersionNotSupportedErrorAction(data.moduleName, data.moduleVersion));
    }

    private handleLoadSuccess(data: { className: string; moduleName: string; moduleVersion: string }) {
        this.props.store.dispatch(this.createLoadSuccessAction(data.className, data.moduleName, data.moduleVersion));
    }
}
