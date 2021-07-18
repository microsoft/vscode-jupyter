import * as React from 'react';
import { getLocString } from '../../../../react-common/locReactSide';
import { inputStyle } from '../styles';

interface IProps {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setArgs(args: any): void;
}

interface IState {
    value: string | number;
}

export class FillNaSection extends React.Component<IProps, IState> {
    constructor(props: IProps) {
        super(props);
        this.state = {
            value: ''
        };
        this.props.setArgs({
            value: '',
            isPreview: true
        });
    }

    render() {
        return (
            <>
                <span>{getLocString('DataScience.dataWranglerNewValue', 'New Value')}</span>
                <input
                    value={this.state.value}
                    onChange={this.handleChangeValue}
                    className={'slice-data'}
                    style={inputStyle}
                    autoComplete="on"
                />
            </>
        );
    }

    private handleChangeValue = (event: React.ChangeEvent<HTMLInputElement>) => {
        this.setState({ value: event.currentTarget.value });
        this.props.setArgs({
            value: event.currentTarget.value,
            isPreview: true
        });
    };
}
