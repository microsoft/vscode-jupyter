import * as React from 'react';
import { DataWranglerCommands, IDropNaRequest } from '../../../../../client/datascience/data-viewing/data-wrangler/types';
import { dropButtonStyle } from '../styles';

interface IProps {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    submitCommand(data: { command: string; args: any }): void;
}

interface IState {}

export class DropMissingRowsSection extends React.Component<IProps, IState> {
    render() {
        return (
            <button
                onClick={() =>
                    this.props.submitCommand({
                        command: DataWranglerCommands.DropNa,
                        args: { target: 'row' } as IDropNaRequest
                    })
                }
                style={dropButtonStyle}
            >
                Drop
            </button>
        );
    }
}
