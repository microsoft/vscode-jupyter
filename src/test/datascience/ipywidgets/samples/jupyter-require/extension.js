/**
 * Jupyter require nbextension
 *
 * @module
 * @summary     Require
 * @description Jupyter library and magic extension for managing linked JavaScript and CSS scripts and styles.
 * @version     0.1.0
 * @file        require/extension.js
 * @author      Marek Cermak
 * @contact     macermak@redhat.com
 * @copyright   Copyright 2019 Marek Cermak <macermak@redhat.com>
 *
 * This source file is free software, available under the following license:
 *   MIT license
 *
 * This source file is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY
 * or FITNESS FOR A PARTICULAR PURPOSE. See the license files for details.
 *
 * For details please refer to: https://github.com/CermakM/jupyter-require
 */

define( function ( require ) {
    'use strict';

    const __extension__ = 'jupyter_require'

    const params = {
        init_delay: 1000
    }

    // Load required libraries
    if ( window.require ) {
        window.require.config( {
            paths: {
                "js-logger": "https://unpkg.com/js-logger/src/logger.min",
            }
        } )

        // make sure everything is loaded into context
        window.require( [ 'js-logger' ], () => { } )
    }

    /**
     * Load ipython extension
     *
     */
    function load_ipython_extension() {
        require( [
            'underscore',
            'base/js/namespace',
            'base/js/events',
            './loader'
        ], function ( _, Jupyter, events, load_extension ) {
            return new Promise( ( resolve ) => {

                if ( !Jupyter.notebook ) {
                    // we're some other view like dashboard, terminal, etc, so bail now
                    return
                }

                const kernel = Jupyter.notebook.kernel
                const opts = {
                    silent: true,
                    store_history: false,
                    exit_on_error: false
                }

                if ( Jupyter.notebook._fully_loaded ) {
                    setTimeout( () => {
                        // autoload
                        load_extension()
                            .then( () => kernel.execute( "%reload_ext " + __extension__, {}, opts ) )
                            .then( () => {
                                events.trigger( 'extension_loaded.JupyterRequire', { timestamp: _.now() } );
                            } )
                    }, params.init_delay );
                } else {

                    events.one( 'notebook_loaded.Notebook', () => {
                        // autoload
                        load_extension()
                            .then( () => kernel.execute( "%reload_ext " + __extension__, {}, opts ) )
                            .then( () => {
                                events.trigger( 'extension_loaded.JupyterRequire', { timestamp: _.now() } );
                            } )
                    } );
                }

                // When the kernel is restarted
                events.on( 'kernel_ready.Kernel', () => {
                    // autoload
                    load_extension( { reload: true } )
                        .then( () => kernel.execute( "%reload_ext " + __extension__, {}, opts ) )
                        .then( () => {
                            events.trigger( 'extension_loaded.JupyterRequire', { timestamp: _.now() } );
                        } )
                } );

            } );
        } );
    }


    return { load_ipython_extension: load_ipython_extension };

} );