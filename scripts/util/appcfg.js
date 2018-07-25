/*
  Tip Tab
  A Firefox extension to manage and navigate the browser tabs.
  Copyright (C) 2018  William Wong (williamw520@gmail.com)

  This program is free software: you can redistribute it and/or modify
  it under the terms of the GNU General Public License as published by
  the Free Software Foundation, either version 3 of the License, or
  (at your option) any later version.

  This program is distributed in the hope that it will be useful,
  but WITHOUT ANY WARRANTY; without even the implied warranty of
  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
  GNU General Public License for more details.

  You should have received a copy of the GNU General Public License
  along with this program.  If not, see <http://www.gnu.org/licenses/>.
*/

// appcfg module, app global constants and settings.
(function(scope, modulename) {
    "use strict";

    // Imports:
    // import logger
    let Logger = logger.Logger;
    
    var module = function() { };       // Module object to be returned.
    if (modulename)
        scope[modulename] = module;    // set module name in scope, otherwise caller sets the name with the returned module object.

    // Module export
    module.APPNAME = "tiptab";
    //module.LOGLEVEL = logger.LOG;
    module.LOGLEVEL = logger.WARN;

    let log = new logger.Logger(module.APPNAME, modulename, module.LOGLEVEL);
    log.info("module loaded");
    return module;

}(this, "appcfg"));      // Pass in the global scope as 'this' scope.

