// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';
import * as React from 'react';
import * as path from '../../../platform/vscode-path/path';

// This special function finds relative paths when loading inside of vscode. It's not defined
// when loading outside, so the Image component should still work.
export declare function resolvePath(relativePath: string): string;

interface IRelativeImageProps {
    class: string;
    path: string;
}

export class RelativeImage extends React.Component<IRelativeImageProps> {
    public override render() {
        return <img src={this.getImageSource()} className={this.props.class} alt={path.basename(this.props.path)} />;
    }

    private getImageSource = () => {
        // eslint-disable-next-line
        if (typeof resolvePath === 'undefined') {
            return this.props.path;
        } else {
            return resolvePath(this.props.path);
        }
    };
}
