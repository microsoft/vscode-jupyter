import * as React from 'react';
import {
    DataWranglerCommands,
    IDropNaRequest
} from '../../../../../client/datascience/data-viewing/data-wrangler/types';

interface IProps {
    selectedColumns: string[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    submitCommand(data: { command: string; args: any }): void;
    setColumns(cols: number[]): void;
}

interface IState {}

export class DropMissingColumnsSection extends React.Component<IProps, IState> {
    render() {
        return (
            <button
                onClick={() => {
                    this.props.submitCommand({
                        command: DataWranglerCommands.DropNa,
                        args: { targetColumns: this.props.selectedColumns } as IDropNaRequest
                    });
                    this.props.setColumns([]);
                }}
                style={{
                    width: '50px',
                    backgroundColor: 'var(--vscode-button-background)',
                    color: 'var(--vscode-button-foreground)',
                    margin: '0px',
                    padding: '4px',
                    border: 'none',
                    cursor: 'pointer',
                    height: '26px'
                    // marginTop: '28px'
                }}
            >
                Drop
            </button>
        );
    }
}
