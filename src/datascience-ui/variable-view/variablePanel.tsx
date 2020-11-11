// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import './variablePanel.css';

import * as React from 'react';

import { SharedMessages } from '../../client/datascience/messages';
import { IJupyterExtraSettings } from '../../client/datascience/types';
import { IVariableViewMapping, VariableViewMessages } from '../../client/datascience/variablesView/types';
import { storeLocStrings } from '../react-common/locReactSide';
import { IMessageHandler, PostOffice } from '../react-common/postOffice';
import { getDefaultSettings } from '../react-common/settingsReactSide';
import { StyleInjector } from '../react-common/styleInjector';

// Our css has to come after in order to override body styles
export interface IVariablePanelProps {
    skipDefault?: boolean;
    baseTheme: string;
    testMode?: boolean;
}

//tslint:disable:no-any
interface IVariablePanelState {
    forceDark?: boolean;
    settings?: IJupyterExtraSettings;
}

export class VariablePanel extends React.Component<IVariablePanelProps, IVariablePanelState>
    implements IMessageHandler {
    private container: React.RefObject<HTMLDivElement> = React.createRef<HTMLDivElement>();
    private postOffice: PostOffice = new PostOffice();

    // tslint:disable-next-line:max-func-body-length
    constructor(props: IVariablePanelProps, _state: IVariablePanelState) {
        super(props);

        this.state = {
            settings: this.props.testMode ? getDefaultSettings() : undefined
        };
    }

    public componentWillMount() {
        // Add ourselves as a handler for the post office
        this.postOffice.addHandler(this);

        // Tell the plot viewer code we have started.
        this.postOffice.sendMessage<IVariableViewMapping>(VariableViewMessages.Started);
    }

    public componentWillUnmount() {
        this.postOffice.removeHandler(this);
        this.postOffice.dispose();
    }

    public render = () => {
        if (this.state.settings) {
            return (
                <div className="variable-panel" role="group" ref={this.container}>
                    <StyleInjector
                        expectingDark={this.props.baseTheme !== 'vscode-light'}
                        settings={this.state.settings}
                        darkChanged={this.darkChanged}
                        postOffice={this.postOffice}
                    />
                    <h1>VARIABLES</h1>
                </div>
            );
        } else {
            return null;
        }
    };

    // tslint:disable-next-line:no-any
    public handleMessage = (msg: string, payload?: any) => {
        switch (msg) {
            case SharedMessages.UpdateSettings:
                this.updateSettings(payload);
                break;

            case SharedMessages.LocInit:
                this.initializeLoc(payload);
                break;

            default:
                break;
        }

        return false;
    };

    private initializeLoc(content: string) {
        const locJSON = JSON.parse(content);
        storeLocStrings(locJSON);
    }

    private updateSettings(content: string) {
        const newSettingsJSON = JSON.parse(content);
        const newSettings = newSettingsJSON as IJupyterExtraSettings;
        this.setState({
            settings: newSettings
        });
    }

    private darkChanged = (newDark: boolean) => {
        // update our base theme if allowed. Don't do this
        // during testing as it will mess up the expected render count.
        if (!this.props.testMode) {
            this.setState({
                forceDark: newDark
            });
        }
    };
}
