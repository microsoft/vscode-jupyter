import * as React from 'react';
import { DataWranglerCommands } from '../../../../client/datascience/data-viewing/data-wrangler/types';
import { getLocString } from '../../../react-common/locReactSide';

interface IProps {
    handleRefreshRequest(): void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    submitCommand(data: { command: string; args: any }): void;
    onToggleFilter(): void;
}

interface IToolbarButtonProps {
    title: string;
    command: DataWranglerCommands;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    args: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    submitCommand(data: { command: string; args: any }): void;
}
export class ToolbarButton extends React.PureComponent<IToolbarButtonProps> {
    render() {
        return (
            <div
                style={{ paddingRight: '15px', display: 'inline-block', cursor: 'pointer' }}
                onClick={() => this.props.submitCommand({ command: this.props.command, args: this.props.args })}
            >
                <div
                    className="codicon codicon-export codicon-button"
                    style={{ verticalAlign: 'middle' }}
                    title={this.props.title}
                />
                <span style={{ verticalAlign: 'middle', paddingLeft: '4px', paddingBottom: '4px' }}>
                    {this.props.title}
                </span>
            </div>
        );
    }
}
export class Toolbar extends React.PureComponent<IProps> {
    render() {
        return (
            <div
                style={{
                    borderBottom: '1px solid var(--vscode-editor-inactiveSelectionBackground)',
                    paddingTop: '4px',
                    paddingBottom: '6px',
                    paddingLeft: '5px',
                    display: 'flex',
                    flexDirection: 'row',
                    fontFamily: 'var(--vscode-font-family)',
                    fontSize: 'var(--vscode-font-size)',
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    fontWeight: 'var(--vscode-font-weight)' as any,
                    justifyContent: 'start'
                }}
            >
                <ToolbarButton
                    submitCommand={this.props.submitCommand}
                    title={getLocString('DataScience.dataWranglerExportCsv', 'Export to CSV')}
                    command={DataWranglerCommands.ExportToCsv}
                    args={null}
                />
                <ToolbarButton
                    submitCommand={this.props.submitCommand}
                    title={getLocString('DataScience.dataWranglerExportPython', 'Open as Python script')}
                    command={DataWranglerCommands.ExportToPythonScript}
                    args={null}
                />
            </div>
        );
    }
}
