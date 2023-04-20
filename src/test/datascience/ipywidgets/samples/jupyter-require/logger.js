/**
 * Logger.
 *
 * Logging functionality.
 *
 * @link   https://github.com/CermakM/jupyter-require#readme
 * @file   This file implements logging functionality.
 * @author Marek Cermak <macermak@redhat.com>
 * @since  0.3.2
 */

define( [ "js-logger" ], function ( Logger ) {
    'use strict';

    Logger.useDefaults( {
        defaultLevel: Logger.DEBUG,
        formatter: function ( messages, context ) {
            const name = context.name || "requirejs"
            const date = new Date().toUTCString()

            messages.unshift( `${ date } [${ name }] ${ context.level.name }:` )
        }
    } )

    return ( name ) => _.isUndefined( name ) ? Logger : Logger.get( name )
} )