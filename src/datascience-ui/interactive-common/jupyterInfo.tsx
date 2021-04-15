// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { noop } from 'lodash';
import * as React from 'react';
import { Image, ImageName } from '../react-common/image';
import { getLocString } from '../react-common/locReactSide';
import { IFont, IServerState, ServerStatus } from './mainState';
import { TrustMessage } from './trustMessage';
import { getMaxWidth } from './utils';

export interface IJupyterInfoProps {
    baseTheme: string;
    font: IFont;
    title?: string;
    kernel: IServerState;
    isNotebookTrusted?: boolean;
    shouldShowTrustMessage: boolean;
    selectServer?(): void;
    launchNotebookTrustPrompt?(): void; // Native editor-specific
    selectKernel?(): void;
}

export class JupyterInfo extends React.Component<IJupyterInfoProps> {
    private get isKernelSelectionAllowed() {
        return (
            this.props.isNotebookTrusted !== false &&
            this.props.selectKernel &&
            this.props.kernel.jupyterServerStatus !== ServerStatus.Restarting &&
            this.props.kernel.jupyterServerStatus !== ServerStatus.Starting
        );
    }
    constructor(prop: IJupyterInfoProps) {
        super(prop);
        this.selectKernel = this.selectKernel.bind(this);
        this.selectServer = this.selectServer.bind(this);
    }

    public render() {
        const jupyterServerDisplayName: string = this.props.kernel.serverName;
        const serverTextSize =
            getLocString('DataScience.jupyterServer', 'Jupyter Server').length + jupyterServerDisplayName.length + 4; // plus 4 for the icon
        const displayNameTextSize = this.props.kernel.kernelName.length + this.props.kernel.jupyterServerStatus.length;
        const dynamicFont: React.CSSProperties = {
            fontSize: 'var(--vscode-font-size)', // Use the same font and size as the menu
            fontFamily: 'var(--vscode-font-family)',
            maxWidth: getMaxWidth(serverTextSize + displayNameTextSize + 5) // plus 5 for the line and margins
        };
        const serverTextWidth: React.CSSProperties = {
            maxWidth: getMaxWidth(serverTextSize)
        };
        const displayNameTextWidth: React.CSSProperties = {
            maxWidth: getMaxWidth(displayNameTextSize)
        };
        return (
            <div className="kernel-status" style={dynamicFont}>
                {this.renderScratchTitle()}
                {this.renderTrustMessage()}
                <div className="kernel-status-section kernel-status-server" style={serverTextWidth}>
                {this.renderServerName()}
                    <Image
                        baseTheme={this.props.baseTheme}
                        class="image-button-image kernel-status-icon"
                        image={this.getIcon()}
                        title={this.getStatus()}
                    />
                </div>
                <div className="kernel-status-divider" />
                {this.renderKernelStatus(displayNameTextWidth)}
            </div>
        );
    }

    private renderServerName() {
        const jupyterServerDisplayName: string = this.props.kernel.serverName;
        const serverTextSize =
            getLocString('DataScience.jupyterServer', 'Jupyter Server').length + jupyterServerDisplayName.length + 4; // plus 4 for the icon
        const serverTextWidth: React.CSSProperties = {
            maxWidth: getMaxWidth(serverTextSize)
        };
        const ariaDisabled = this.props.isNotebookTrusted === undefined ? false : this.props.isNotebookTrusted;
        if (this.props.selectServer) {
            return (
                <div
                className="kernel-status-text kernel-status-section-hoverable"
                style={serverTextWidth}
                onClick={this.selectServer}
                role="button"
                aria-disabled={ariaDisabled}
                >
                    {getLocString('DataScience.jupyterServer', 'Jupyter Server')}: {jupyterServerDisplayName}
                </div>
            )
        } else {
            return (
                <div className="kernel-status-section kernel-status-status" style={serverTextWidth} role="label">
                    {getLocString('DataScience.jupyterServer', 'Jupyter Server')}: {jupyterServerDisplayName}
                </div>
            );
        }

    }

    private renderKernelStatus(displayNameTextWidth: React.CSSProperties) {
        const ariaDisabled = this.props.isNotebookTrusted === undefined ? false : this.props.isNotebookTrusted;
        if (this.isKernelSelectionAllowed) {
            return (
                <div
                    className="kernel-status-section kernel-status-section-hoverable kernel-status-status"
                    style={displayNameTextWidth}
                    onClick={this.selectKernel}
                    role="button"
                    aria-disabled={ariaDisabled}
                >
                    {this.props.kernel.kernelName}: {this.props.kernel.jupyterServerStatus}
                </div>
            );
        } else {
            const displayName = this.props.kernel.kernelName ?? getLocString('DataScience.noKernel', 'No Kernel');
            return (
                <div className="kernel-status-section kernel-status-status" style={displayNameTextWidth} role="button">
                    {displayName}: {this.props.kernel.jupyterServerStatus}
                </div>
            );
        }
    }

    private renderTrustMessage() {
        if (this.props.shouldShowTrustMessage && this.props.selectKernel) {
            return (
                <TrustMessage
                    shouldShowTrustMessage={this.props.shouldShowTrustMessage}
                    isNotebookTrusted={this.props.isNotebookTrusted}
                    launchNotebookTrustPrompt={this.props.launchNotebookTrustPrompt}
                />
            );
        }
    }

    private renderScratchTitle() {
        if (this.props.title) {
            return (
                <div className="kernel-status-text">{this.props.title}</div>
            );
        }
    }

    private selectKernel() {
        this.props.selectKernel ? this.props.selectKernel() : noop();
    }
    private getIcon(): ImageName {
        return this.props.kernel.jupyterServerStatus === ServerStatus.NotStarted
            ? ImageName.JupyterServerDisconnected
            : ImageName.JupyterServerConnected;
    }

    private getStatus() {
        return this.props.kernel.jupyterServerStatus === ServerStatus.NotStarted
            ? getLocString('DataScience.disconnected', 'Disconnected')
            : getLocString('DataScience.connected', 'Connected');
    }

    private selectServer(): void {
        this.props.selectServer ? this.props.selectServer() : noop();
    }
}
