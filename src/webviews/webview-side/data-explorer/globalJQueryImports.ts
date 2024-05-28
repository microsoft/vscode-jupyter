// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/*
This file exists for the sole purpose of ensuring jQuery and slickgrid load in the right sequence.
We need to first load jquery into window.jQuery.
After that we need to load slickgrid, and then the jQuery plugin from slickgrid event.drag.
*/

// Slickgrid requires jquery to be defined. Globally. So we do some hacks here.
// We need to manipulate the grid with the same jquery that it uses
// use slickgridJQ instead of the usual $ to make it clear that we need that JQ and not
// the one currently in node-modules

require('slickgrid/lib/jquery-1.11.2.min');

require('slickgrid/lib/jquery.event.drag-2.3.0');
