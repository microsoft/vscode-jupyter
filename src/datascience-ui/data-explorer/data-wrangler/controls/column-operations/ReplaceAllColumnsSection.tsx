import * as React from 'react';
import { getLocString } from '../../../../react-common/locReactSide';
import { inputStyle } from '../styles';

interface IProps {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setArgs(args: any): void;
}

interface IState {
    oldValue: string | number;
    newValue: string | number;
}

export class ReplaceAllColumnsSection extends React.Component<IProps, IState> {
    constructor(props: IProps) {
        super(props);
        this.state = {
            oldValue: '',
            newValue: ''
        };
        this.props.setArgs({
            oldValue: '',
            newValue: '',
            isPreview: true
        });
    }

    render() {
        return (
            <>
                <span>{getLocString("DataScience.dataWranglerOldValue", "Old Value")}</span>
                <input
                    value={this.state.oldValue}
                    onChange={this.handleChangeOldValue}
                    className={'slice-data'}
                    style={inputStyle}
                    autoComplete="on"
                />
                <span>{getLocString("DataScience.dataWranglerNewValue", "New Value")}</span>
                <input
                    value={this.state.newValue}
                    onChange={this.handleChangeNewValue}
                    className={'slice-data'}
                    style={inputStyle}
                    autoComplete="on"
                />
            </>
        );
    }

    private handleChangeOldValue = (event: React.ChangeEvent<HTMLInputElement>) => {
        this.setState({ oldValue: event.currentTarget.value });
        this.props.setArgs({
            oldValue: event.currentTarget.value,
            newValue: this.state.newValue,
            isPreview: true
        });
    };

    private handleChangeNewValue = (event: React.ChangeEvent<HTMLInputElement>) => {
        this.setState({ newValue: event.currentTarget.value });
        this.props.setArgs({
            oldValue: this.state.oldValue,
            newValue: event.currentTarget.value,
            isPreview: true
        });
    };
}
