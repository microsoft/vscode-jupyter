import * as React from 'react';
import { DataWranglerCommands } from '../../../../client/datascience/data-viewing/data-wrangler/types';

interface IProps {
    handleRefreshRequest(): void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    submitCommand(data: { command: string; args: any }): void;
    onToggleFilter(): void;
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
                    // fontWeight: 'var(--vscode-font-weight)',
                    justifyContent: 'start'
                }}
            >
                <div
                    style={{ paddingRight: '15px', display: 'inline-block', cursor: 'pointer' }}
                    onClick={() => this.props.submitCommand({ command: DataWranglerCommands.ExportToCsv, args: null })}
                >
                    <div
                        className="codicon codicon-export codicon-button"
                        style={{ verticalAlign: 'middle' }}
                        title="Export to CSV"
                    />
                    <span style={{ verticalAlign: 'middle', paddingLeft: '4px', paddingBottom: '4px' }}>
                        Export CSV
                    </span>
                </div>
                <div
                    style={{ paddingRight: '15px', display: 'inline-block', cursor: 'pointer' }}
                    onClick={() => this.props.submitCommand({ command: DataWranglerCommands.ExportToPythonScript, args: null })}
                >
                    <div
                        className="codicon codicon-go-to-file codicon-button"
                        style={{ verticalAlign: 'middle' }}
                        title="Open as Python script"
                    />
                    <span style={{ verticalAlign: 'middle', paddingLeft: '4px', paddingBottom: '4px' }}>
                        Open as Python script
                    </span>
                    {/* <div className="codicon codicon-notebook codicon-button" title="Open in Notebook" /> */}
                </div>
                {/* <div
                    style={{ paddingRight: '15px', display: 'inline-block', cursor: 'pointer' }}
                    onClick={() => this.props.submitCommand({ command: DataWranglerCommands.ExportToNotebook, args: null })}
                >
                    <div
                        className="codicon codicon-notebook codicon-button"
                        style={{ verticalAlign: 'middle' }}
                        title="Open as Jupyter notebook"
                    />
                    <span style={{ verticalAlign: 'middle', paddingLeft: '4px', paddingBottom: '4px' }}>
                        Open as Jupyter notebook
                    </span>
                    {/* <div className="codicon codicon-notebook codicon-button" title="Open in Notebook" />
                </div> */}
                {/*
                    <div
                        className="codicon codicon-window codicon-button"
                        onClick={() => this.props.submitCommand({ command: 'open_interactive_window', args: undefined })}
                        title="Open in Interactive Window"
                    /> */}
                {/* <div
                    className="codicon codicon-filter codicon-button"
                    onClick={() => this.props.onToggleFilter()}
                    title="Toggle filters"
                /> */}
            </div>
        );
    }
}
