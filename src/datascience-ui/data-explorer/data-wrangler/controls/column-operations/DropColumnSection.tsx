import * as React from 'react';
import { DataWranglerCommands, IDropRequest } from '../../../../../client/datascience/data-viewing/data-wrangler/types';

interface IProps {
    selectedColumns: string[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    submitCommand(data: { command: string; args: any }): void;
    setColumns(cols: number[]): void;
}

interface IState {
}

export class DropColumnsSection extends React.Component<IProps, IState> {
    render() {
        return (
                <button
                    onClick={() => {
                        this.props.submitCommand({
                            command: DataWranglerCommands.Drop,
                            args: {
                                targetColumns: this.props.selectedColumns
                            } as IDropRequest
                        });
                        // Clear ourselves after dropping columns
                        this.props.setColumns([]);
                    }}
                    style={{
                        // width: '50px',
                        backgroundColor: 'var(--vscode-button-background)',
                        color: 'var(--vscode-button-foreground)',
                        margin: '4px',
                        padding: '8px',
                        border: 'none',
                        cursor: 'pointer',
                        height: '26px',
                        marginLeft: '0px',
                        display: 'inline-flex',
                        alignItems: 'center'
                    }}
                >
                    Drop
                </button>
        );
    }
}
