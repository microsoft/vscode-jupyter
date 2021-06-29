import * as React from 'react';
import {
    DataWranglerCommands,
    IDropNaRequest
} from '../../../../../client/datascience/data-viewing/data-wrangler/types';
import { dropButtonStyle } from '../styles';

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
                style={dropButtonStyle}
            >
                Drop
            </button>
        );
    }
}
