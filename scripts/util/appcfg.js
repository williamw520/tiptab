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

import logger from "/scripts/util/logger.js";


// appcfg module, app global constants and settings.
let the_module = (function() {
    "use strict";

    const module = { NAME: "appcfg" };

    // Module export
    module.APPNAME = "tiptab";
    //module.LOGLEVEL = logger.LOG;
    module.LOGLEVEL = logger.WARN;

    const log = new logger.Logger(module.APPNAME, module.NAME, module.LOGLEVEL);
    log.info("module loaded");
    return module;

}());

export default the_module;

